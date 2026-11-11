const { chromium } = require('playwright')
const OUT = process.env.OUT, URL = 'http://localhost:5199/'
const rpc = (method, ...args) => fetch(URL + 'rpc', { method: 'POST', body: JSON.stringify({ method, args }) }).then(r => r.json()).then(r => { if (!r.ok) throw new Error(method + ': ' + r.error); return r.data })
const SHIM = () => {
  const call = async (m, ...a) => { const r = await (await fetch('/rpc', { method: 'POST', body: JSON.stringify({ method: m, args: a }) })).json(); if (!r.ok) { const e = new Error(r.error); e.name = r.code; throw e } return r.data }
  const clip = { v: '' }; window.__clip = clip
  window.hv = { call, activity: async () => {}, copy: async t => { clip.v = t }, copyCred: async id => { clip.v = await (await fetch('/cred', { method: 'POST', body: JSON.stringify({ id }) })).json(); return true },
    openFile: async () => window.__file ?? null, saveFile: async (n, t) => { window.__saved = { n, t }; return '/tmp/' + n }, backup: async () => null, revealVault: async () => {}, openTerminal: async () => false, installCli: async () => ({ ok: true, path: '/usr/local/bin/hv' }), onLocked: () => () => {}, platform: 'darwin' }
}
const NMAP = `<?xml version="1.0"?><nmaprun><host><status state="up"/><address addr="10.20.0.77" addrtype="ipv4"/><hostnames><hostname name="files.corp.local" type="PTR"/></hostnames><ports><port protocol="tcp" portid="445"><state state="open"/><service name="microsoft-ds"/></port><port protocol="tcp" portid="22"><state state="open"/><service name="ssh" product="OpenSSH" version="9.2"/></port></ports><os><osmatch name="Linux 5.15"/></os></host></nmaprun>`
let step = 'start'; const fails = []; const check = (c, m) => { if (!c) { fails.push(step + ': ' + m); console.log('  ✗', m) } else console.log('  ✓', m) }
;(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 }); await ctx.addInitScript(SHIM)
  const p = await ctx.newPage(); const errors = []; p.on('console', m => m.type() === 'error' && errors.push(m.text())); p.on('pageerror', e => errors.push('pageerror: ' + e.message))
  await p.goto(URL); const shot = n => p.screenshot({ path: `${OUT}/${n}.png` })

  step = 'create vault'; console.log(step)
  await p.getByText('Create your encrypted vault').waitFor(); await shot('01-create')
  await p.fill('#pw', 'short'); await p.fill('#pw2', 'short'); await p.getByRole('button', { name: 'Create vault' }).click()
  check(await p.getByRole('alert').textContent().then(t => /8 characters/.test(t)), 'short password rejected')
  await p.fill('#pw', 'Tr0ub4dor&3-horse'); await p.fill('#pw2', 'mismatch'); await p.getByRole('button', { name: 'Create vault' }).click()
  check(await p.getByRole('alert').textContent().then(t => /do not match/.test(t)), 'mismatch rejected')
  await p.fill('#pw2', 'Tr0ub4dor&3-horse'); await p.getByRole('button', { name: 'Create vault' }).click()
  await p.getByRole('heading', { name: 'Hosts' }).waitFor(); check(true, 'vault created and unlocked')

  step = 'seed'; console.log(step)
  const pid = (await rpc('projects.list'))[0].id
  const seed = [['10.20.0.5', 'dc01.corp.local', 'Windows Server 2019', 'online', 'admin', ['ad', 'crown-jewel'], [445, 389, 3389]], ['10.20.0.10', 'web01', 'Ubuntu 22.04', 'online', 'user', ['dmz', 'web'], [22, 80, 443]], ['10.20.0.11', 'web02', 'Ubuntu 20.04', 'offline', 'none', ['dmz', 'web'], [22, 80]], ['10.20.0.20', 'db01', 'Debian 12', 'unknown', 'root', ['db'], [22, 3306]], ['10.20.0.30', '', 'Windows 10', 'dead', 'none', ['workstation'], [445]], ['10.20.0.40', 'printer', 'Embedded', 'unknown', 'none', [], [9100]]]
  for (const [ip, hn, os, status, access, tags, ports] of seed) { const h = await rpc('hosts.add', { projectId: pid, ip, hostname: hn, os, status, access }); if (tags.length) await rpc('tags.add', [h.id], tags); for (const port of ports) await rpc('services.upsert', h.id, { port, name: { 22: 'ssh', 80: 'http', 445: 'microsoft-ds', 3389: 'ms-wbt-server', 3306: 'mysql' }[port] ?? '' }) }
  const dc = (await rpc('hosts.list', { search: 'dc01' }))[0]
  await rpc('creds.add', dc.id, { username: 'Administrator', domain: 'CORP', secret: 'Winter2026!', kind: 'password', valid: true, source: 'kerberoast' }); await rpc('notes.add', dc.id, '## Foothold\nGot DA via **kerberoasting** `svc_sql`.\n\n<script>window.__xss=1</script><img src=x onerror="window.__xss=2">', true)
  await p.reload(); await p.getByText('dc01.corp.local').waitFor()

  step = 'list'; console.log(step); await p.waitForTimeout(700); await shot('02-hosts')
  const rows = () => p.locator('tbody tr').count()
  const rowsEq = async n => { for (let i = 0; i < 30; i++) { if (await rows() === n) return true; await p.waitForTimeout(100) } return false }
  check(await rowsEq(6), '6 hosts listed'); const ips = await p.locator('tbody tr td:nth-child(4) .font-mono').allTextContents()
  check(ips.join() === '10.20.0.5,10.20.0.10,10.20.0.11,10.20.0.20,10.20.0.30,10.20.0.40', 'IPs sorted numerically: ' + ips.join())

  step = 'search/filter'; console.log(step)
  await p.fill('#search', 'kerberoast'); await p.waitForTimeout(500); check(await rowsEq(1), 'note-text search finds dc01')
  await p.fill('#search', ''); await p.waitForTimeout(500)
  await p.getByRole('button', { name: /Filters/ }).click(); await p.getByRole('button', { name: 'Online', exact: true }).click(); await p.waitForTimeout(400); check(await rowsEq(2), 'status filter online → 2')
  await p.getByPlaceholder('445').fill('80'); await p.waitForTimeout(400); check(await rowsEq(1), 'port 80 + online → 1'); await shot('03-filters')
  await p.getByRole('button', { name: 'Reset' }).click(); await p.waitForTimeout(400); await p.keyboard.press('Escape'); await p.mouse.click(700, 500)
  await p.locator('aside').getByRole('button', { name: /web/ }).click(); await p.waitForTimeout(400); check(await rowsEq(2), 'sidebar tag #web → 2'); await p.locator('aside').getByRole('button', { name: 'All hosts' }).click(); await p.waitForTimeout(400)

  step = 'detail'; console.log(step)
  await p.locator('tbody tr', { hasText: 'dc01' }).click(); await p.getByLabel('Host details').waitFor(); await p.getByLabel('Host details').getByRole('button', { name: /^Access/ }).click()
  await p.getByText('CORP\\Administrator').waitFor(); check(await p.getByText('Winter2026!').count() === 0, 'secret masked by default'); await shot('04-access')
  await p.getByLabel('Reveal secret').click(); await p.getByText('Winter2026!').waitFor(); check(true, 'reveal shows secret'); await p.getByLabel('Hide secret').click()
  await p.getByLabel('Copy secret').click(); await p.waitForTimeout(300); check(await p.evaluate(() => window.__clip.v) === 'Winter2026!', 'copy puts secret on clipboard')
  await p.getByRole('button', { name: 'Add access data' }).click(); await p.getByLabel('Host details').locator('input.font-mono').last().fill('hunter2')
  await p.getByRole('button', { name: 'Cancel' }).click()
  await p.getByLabel('Host details').getByRole('button', { name: /^Notes/ }).click(); await p.getByText('Foothold').waitFor(); await shot('05-notes')
  check(await p.evaluate(() => !window.__xss) , 'markdown note sanitised (no script/onerror executed)')
  await p.getByLabel('Host details').getByRole('button', { name: 'Services' }).click(); await p.getByText('445/tcp').first().waitFor().catch(() => {}); check(await p.getByText('445/tcp').count() > 0, 'services tab lists ports')
  await p.getByLabel('Host details').getByRole('button', { name: 'Overview' }).click(); await p.getByRole('radio', { name: /Offline/ }).click(); await p.waitForTimeout(400)
  check(await p.locator('tbody tr', { hasText: 'dc01' }).getByText('Offline').count() === 1, 'status change via segmented control'); await p.getByLabel('Host details').getByRole('button', { name: 'Activity' }).click(); await p.waitForTimeout(500); check(await p.getByText('online → offline').count() > 0, 'activity logged')
  await p.getByLabel('Close panel').click()

  step = 'add host dialog'; console.log(step)
  await p.getByRole('button', { name: 'Add host' }).first().click(); await p.getByRole('button', { name: 'Add host' }).last().click(); await p.waitForTimeout(300); check(await p.getByRole('alert').count() === 1, 'empty host rejected with message')
  await p.getByPlaceholder('10.10.10.5').fill('10.20.0.99'); await p.getByPlaceholder('dmz, web').fill('new'); await p.getByRole('button', { name: 'Add host' }).last().click(); await p.getByText('10.20.0.99').first().waitFor(); check(true, 'host added through dialog')
  await p.getByLabel('Close panel').click()

  step = 'import'; console.log(step)
  await p.evaluate(x => { window.__file = { name: 'scan.xml', text: x } }, NMAP); await p.getByRole('button', { name: /Import/ }).first().click(); await p.getByText('Choose an Nmap XML').click(); await p.getByText('host(s) found').waitFor(); await shot('06-import')
  await p.getByRole('button', { name: /^Import 1 host/ }).click(); await p.getByText('files.corp.local').waitFor(); check(true, 'nmap import added host')

  step = 'export'; console.log(step)
  await p.getByRole('button', { name: /Export/ }).first().click(); await p.getByRole('button', { name: /Markdown/ }).click(); await p.getByRole('button', { name: /^Export \d+/ }).click(); await p.waitForTimeout(500)
  const saved = await p.evaluate(() => window.__saved); check(saved && /^hosts-.*\.md$/.test(saved.n) && saved.t.includes('dc01') && !saved.t.includes('Winter2026!') && saved.t.includes('redacted'), 'markdown export redacts secrets')

  step = 'check + connect'; console.log(step)
  await p.locator('tbody tr', { hasText: '10.20.0.99' }).locator('input[type=checkbox]').check(); await p.getByRole('button', { name: 'Check', exact: false }).filter({ hasText: /^Check/ }).first().click().catch(() => {}); await p.waitForTimeout(2500)
  check(await p.locator('tbody tr', { hasText: '10.20.0.99' }).getByText(/Offline|Online|Checking/).count() === 1, 'on-demand check updated status'); await shot('07-bulk')
  await p.getByLabel('Clear selection').click(); await p.locator('tbody tr', { hasText: 'web01' }).click(); await p.getByTitle('Quick connect').click(); await p.getByText('$ ').first().waitFor(); const cmd = await p.locator('pre').textContent(); check(/ssh|open|xfreerdp/.test(cmd), 'connect builds a command: ' + cmd.trim()); await shot('08-connect'); await p.keyboard.press('Escape'); await p.waitForTimeout(800); await p.getByLabel('Close panel').click()

  step = 'dashboard/palette/settings'; console.log(step)
  await p.keyboard.press('Control+k'); await p.getByPlaceholder('Type a command or host…').fill('dash'); await p.keyboard.press('Enter'); await p.getByRole('heading', { name: 'Dashboard' }).waitFor(); await p.waitForTimeout(1000); await shot('09-dashboard')
  await p.locator('aside').getByRole('button', { name: 'All hosts' }).click(); await p.getByLabel('Settings').click(); await p.getByText('Auto-lock after idle').waitFor(); await shot('10-settings'); await p.keyboard.press('Escape')

  step = 'responsive'; console.log(step)
  await p.setViewportSize({ width: 420, height: 800 }); await p.waitForTimeout(500); await shot('11-narrow'); check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page scroll at 420px')
  await p.getByLabel('Toggle sidebar').first().click(); await p.waitForTimeout(400); await shot('12-narrow-sidebar'); await p.mouse.click(400, 400)
  await p.setViewportSize({ width: 1360, height: 860 })

  step = 'lock'; console.log(step)
  await p.getByLabel('Lock vault').click(); await p.getByText('Vault is locked').waitFor(); await p.fill('#pw', 'wrong-password'); await p.getByRole('button', { name: 'Unlock' }).click(); await p.getByRole('alert').waitFor(); check(/Wrong master password/.test(await p.getByRole('alert').textContent()), 'wrong password rejected'); await shot('13-locked')
  await p.fill('#pw', 'Tr0ub4dor&3-horse'); await p.getByRole('button', { name: 'Unlock' }).click(); await p.getByRole('heading', { name: 'Hosts' }).waitFor(); check(true, 're-unlock works')
  check(errors.filter(e => !/favicon/.test(e)).length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''))
  await b.close(); console.log(fails.length ? `\nFAILED (${fails.length})\n` + fails.join('\n') : '\nALL OK'); process.exit(fails.length ? 1 : 0)
})().catch(e => { console.error('CRASH at', step, e.message.split('\n').slice(0, 6).join('\n')); process.exit(2) })
