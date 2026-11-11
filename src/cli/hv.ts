import { Command } from 'commander'
import fs from 'node:fs'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { backupVault, defaultVaultPath, openVault, rekey, vaultExists, WrongPasswordError } from '../core/db'
import { Repo } from '../core/repo'
import { checkHosts } from '../core/probe'
import { buildConnect, guessProto, type Proto } from '../core/connect'
import { parseNmapXml } from '../core/import/nmap'
import { csvToHosts, guessMapping, parseCsv } from '../core/import/csv'
import { applyImport } from '../core/import/apply'
import { fetchSliverHosts, listSliverConfigs } from '../core/import/sliver'
import { execImplant, pingImplant, runShell, shellArgv } from '../core/sliver/client'
import { exportCsv, exportJson, exportMarkdown } from '../core/export'
import { ACCESS_LEVELS, CRED_KINDS, STATUSES, type AccessLevel, type CredKind, type Filter, type Host, type Status } from '../core/types'

const R = process.stdout.isTTY && !process.env.NO_COLOR
const c = (n: number) => (s: string) => (R ? `\x1b[${n}m${s}\x1b[0m` : s)
const red = c(31), green = c(32), yellow = c(33), dim = c(2), bold = c(1), gray = c(90)
const die = (m: string): never => { console.error(red('error: ') + m); process.exit(1) }

async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) return new Promise(res => { let d = ''; process.stdin.on('data', x => (d += x)); process.stdin.on('end', () => res(d.split('\n')[0])) })
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true })
    ;(rl as any)._writeToOutput = (s: string) => { if (s.includes(prompt)) process.stderr.write(s) }
    rl.question(prompt, a => { rl.close(); process.stderr.write('\n'); res(a) })
  })
}
async function getPassword(o: { passwordStdin?: boolean }, prompt = 'Master password: '): Promise<string> {
  if (process.env.HV_PASSWORD) return process.env.HV_PASSWORD
  if (o.passwordStdin) return (await readSecret('')).trim()
  if (!process.stdin.isTTY) die('No TTY: use --password-stdin or HV_PASSWORD')
  return readSecret(prompt)
}
async function open(o: any): Promise<Repo> {
  if (!vaultExists()) die(`No vault at ${defaultVaultPath()}. Run: hv init`)
  try { return new Repo(openVault(await getPassword(o))) }
  catch (e) { return die(e instanceof WrongPasswordError ? 'Wrong master password' : (e as Error).message) }
}
function activeProject(repo: Repo, name?: string) {
  const ref = name ?? (repo.getSettings().activeProject as string | undefined)
  const p = ref ? repo.getProject(ref) : repo.listProjects(false)[0]
  if (ref && !p) die(`Unknown project: ${ref}`)
  return p ?? repo.listProjects()[0]
}
const statusColor = (s: string) => ({ online: green, offline: yellow, dead: red, unknown: gray } as Record<string, (x: string) => string>)[s]?.(s) ?? s
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
function table(head: string[], rows: string[][]) {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => strip(r[i] ?? '').length)))
  const line = (r: string[]) => r.map((x, i) => (x ?? '') + ' '.repeat(w[i] - strip(x ?? '').length)).join('  ')
  console.log(bold(line(head))); console.log(dim(w.map(n => '─'.repeat(n)).join('──')))
  rows.forEach(r => console.log(line(r)))
}
const out = (o: any, data: unknown, human: () => void) => (o.json ? console.log(JSON.stringify(data, null, 2)) : human())
const pick = <T extends string>(v: string, allowed: readonly T[], what: string): T => ((allowed as readonly string[]).includes(v) ? (v as T) : die(`Invalid ${what} "${v}". Use: ${allowed.join(', ')}`))
const list = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean)
function filterFrom(o: any, repo: Repo, projectOverride?: string): Filter {
  const f: Filter = { projectId: o.all ? null : activeProject(repo, o.project ?? projectOverride).id }
  if (o.status) f.status = list(o.status).map(s => pick(s, STATUSES, 'status')) as Status[]
  if (o.access) f.access = list(o.access).map(s => pick(s, ACCESS_LEVELS, 'access')) as AccessLevel[]
  if (o.tag) f.tags = list(o.tag)
  if (o.os) f.os = o.os
  if (o.port) f.port = Number(o.port)
  if (o.service) f.service = o.service
  if (o.hasCreds) f.hasCreds = true
  if (o.withoutCreds) f.hasCreds = false
  if (o.favorite) f.favorite = true
  if (o.seen) f.seenWithinDays = Number(o.seen)
  if (o.search) f.search = o.search
  if (o.sort) f.sort = o.sort
  if (o.desc) f.desc = true
  return f
}
const withFilters = (cmd: Command) => cmd
  .option('-p, --project <name>', 'project (default: active)').option('-a, --all', 'all projects')
  .option('--status <list>', 'online,offline,dead,unknown').option('--access <list>', 'none,user,admin,root')
  .option('--tag <list>', 'hosts having ALL of these tags (comma separated)').option('--os <text>').option('--port <n>').option('--service <text>')
  .option('--has-creds').option('--without-creds').option('--favorite').option('--seen <days>', 'seen within N days')
  .option('-s, --search <text>', 'free-text search').option('--sort <field>', 'ip|hostname|os|status|access|lastSeen|lastChecked|created').option('--desc')
