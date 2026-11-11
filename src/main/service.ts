// Vault session + API surface shared by every IPC call. Renderer never gets raw secrets unless it asks to reveal one.
import fs from 'node:fs'
import { backupVault, defaultVaultPath, openVault, rekey, vaultExists, type DB } from '../core/db'
import { Repo } from '../core/repo'
import { checkHosts, DEFAULT_PORTS } from '../core/probe'
import { buildConnect, guessProto, type Proto } from '../core/connect'
import { parseNmapXml } from '../core/import/nmap'
import { csvToHosts, guessMapping, parseCsv, HOST_FIELDS, type HostField } from '../core/import/csv'
import { applyImport } from '../core/import/apply'
import { fetchSliverHosts, listSliverConfigs } from '../core/import/sliver'
import { execImplant, pingImplant, shellArgv } from '../core/sliver/client'
import { exportCsv, exportJson, exportMarkdown } from '../core/export'
import type { Credential, Filter, HostInput, Status } from '../core/types'

export const maskCred = (c: Credential) => ({ ...c, secret: '', hasSecret: !!c.secret })

export class Service {
  repo: Repo | null = null
  onLock?: () => void
  vaultPath = defaultVaultPath()

  status() { return { exists: vaultExists(this.vaultPath), unlocked: !!this.repo, path: this.vaultPath } }
  create(pw: string) { if (pw.length < 8) throw new Error('Use at least 8 characters'); this.repo = new Repo(openVault(pw, this.vaultPath, true)); return this.status() }
  unlock(pw: string) { this.repo = new Repo(openVault(pw, this.vaultPath)); return this.status() }
  lock() { if (!this.repo) return; try { this.repo.db.close() } catch { /* already closed */ } this.repo = null; this.onLock?.() }
  private r(): Repo { if (!this.repo) throw new Error('Vault is locked'); return this.repo }

  private probe(ids: number[], pingOnly = false) {
    const s = this.r().getSettings()
    return checkHosts(this.r(), ids, { ping: s.checkPing !== false, pingOnly, timeoutMs: Number(s.checkTimeout ?? 1500), concurrency: Number(s.checkConcurrency ?? 16), ports: (s.checkPorts as number[] | undefined) ?? DEFAULT_PORTS })
  }

  // ---- API table: every key is callable from the renderer; nothing else is. ----
  api: Record<string, (...a: any[]) => unknown | Promise<unknown>> = {
    'vault.status': () => this.status(),
    'vault.create': (pw: string) => this.create(pw),
    'vault.unlock': (pw: string) => this.unlock(pw),
    'vault.lock': () => this.lock(),
    'vault.passwd': (oldPw: string, newPw: string) => {
      if (newPw.length < 8) throw new Error('Use at least 8 characters')
      const probe: DB = openVault(oldPw, this.vaultPath); probe.close() // re-verify identity
      rekey(this.r().db, newPw)
    },
    'projects.list': () => this.r().listProjects(),
    'projects.add': (p: any) => this.r().addProject(p),
    'projects.update': (id: number, p: any) => this.r().updateProject(id, p),
    'projects.delete': (id: number) => this.r().deleteProject(id),
    'hosts.list': (f: Filter) => this.r().listHosts(f),
    'hosts.get': (id: number) => this.r().getHost(id),
    'hosts.add': (i: HostInput & { projectId: number }) => this.r().addHost(i),
    'hosts.update': (id: number, i: HostInput) => this.r().updateHost(id, i),
    'hosts.delete': (ids: number[]) => this.r().deleteHosts(ids),
    'hosts.setStatus': (ids: number[], s: Status) => this.r().bulkSetStatus(ids, s),
    'hosts.check': (ids: number[]) => this.probe(ids),
    'hosts.ping': (ids: number[]) => this.probe(ids, true),
    'services.list': (hostId: number) => this.r().listServices(hostId),
    'services.upsert': (hostId: number, s: any) => this.r().upsertService(hostId, s),
    'services.delete': (id: number) => this.r().deleteService(id),
    'creds.list': (hostId: number) => this.r().listCredentials(hostId).map(maskCred),
    'creds.add': (hostId: number, c: any) => maskCred(this.r().addCredential(hostId, c)),
    'creds.update': (id: number, c: any) => maskCred(this.r().updateCredential(id, c)),
    'creds.delete': (id: number) => this.r().deleteCredential(id),
    'creds.reveal': (id: number) => this.r().getCredential(id)?.secret ?? '',
    'notes.list': (hostId: number) => this.r().listNotes(hostId),
    'notes.add': (hostId: number, body: string, pinned?: boolean) => this.r().addNote(hostId, body, pinned),
    'notes.update': (id: number, p: any) => this.r().updateNote(id, p),
    'notes.delete': (id: number) => this.r().deleteNote(id),
    'tags.list': (projectId?: number | null) => this.r().listTags(projectId),
    'tags.add': (hostIds: number[], names: string[]) => hostIds.forEach(i => this.r().addTags(i, names)),
    'tags.remove': (hostIds: number[], names: string[]) => hostIds.forEach(i => this.r().removeTags(i, names)),
    'tags.color': (name: string, color: string) => this.r().setTagColor(name, color),
    'activity.list': (hostId: number) => this.r().listActivity(hostId),
    'activity.recent': (projectId: number | null) => this.r().recentActivity(projectId),
    'filters.list': () => this.r().listSavedFilters(),
    'filters.save': (name: string, f: Filter) => this.r().saveFilter(name, f),
    'filters.delete': (id: number) => this.r().deleteSavedFilter(id),
    'settings.get': () => this.r().getSettings(),
    'settings.set': (k: string, v: unknown) => this.r().setSetting(k, v),
    'stats.get': (projectId: number | null) => this.r().stats(projectId),
    'connect.build': (hostId: number, proto?: Proto, port?: number, credId?: number) => {
      const r = this.r(); const h = r.getHost(hostId); if (!h) throw new Error('Host not found')
      const svcs = r.listServices(hostId)
      const svc = port ? svcs.find(s => s.port === port) ?? { port, name: '' } : proto ? svcs.find(s => guessProto(s) === proto) : svcs.find(s => guessProto(s))
      const p = (proto ?? (svc && guessProto(svc))) as Proto | undefined
      if (!p) throw new Error('No known service on this host — choose a protocol')
      const cred = credId ? r.getCredential(credId) : r.listCredentials(hostId)[0]
      return { ...buildConnect(p, h, svc, cred), credId: cred?.id ?? null }
    },
    'import.preview': (kind: 'nmap' | 'csv', text: string) => {
      if (kind === 'nmap') { const hs = parseNmapXml(text); return { kind, count: hs.length, sample: hs.slice(0, 8) } }
      const rows = parseCsv(text); return { kind, count: Math.max(0, rows.length - 1), header: rows[0] ?? [], rows: rows.slice(1, 6), mapping: guessMapping(rows[0] ?? []), fields: HOST_FIELDS }
    },
    'import.apply': (kind: 'nmap' | 'csv', text: string, projectId: number, opts: { tag?: string; mapping?: Record<number, HostField> }) => {
      if (kind === 'nmap') return applyImport(this.r(), projectId, parseNmapXml(text), opts.tag)
      const rows = parseCsv(text); return applyImport(this.r(), projectId, csvToHosts(rows, opts.mapping ?? guessMapping(rows[0] ?? [])), opts.tag)
    },
    'import.sliver': (projectId: number, opts: { config?: string; tag?: string }) =>
      applyImport(this.r(), projectId, fetchSliverHosts({ config: opts.config }), opts.tag),
    'import.sliverConfigs': () => listSliverConfigs(),
    'sliver.get': (hostId: number) => this.r().getSliver(hostId) ?? null,
    'sliver.sync': (projectId: number, opts: { config?: string; tag?: string } = {}) => this.syncSliver(projectId, opts),
    'sliver.ping': (hostId: number) => this.sliverPing(hostId),
    'sliver.exec': (hostId: number, command: string[]) => this.sliverExec(hostId, command),
    'sliver.shellArgv': (hostId: number) => this.sliverShellArgv(hostId),
    'export.render': (fmt: 'json' | 'csv' | 'md', f: Filter, includeSecrets: boolean, ids?: number[]) =>
      ({ json: exportJson, csv: exportCsv, md: exportMarkdown })[fmt](this.r(), f, { includeSecrets }, ids),
  }