function resolveHost(repo: Repo, ref: string, o: any): Host {
  const h = repo.findHost(ref, /^#?\d+$/.test(ref) ? null : activeProject(repo, o.project).id) ?? repo.findHost(ref, null)
  return h ?? die(`Host not found: ${ref}`)
}
const hostLabel = (h: Host) => [h.ip, h.hostname && `(${h.hostname})`].filter(Boolean).join(' ')

const program = new Command('hv').description('HostVault — encrypted pentest host & access manager').version('1.0.0')
  .option('--json', 'machine-readable output').option('--password-stdin', 'read master password from stdin')
  .showHelpAfterError()
const G = () => program.opts()

program.command('init').description('create a new encrypted vault').action(async () => {
  const f = defaultVaultPath(); if (vaultExists(f)) die(`Vault already exists at ${f}`)
  const pw = process.env.HV_PASSWORD || (G().passwordStdin ? (await readSecret('')).trim() : await readSecret('New master password: '))
  if (!process.env.HV_PASSWORD && !G().passwordStdin && pw !== (await readSecret('Confirm: '))) die('Passwords do not match')
  if (pw.length < 8) die('Use at least 8 characters')
  openVault(pw, f, true).close(); console.log(green('✔ ') + `Vault created at ${f}`)
})
program.command('info').description('show vault location and counts').action(async () => {
  const repo = await open(G()); const p = activeProject(repo); const s = repo.stats(p.id)
  out(G(), { vault: defaultVaultPath(), project: p.name, ...s }, () => {
    console.log(`${bold('Vault')}   ${defaultVaultPath()}\n${bold('Project')} ${p.name}\n${bold('Hosts')}   ${s.total}  ${green('online ' + (s.status.online ?? 0))}  ${yellow('offline ' + (s.status.offline ?? 0))}  ${red('dead ' + (s.status.dead ?? 0))}  ${gray('unknown ' + (s.status.unknown ?? 0))}\n${bold('Access')}  ${s.withCreds} host(s) with ${s.creds} credential(s)`)
  })
})
program.command('passwd').description('change master password').action(async () => {
  const repo = await open(G()); const n = process.env.HV_NEW_PASSWORD || await readSecret('New master password: ')
  if (n.length < 8) die('Use at least 8 characters'); rekey(repo.db, n); console.log(green('✔ ') + 'Master password changed')
})
program.command('backup <dest>').description('copy the (still encrypted) vault file').action(async (dest: string) => { const r = await open(G()); backupVault(r.db, dest); console.log(green('✔ ') + dest) })

const project = program.command('project').description('manage engagements')
project.command('ls').action(async () => { const r = await open(G()); const act = activeProject(r).id; const ps = r.listProjects()
  out(G(), ps, () => table(['', 'NAME', 'CLIENT', 'HOSTS', 'STATE'], ps.map(p => [p.id === act ? red('●') : ' ', p.name, p.client, String(r.stats(p.id).total), p.archived ? 'archived' : 'active']))) })
project.command('add <name>').option('--client <c>').option('--scope <s>').action(async (name: string, o: any) => { const r = await open(G()); const p = r.addProject({ name, client: o.client, scope: o.scope }); console.log(green('✔ ') + `Created project "${p.name}"`) })
project.command('use <name>').action(async (name: string) => { const r = await open(G()); const p = r.getProject(name) ?? die('Unknown project'); r.setSetting('activeProject', p.name); console.log(green('✔ ') + `Active project: ${p.name}`) })
project.command('archive <name>').option('--undo').action(async (name: string, o: any) => { const r = await open(G()); const p = r.getProject(name) ?? die('Unknown project'); r.updateProject(p.id, { archived: !o.undo }); console.log(green('✔ ') + (o.undo ? 'Restored ' : 'Archived ') + p.name) })

const host = program.command('host').description('manage hosts')
withFilters(host.command('ls').description('list hosts')).option('-n, --limit <n>').option('--ids', 'print only IPs/hostnames').action(async (o: any) => {
  const r = await open(G()); const f = filterFrom(o, r); if (o.limit) f.limit = Number(o.limit); const hs = r.listHosts(f)
  if (o.ids) return void hs.forEach(h => console.log(h.ip || h.hostname))
  out(G(), hs, () => { if (!hs.length) return console.log(dim('No hosts match.'))
    table(['ID', 'IP', 'HOSTNAME', 'OS', 'STATUS', 'ACCESS', 'TAGS', 'SVC', 'CRED'], hs.map(h => [String(h.id), (h.favorite ? '★ ' : '') + h.ip, h.hostname, h.os.slice(0, 24), statusColor(h.status), h.access === 'none' ? gray('none') : h.access === 'root' || h.access === 'admin' ? red(h.access) : h.access, h.tags.join(','), String(h.serviceCount), String(h.credCount)]))
    console.log(dim(`\n${hs.length} host(s)`)) })
})
host.command('add [target]').description('add a host (IP or hostname)').option('-p, --project <name>').option('--ip <ip>').option('--hostname <h>').option('--mac <m>').option('--os <os>').option('--url <u>')
  .option('--status <s>').option('--access <a>').option('--tag <list>').option('--port <list>', 'comma separated ports').option('--note <text>').action(async (t: string | undefined, o: any) => {
  const r = await open(G()); const isIp = t && /^[0-9a-fA-F:.]+$/.test(t) && /[.:]/.test(t)
  const h = r.addHost({ projectId: activeProject(r, o.project).id, ip: o.ip ?? (isIp ? t : ''), hostname: o.hostname ?? (!isIp && t ? t : ''), mac: o.mac, os: o.os, url: o.url,
    status: o.status && pick(o.status, STATUSES, 'status'), access: o.access && pick(o.access, ACCESS_LEVELS, 'access') })
  if (o.tag) r.addTags(h.id, list(o.tag)); if (o.port) list(o.port).forEach(p => r.upsertService(h.id, { port: Number(p) })); if (o.note) r.addNote(h.id, o.note)
  out(G(), r.getHost(h.id), () => console.log(green('✔ ') + `Added #${h.id} ${hostLabel(h)}`))
})
host.command('show <host>').option('-p, --project <name>').option('--reveal', 'show secrets').action(async (ref: string, o: any) => {
  const r = await open(G()); const h = resolveHost(r, ref, o); const svc = r.listServices(h.id), cr = r.listCredentials(h.id), nt = r.listNotes(h.id)
  const view = { ...h, services: svc, credentials: cr.map(x => ({ ...x, secret: o.reveal ? x.secret : x.secret ? '••••••••' : '' })), notes: nt }
  out(G(), view, () => {
    console.log(`${bold(hostLabel(h))}  ${statusColor(h.status)}  access:${h.access}${h.favorite ? ' ★' : ''}\nOS ${h.os || '—'}   MAC ${h.mac || '—'}   URL ${h.url || '—'}   seen ${h.lastSeen}   checked ${h.lastChecked ?? 'never'}\nTags ${h.tags.join(', ') || '—'}`)
    if (svc.length) { console.log(bold('\nServices')); table(['PORT', 'NAME', 'PRODUCT'], svc.map(s => [`${s.port}/${s.protocol}`, s.name, `${s.product} ${s.version}`.trim()])) }
    if (cr.length) { console.log(bold('\nCredentials')); table(['ID', 'KIND', 'USER', 'SECRET', 'VALID'], view.credentials.map(x => [String(x.id), x.kind, (x.domain ? x.domain + '\\' : '') + x.username, x.secret.split('\n')[0].slice(0, 60), x.valid == null ? '?' : x.valid ? green('yes') : red('no')])) }
    if (nt.length) { console.log(bold('\nNotes')); nt.forEach(n => console.log(`${n.pinned ? '📌' : '•'} ${dim(n.updatedAt)}\n  ${n.body.replace(/\n/g, '\n  ')}`)) }
  })
})
host.command('edit <host>').option('-p, --project <name>').option('--ip <ip>').option('--hostname <h>').option('--mac <m>').option('--os <os>').option('--url <u>').option('--access <a>').option('--favorite').option('--unfavorite').action(async (ref: string, o: any) => {
  const r = await open(G()); const h = resolveHost(r, ref, o)
  r.updateHost(h.id, { ip: o.ip, hostname: o.hostname, mac: o.mac, os: o.os, url: o.url, access: o.access && pick(o.access, ACCESS_LEVELS, 'access'), favorite: o.favorite ? true : o.unfavorite ? false : undefined })
  console.log(green('✔ ') + 'Updated')
})
host.command('status <host> <status>').description('set online|offline|dead|unknown').option('-p, --project <name>').action(async (ref: string, s: string, o: any) => {
  const r = await open(G()); const h = resolveHost(r, ref, o); r.setStatus(h.id, pick(s, STATUSES, 'status')); console.log(green('✔ ') + `${hostLabel(h)} → ${statusColor(s)}`)
})
withFilters(host.command('rm [hosts...]').description('delete hosts (by ref, or by filters)')).option('-y, --yes', 'do not ask').action(async (refs: string[], o: any) => {
  const r = await open(G()); const hs = refs.length ? refs.map(x => resolveHost(r, x, o)) : (Object.keys(o).filter(k => !['project', 'yes'].includes(k)).length ? r.listHosts(filterFrom(o, r)) : die('Give hosts or filters'))
  if (!hs.length) return void console.log(dim('Nothing to delete.'))
  if (!o.yes) { if (!process.stdin.isTTY) die('Use --yes to confirm'); if ((await readSecret(`Delete ${hs.length} host(s)? type "yes": `)) !== 'yes') die('Aborted') }
  r.deleteHosts(hs.map(h => h.id)); console.log(green('✔ ') + `Deleted ${hs.length} host(s)`)
})

const tag = program.command('tag').description('tag hosts')
for (const [name, fn] of [['add', 'addTags'], ['rm', 'removeTags']] as const)
  tag.command(`${name} <host> <tags...>`).option('-p, --project <name>').action(async (ref: string, tags: string[], o: any) => { const r = await open(G()); const h = resolveHost(r, ref, o); (r as any)[fn](h.id, tags.flatMap(list)); console.log(green('✔ ') + `${hostLabel(h)}: ${r.getHost(h.id)!.tags.join(', ') || '—'}`) })
tag.command('ls').action(async () => { const r = await open(G()); const t = r.listTags(activeProject(r).id); out(G(), t, () => table(['TAG', 'HOSTS'], t.map(x => [x.name, String(x.count)]))) })

const note = program.command('note').description('host notes')
note.command('add <host> <text...>').option('-p, --project <name>').option('--pin').action(async (ref: string, text: string[], o: any) => { const r = await open(G()); r.addNote(resolveHost(r, ref, o).id, text.join(' '), !!o.pin); console.log(green('✔ ') + 'Note added') })
note.command('ls <host>').option('-p, --project <name>').action(async (ref: string, o: any) => { const r = await open(G()); const n = r.listNotes(resolveHost(r, ref, o).id); out(G(), n, () => n.forEach(x => console.log(`${x.pinned ? '📌 ' : ''}${dim(x.updatedAt)}  ${x.body}`))) })

const cred = program.command('cred').description('access data')
cred.command('add <host>').option('-p, --project <name>').option('-u, --user <u>').option('--secret <s>', 'avoid: visible in shell history; prefer --secret-stdin or prompt').option('--secret-stdin').option('-k, --kind <k>', CRED_KINDS.join('|'), 'password')
  .option('-d, --domain <d>').option('--source <s>').option('--valid', 'mark verified-valid').option('--invalid').action(async (ref: string, o: any) => {
  const r = await open(G()); const h = resolveHost(r, ref, o)
  const secret = o.secret ?? (o.secretStdin ? fs.readFileSync(0, 'utf8').replace(/\n$/, '') : process.stdin.isTTY ? await readSecret('Secret (hidden, empty for none): ') : '')
  const x = r.addCredential(h.id, { username: o.user ?? '', secret, kind: pick(o.kind, CRED_KINDS, 'kind') as CredKind, domain: o.domain, source: o.source, valid: o.valid ? true : o.invalid ? false : null })
  console.log(green('✔ ') + `Credential #${x.id} added to ${hostLabel(h)}`)
})
cred.command('ls <host>').option('-p, --project <name>').option('--reveal').action(async (ref: string, o: any) => { const r = await open(G()); const cs = r.listCredentials(resolveHost(r, ref, o).id).map(x => ({ ...x, secret: o.reveal ? x.secret : x.secret ? '••••••••' : '' }))
  out(G(), cs, () => table(['ID', 'KIND', 'USER', 'SECRET'], cs.map(x => [String(x.id), x.kind, (x.domain ? x.domain + '\\' : '') + x.username, x.secret.split('\n')[0]]))) })
cred.command('show <id>').description('print one secret (raw, for piping)').action(async (id: string) => { const r = await open(G()); process.stdout.write((r.getCredential(Number(id)) ?? die('Not found')).secret + (process.stdout.isTTY ? '\n' : '')) })
cred.command('rm <id>').action(async (id: string) => { const r = await open(G()); r.deleteCredential(Number(id)); console.log(green('✔ ') + 'Removed') })

withFilters(program.command('check [hosts...]').description('probe hosts (ping + TCP) and set online/offline; skips dead hosts'))
  .option('--no-ping').option('--ping-only', 'ICMP only, no TCP probes').option('--via <mode>', 'network|sliver (sliver = C2 ping for bound hosts)').option('--ports <list>').option('--timeout <ms>', '', '1500').option('--concurrency <n>', '', '16').action(async (refs: string[], o: any) => {
  const r = await open(G()); const hs = refs.length ? refs.map(x => resolveHost(r, x, o)) : r.listHosts(filterFrom(o, r)); const live = hs.filter(h => h.status !== 'dead')
  if (!live.length) return void console.log(dim('No hosts to check.'))
  if (o.via === 'sliver') {
    const bound = live.map(h => ({ h, b: r.getSliver(h.id) })).filter(x => x.b)
    if (!bound.length) return void console.log(dim('No Sliver-bound hosts to check.'))
    console.error(dim(`Sliver-ping ${bound.length} host(s)…`))
    const res: { id: number; status: string; ms?: number }[] = []
    for (const { h, b } of bound) {
      try {
        const p = pingImplant(b!.implantId, { config: b!.configPath || undefined, timeoutMs: Number(o.timeout) || 60_000 })
        r.setStatus(h.id, p.ok ? 'online' : 'offline', true)
        r.upsertSliver(h.id, { implantId: b!.implantId, name: b!.name, kind: b!.kind, configPath: b!.configPath, health: p.ok ? '[ALIVE]' : '[DEAD]', lastMessage: p.ms != null ? `${p.ms}ms` : '' })
        res.push({ id: h.id, status: p.ok ? 'online' : 'offline', ms: p.ms })
        if (!G().json) console.log(`${statusColor(p.ok ? 'online' : 'offline').padEnd(R ? 17 : 8)} ${hostLabel(h)}${p.ms != null ? dim(`  ${p.ms}ms`) : ''}`)
      } catch (e) {
        r.setStatus(h.id, 'offline', true)
        res.push({ id: h.id, status: 'offline' })
        if (!G().json) console.log(`${statusColor('offline').padEnd(R ? 17 : 8)} ${hostLabel(h)}  ${dim((e as Error).message)}`)
      }
    }
    if (G().json) console.log(JSON.stringify(res))
    else console.log(dim(`\n${res.filter(x => x.status === 'online').length} online, ${res.filter(x => x.status === 'offline').length} offline`))
    return
  }
  console.error(dim(`Checking ${live.length} host(s)…`))
  const res = await checkHosts(r, live.map(h => h.id), { ping: o.ping, pingOnly: o.pingOnly, ports: o.ports && list(o.ports).map(Number), timeoutMs: Number(o.timeout), concurrency: Number(o.concurrency) },
    (id, st) => { if (!G().json) console.log(`${statusColor(st).padEnd(R ? 17 : 8)} ${hostLabel(r.getHost(id)!)}`) })
  if (G().json) console.log(JSON.stringify(res)); else console.log(dim(`\n${res.filter(x => x.status === 'online').length} online, ${res.filter(x => x.status === 'offline').length} offline`))
})
program.command('connect <host>').description('build (and optionally run) a connection command').option('-p, --project <name>').option('--proto <p>').option('--port <n>').option('--cred <id>').option('--print', 'only print, never run').option('--run', 'run it (ssh/telnet/ftp/sliver only)')
  .action(async (ref: string, o: any) => {
    const r = await open(G()); const h = resolveHost(r, ref, o)
    if (o.proto === 'sliver' || (!o.proto && r.getSliver(h.id))) {
      const b = r.getSliver(h.id) ?? die('Host has no Sliver binding')
      if (b.kind !== 'session') die('Sliver shell needs an interactive session')
      const argv = shellArgv(b.implantId, { config: b.configPath || undefined })
      const cmd = { proto: 'sliver', argv, display: argv.map(a => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' '), needsPassword: false, note: `implant ${b.implantId}${b.name ? ` (${b.name})` : ''}` }
      out(G(), cmd, () => { console.log(cmd.display); if (cmd.note) console.error(dim('# ' + cmd.note)) })
      if (o.run && !o.print) process.exit(await runShell(b.implantId, { config: b.configPath || undefined }))
      return
    }
    const svcs = r.listServices(h.id)
    const svc = o.port ? svcs.find(s => s.port === Number(o.port)) ?? { port: Number(o.port), name: '' } : o.proto ? svcs.find(s => guessProto(s) === o.proto) : svcs.find(s => guessProto(s))
    const proto = (o.proto ?? (svc && guessProto(svc)) ?? die('No known service; pass --proto')) as Proto
    const cr = o.cred ? r.getCredential(Number(o.cred)) : r.listCredentials(h.id)[0]
    const cmd = buildConnect(proto, h, svc, cr)
    out(G(), cmd, () => { console.log(cmd.display); if (cmd.note) console.error(dim('# ' + cmd.note)) })
    if (o.run && !o.print) { if (!['ssh', 'telnet', 'ftp'].includes(proto)) die('--run only supports ssh, telnet, ftp, sliver'); spawn(cmd.argv[0], cmd.argv.slice(1), { stdio: 'inherit' }).on('exit', c => process.exit(c ?? 0)) }
  })

const sliver = program.command('sliver').description('Sliver C2: sync, ping, exec, shell')
sliver.command('sync').description('import/refresh beacons + sessions and bind implant ids')
  .option('--config <file>').option('-p, --project <name>').option('--tag <t>').option('--timeout <ms>', '', '60000')
  .action(async (o: any) => {
    const r = await open(G())
    const hs = fetchSliverHosts({ config: o.config || (r.getSettings().sliverConfig as string | undefined), timeoutMs: Number(o.timeout) })
    const res = applyImport(r, activeProject(r, o.project).id, hs, o.tag)
    out(G(), res, () => console.log(green('✔ ') + `${res.created} new, ${res.updated} updated, ${res.skipped} skipped`))
  })
sliver.command('ping <host>').description('C2 round-trip ping (not ICMP)').option('-p, --project <name>').option('--timeout <ms>', '', '60000').action(async (ref: string, o: any) => {
  const r = await open(G()); const h = resolveHost(r, ref, o); const b = r.getSliver(h.id) ?? die('Host has no Sliver binding — run: hv sliver sync')
  const p = pingImplant(b.implantId, { config: b.configPath || undefined, timeoutMs: Number(o.timeout) })
  r.setStatus(h.id, p.ok ? 'online' : 'offline', true)
  r.upsertSliver(h.id, { implantId: b.implantId, name: b.name, kind: b.kind, configPath: b.configPath, health: p.ok ? '[ALIVE]' : '[DEAD]', lastMessage: p.ms != null ? `${p.ms}ms` : '' })
  out(G(), { host: hostLabel(h), ...p }, () => console.log(`${p.ok ? green('✔ alive') : red('✖ dead')}  ${hostLabel(h)}${p.ms != null ? `  ${p.ms}ms` : ''}`))
})
sliver.command('exec <host> [cmd...]').description('run a command on the implant').option('-p, --project <name>').option('--timeout <ms>', '', '60000').action(async (ref: string, cmd: string[], o: any) => {
  const r = await open(G()); const h = resolveHost(r, ref, o); const b = r.getSliver(h.id) ?? die('Host has no Sliver binding')
  if (b.kind !== 'session') die('exec needs an interactive session')
  const clean = (cmd[0] === '--' ? cmd.slice(1) : cmd).filter(Boolean)
  if (!clean.length) die('Pass a command, e.g. hv sliver exec dc01 -- whoami')
  const res = execImplant(b.implantId, clean, { config: b.configPath || undefined, timeoutMs: Number(o.timeout) })
  out(G(), res, () => console.log(res.output || dim('(no output)')))
})
sliver.command('shell <host>').description('interactive implant shell (session only)').option('-p, --project <name>').option('--print', 'print argv only').action(async (ref: string, o: any) => {
  const r = await open(G()); const h = resolveHost(r, ref, o); const b = r.getSliver(h.id) ?? die('Host has no Sliver binding')
  if (b.kind !== 'session') die('shell needs an interactive session')
  const argv = shellArgv(b.implantId, { config: b.configPath || undefined })
  if (o.print || G().json) return void out(G(), { argv, display: argv.join(' ') }, () => console.log(argv.map(a => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ')))
  process.exit(await runShell(b.implantId, { config: b.configPath || undefined }))
})
sliver.command('show <host>').description('show Sliver binding for a host').option('-p, --project <name>').action(async (ref: string, o: any) => {
  const r = await open(G()); const h = resolveHost(r, ref, o); const b = r.getSliver(h.id) ?? die('No Sliver binding')
  out(G(), b, () => console.log(`${bold(hostLabel(h))}\n  id     ${b.implantId}\n  name   ${b.name || '—'}\n  kind   ${b.kind}\n  health ${b.health || '—'}\n  config ${b.configPath || '—'}\n  sync   ${b.syncedAt || '—'}`))
})

const imp = program.command('import').description('import hosts')
imp.command('nmap <file>').option('-p, --project <name>').option('--tag <t>').action(async (file: string, o: any) => { const r = await open(G()); const res = applyImport(r, activeProject(r, o.project).id, parseNmapXml(fs.readFileSync(file, 'utf8')), o.tag); out(G(), res, () => console.log(green('✔ ') + `${res.created} new, ${res.updated} updated, ${res.services} services`)) })
imp.command('sliver').description('import hosts from a sliver-client server (beacons + sessions)')
  .option('--config <file>', 'sliver operator config (default: only config in ~/.sliver-client/configs)')
  .option('--list-configs', 'print discovered sliver configs and exit')
  .option('-p, --project <name>').option('--tag <t>').option('--timeout <ms>', 'sliver-client deadline', '60000')
  .action(async (o: any) => {
    if (o.listConfigs) { const cs = listSliverConfigs(); if (!cs.length) die('No configs in ~/.sliver-client/configs'); cs.forEach(x => console.log(x)); return }
    const r = await open(G())
    const hs = fetchSliverHosts({ config: o.config, timeoutMs: Number(o.timeout) })
    const res = applyImport(r, activeProject(r, o.project).id, hs, o.tag)
    out(G(), res, () => console.log(green('✔ ') + `${res.created} new, ${res.updated} updated, ${res.skipped} skipped`))
  })
imp.command('csv <file>').option('-p, --project <name>').option('--tag <t>').option('--no-header').action(async (file: string, o: any) => { const r = await open(G()); const rows = parseCsv(fs.readFileSync(file, 'utf8')); const res = applyImport(r, activeProject(r, o.project).id, csvToHosts(rows, guessMapping(rows[0] ?? []), o.header), o.tag); out(G(), res, () => console.log(green('✔ ') + `${res.created} new, ${res.updated} updated, ${res.credentials} credentials`)) })

withFilters(program.command('export <format>').description('json | csv | md  (secrets redacted unless --include-secrets)')).option('--include-secrets').option('-o, --out <file>').action(async (fmt: string, o: any) => {
  const r = await open(G()); const f = filterFrom(o, r); const opt = { includeSecrets: !!o.includeSecrets }
  const text = ({ json: exportJson, csv: exportCsv, md: exportMarkdown } as any)[fmt]?.(r, f, opt) ?? die('Format must be json, csv or md')
  if (o.out) { fs.writeFileSync(o.out, text, { mode: 0o600 }); console.error(green('✔ ') + `Wrote ${o.out}`) } else process.stdout.write(text)
})

program.parseAsync(process.argv).catch(e => die(e.message))