  private binding(hostId: number) {
    const b = this.r().getSliver(hostId)
    if (!b) throw new Error('Host has no Sliver binding — import/sync from Sliver first')
    return b
  }
  syncSliver(projectId: number, opts: { config?: string; tag?: string } = {}) {
    const cfg = opts.config || (this.r().getSettings().sliverConfig as string | undefined) || undefined
    return applyImport(this.r(), projectId, fetchSliverHosts({ config: cfg }), opts.tag)
  }
  /** Sync every distinct config that already has bindings (background timer). */
  syncBoundSliver(projectId: number) {
    const bindings = this.r().listSliverBindings()
    const configs = [...new Set(bindings.map(b => b.configPath).filter(Boolean))]
    const setting = this.r().getSettings().sliverConfig as string | undefined
    const targets = configs.length ? configs : setting ? [setting] : listSliverConfigs().length === 1 ? listSliverConfigs() : []
    if (!targets.length) return { created: 0, updated: 0, services: 0, credentials: 0, skipped: 0, configs: 0 }
    let created = 0, updated = 0, services = 0, credentials = 0, skipped = 0
    for (const config of targets) {
      const r = applyImport(this.r(), projectId, fetchSliverHosts({ config }))
      created += r.created; updated += r.updated; services += r.services; credentials += r.credentials; skipped += r.skipped
    }
    return { created, updated, services, credentials, skipped, configs: targets.length }
  }
  sliverPing(hostId: number) {
    const b = this.binding(hostId)
    const r = pingImplant(b.implantId, { config: b.configPath || undefined })
    this.r().setStatus(hostId, r.ok ? 'online' : 'offline', true)
    this.r().upsertSliver(hostId, { implantId: b.implantId, name: b.name, kind: b.kind, configPath: b.configPath, health: r.ok ? '[ALIVE]' : '[DEAD]', lastMessage: r.ms != null ? `${r.ms}ms` : r.output.slice(0, 120) })
    return r
  }
  sliverExec(hostId: number, command: string[]) {
    const b = this.binding(hostId)
    if (b.kind !== 'session') throw new Error('Execute needs an interactive session (beacon has no live shell)')
    return execImplant(b.implantId, command, { config: b.configPath || undefined })
  }
  sliverShellArgv(hostId: number) {
    const b = this.binding(hostId)
    if (b.kind !== 'session') throw new Error('Shell needs an interactive session')
    return shellArgv(b.implantId, { config: b.configPath || undefined })
  }

  backupTo(dest: string) { backupVault(this.r().db, dest) }
  readFile(p: string) { return fs.readFileSync(p, 'utf8') }
}
