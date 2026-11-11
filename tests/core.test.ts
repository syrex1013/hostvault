import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { openVault, rekey, WrongPasswordError } from '../src/core/db'
import { Repo } from '../src/core/repo'
import { parseNmapXml } from '../src/core/import/nmap'
import { csvToHosts, guessMapping, parseCsv, csvEscape } from '../src/core/import/csv'
import { parseSliverOutput } from '../src/core/import/sliver'
import { applyImport } from '../src/core/import/apply'
import { exportCsv, exportJson, exportMarkdown } from '../src/core/export'
import { buildConnect } from '../src/core/connect'
import { checkHosts, tcpProbe } from '../src/core/probe'

let dir: string, file: string, repo: Repo, pid: number
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-'))
  file = path.join(dir, 'v.db')
  repo = new Repo(openVault('pw', file, true)); pid = repo.listProjects()[0].id
})
afterEach(() => { try { repo.db.close() } catch {} fs.rmSync(dir, { recursive: true, force: true }) })

describe('vault', () => {
  it('rejects wrong password and does not leak plaintext', () => {
    repo.addHost({ projectId: pid, ip: '10.0.0.1' })
    const h = repo.listHosts()[0]; repo.addCredential(h.id, { username: 'root', secret: 'TOPSECRET123' })
    repo.db.close()
    expect(() => openVault('nope', file)).toThrow(WrongPasswordError)
    expect(fs.readFileSync(file).includes('TOPSECRET123')).toBe(false)
    repo = new Repo(openVault('pw', file)); expect(repo.listHosts()).toHaveLength(1)
  })
  it('rekeys', () => {
    rekey(repo.db, 'new'); repo.db.close()
    expect(() => openVault('pw', file)).toThrow(WrongPasswordError)
    repo = new Repo(openVault('new', file)); expect(repo.listProjects()).toHaveLength(1)
  })
  it('refuses to create over existing vault', () => { expect(() => openVault('x', file, true)).toThrow(/already exists/) })
})

describe('hosts & filters', () => {
  beforeEach(() => {
    const a = repo.addHost({ projectId: pid, ip: '10.0.0.10', hostname: 'dc01', os: 'Windows Server 2019', status: 'online', access: 'admin' })
    const b = repo.addHost({ projectId: pid, ip: '10.0.0.2', hostname: 'web', os: 'Ubuntu 22.04' })
    const c = repo.addHost({ projectId: pid, ip: '10.0.0.100', status: 'dead' })
    repo.upsertService(a.id, { port: 445, name: 'microsoft-ds' }); repo.upsertService(b.id, { port: 80, name: 'http', product: 'nginx' })
    repo.addTags(a.id, ['AD', 'crown-jewel']); repo.addTags(b.id, ['dmz']); repo.addCredential(a.id, { username: 'Administrator', secret: 'p' })
    repo.addNote(c.id, 'decommissioned in week 2')
  })
  it('sorts IPs numerically', () => { expect(repo.listHosts().map(h => h.ip)).toEqual(['10.0.0.2', '10.0.0.10', '10.0.0.100']) })
  it('filters', () => {
    const ips = (f: any) => repo.listHosts(f).map(h => h.ip)
    expect(ips({ status: ['online'] })).toEqual(['10.0.0.10'])
    expect(ips({ tags: ['ad'] })).toEqual(['10.0.0.10'])
    expect(ips({ tags: ['AD', 'dmz'] })).toEqual([])
    expect(ips({ port: 80 })).toEqual(['10.0.0.2'])
    expect(ips({ service: 'nginx' })).toEqual(['10.0.0.2'])
    expect(ips({ hasCreds: true })).toEqual(['10.0.0.10'])
    expect(ips({ hasCreds: false })).toHaveLength(2)
    expect(ips({ search: 'decommissioned' })).toEqual(['10.0.0.100'])
    expect(ips({ search: 'administrator' })).toEqual(['10.0.0.10'])
    expect(ips({ search: '%' })).toEqual([])
    expect(ips({ os: 'ubuntu' })).toEqual(['10.0.0.2'])
    expect(ips({ access: ['admin'] })).toEqual(['10.0.0.10'])
  })
  it('is injection-safe', () => { expect(() => repo.listHosts({ search: "'; DROP TABLE hosts;--" })).not.toThrow(); expect(repo.listHosts()).toHaveLength(3) })
  it('validates and logs', () => {
    expect(() => repo.addHost({ projectId: pid })).toThrow()
    expect(() => repo.updateHost(1, { status: 'bogus' as any })).toThrow()
    repo.setStatus(1, 'offline'); expect(repo.listActivity(1)[0].detail).toBe('online → offline')
  })
  it('cascades deletes and cleans orphan tags', () => {
    repo.removeTags(2, ['dmz']); expect(repo.listTags().map(t => t.name)).not.toContain('dmz')
    repo.deleteHosts([1]); expect(repo.listServices(1)).toEqual([]); expect(repo.listCredentials(1)).toEqual([])
  })
  it('stats', () => { const s = repo.stats(pid); expect(s.total).toBe(3); expect(s.status.dead).toBe(1); expect(s.withCreds).toBe(1) })
})

const NMAP = `<?xml version="1.0"?><nmaprun><host><status state="up"/><address addr="192.168.1.5" addrtype="ipv4"/><address addr="AA:BB:CC:DD:EE:FF" addrtype="mac"/>
<hostnames><hostname name="srv.local" type="PTR"/></hostnames><ports>
<port protocol="tcp" portid="22"><state state="open"/><service name="ssh" product="OpenSSH" version="8.9"/></port>
<port protocol="tcp" portid="23"><state state="closed"/><service name="telnet"/></port></ports>
<os><osmatch name="Linux 5.X"/></os></host><host><status state="down"/><address addr="192.168.1.9" addrtype="ipv4"/></host></nmaprun>`
describe('import/export', () => {
  it('parses nmap and merges idempotently', () => {
    const hs = parseNmapXml(NMAP); expect(hs).toHaveLength(2)
    expect(hs[0]).toMatchObject({ ip: '192.168.1.5', hostname: 'srv.local', os: 'Linux 5.X', status: 'online' }); expect(hs[0].services).toHaveLength(1)
    expect(applyImport(repo, pid, hs, 'nmap')).toMatchObject({ created: 2 })
    expect(applyImport(repo, pid, hs)).toMatchObject({ created: 0, updated: 2 })
    expect(repo.listHosts()).toHaveLength(2); expect(repo.listServices(repo.findHost('192.168.1.5')!.id)).toHaveLength(1)
  })
  it('does not resurrect dead hosts on import', () => {
    const h = repo.addHost({ projectId: pid, ip: '192.168.1.5', status: 'dead' }); applyImport(repo, pid, parseNmapXml(NMAP))
    expect(repo.getHost(h.id)!.status).toBe('dead')
  })
  it('rejects non-nmap xml', () => { expect(() => parseNmapXml('<a/>')).toThrow() })
  it('parses csv with quotes + mapping', () => {
    const rows = parseCsv('IP Address,Hostname,Tags,Ports,Notes\n10.1.1.1,"a,b",x;y,22;80,"line1\nline2"\n,,,,\n')
    const m = guessMapping(rows[0]); expect(Object.values(m)).toEqual(['ip', 'hostname', 'tags', 'ports', 'note'])
    const hs = csvToHosts(rows, m); expect(hs).toHaveLength(1); expect(hs[0]).toMatchObject({ hostname: 'a,b', tags: ['x', 'y'], ports: [22, 80], note: 'line1\nline2' })
  })
  it('parses sliver beacons+sessions tables; session beats beacon; dead → offline; binds implant id', () => {
    const out = `sliver > beacons\n\nID   Name  Tasks  Transport  Remote Address     Hostname  Username      Operating System  Last Check-in  Next Check-in\n==== ===== ====== ========== ================== ========= ============= ================== ============= ==============\nb1a2b3  N1    0/1    mtls       10.0.0.5:8888        DC01      CORP\\admin   windows/amd64     1m ago         2m\nb2c3d4  N2    0/0    mtls       10.0.0.9:8888        WS-X      WS-X\\svc     linux/amd64       3m ago         5m\n\nsliver > sessions\n\nID   Name  Transport  Remote Address     Hostname  Username      Operating System  Health\n==== ===== ========== ================== ========= ============= ================== ========\ns1e2f3  T1    mtls       10.0.0.5:8888        DC01      CORP\\admin   windows/amd64     [ALIVE]\ns2a3b4  T2    mtls       10.0.0.7:8888        WS02      WS02\\bob     linux/amd64       [DEAD]\n`
    const hs = parseSliverOutput(out, '/tmp/op.cfg')
    expect(hs).toHaveLength(3)
    const dc = hs.find(h => h.hostname === 'DC01')!
    expect(dc.tags).toContain('session'); expect(dc.status).toBe('online'); expect(dc.note).toContain('CORP\\admin')
    expect(dc.sliverId).toBe('s1e2f3'); expect(dc.sliverName).toBe('T1'); expect(dc.sliverKind).toBe('session'); expect(dc.sliverConfig).toBe('/tmp/op.cfg')
    expect(hs.find(h => h.hostname === 'WS02')!.status).toBe('offline')
    expect(applyImport(repo, pid, hs, 'eng')).toMatchObject({ created: 3 })
    const h = repo.findHost('10.0.0.5')!
    expect(h.tags.sort()).toEqual(['eng', 'session', 'sliver'].sort())
    const bind = repo.getSliver(h.id)!
    expect(bind.implantId).toBe('s1e2f3'); expect(bind.kind).toBe('session'); expect(bind.name).toBe('T1')
    // re-sync matches by implant id, does not create duplicates
    expect(applyImport(repo, pid, hs)).toMatchObject({ created: 0, updated: 3 })
    expect(repo.findHostBySliver('s1e2f3', '/tmp/op.cfg', pid)?.id).toBe(h.id)
  })
  it('keeps distinct implants that share a NAT address apart', () => {
    const out = `sliver > sessions

ID      Name  Transport  Remote Address  Hostname  Username   Operating System  Health
======= ===== ========== =============== ========= ========== ================== ========
aaaa111 A     mtls       10.0.0.5:8888   worker1   w1\\a      linux/amd64        [ALIVE]
bbbb222 B     mtls       10.0.0.5:8888   worker2   w2\\b      linux/amd64        [ALIVE]
`
    const hs = parseSliverOutput(out, '/tmp/nat.cfg')
    expect(hs).toHaveLength(2)
    expect(applyImport(repo, pid, hs)).toMatchObject({ created: 2, updated: 0 })
    expect(repo.listHosts().map(h => h.hostname).sort()).toEqual(['worker1', 'worker2'])
    expect(applyImport(repo, pid, hs)).toMatchObject({ created: 0, updated: 2 })
    expect(repo.listHosts()).toHaveLength(2)
  })
  it('redacts secrets by default and neutralises csv formulas', () => {
    const h = repo.addHost({ projectId: pid, ip: '1.1.1.1', hostname: '=cmd|calc' }); repo.addCredential(h.id, { username: 'u', secret: 'S3CRET' })
    for (const out of [exportJson(repo), exportCsv(repo), exportMarkdown(repo)]) expect(out).not.toContain('S3CRET')
    expect(exportJson(repo, {}, { includeSecrets: true })).toContain('S3CRET')
    expect(exportCsv(repo)).toContain("'=cmd|calc"); expect(csvEscape('@x')).toBe("'@x")
  })
})

describe('connect', () => {
  it('never embeds secrets and rejects option-injection targets', () => {
    const c = buildConnect('ssh', { ip: '10.0.0.5', hostname: '' }, { port: 2222 }, { username: 'root', domain: '', kind: 'password', secret: 'hunter2' })
    expect(c.argv).toEqual(['ssh', '-p', '2222', 'root@10.0.0.5']); expect(c.display).not.toContain('hunter2'); expect(c.needsPassword).toBe(true)
    expect(() => buildConnect('ssh', { ip: '-oProxyCommand=x', hostname: '' })).toThrow()
    expect(buildConnect('ssh', { ip: '', hostname: 'a' }, undefined, { username: "o'brien", domain: '', kind: 'password', secret: '' }).display).toBe("ssh 'o'\\''brien@a'")
  })
})

describe('probe', () => {
  it('detects open and closed ports and updates status', async () => {
    const srv = net.createServer(s => s.end()); await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
    const port = (srv.address() as net.AddressInfo).port
    expect(await tcpProbe('127.0.0.1', port, 1000)).toBe(true)
    const h = repo.addHost({ projectId: pid, ip: '127.0.0.1' }); const d = repo.addHost({ projectId: pid, ip: '127.0.0.2', status: 'dead' })
    repo.upsertService(h.id, { port })
    const res = await checkHosts(repo, [h.id, d.id], { ping: false, ports: [port], timeoutMs: 800 })
    expect(res).toEqual([{ id: h.id, status: 'online' }]); expect(repo.getHost(h.id)!.status).toBe('online'); expect(repo.getHost(d.id)!.status).toBe('dead')
    srv.close()
  })
})

describe('host url', () => {
  it('round-trips, is searchable, and rejects non-http(s)', () => {
    const h = repo.addHost({ projectId: pid, ip: '10.0.0.9', url: ' https://10.0.0.9:8443/admin ' })
    expect(h.url).toBe('https://10.0.0.9:8443/admin')
    expect(repo.listHosts({ search: '8443' })).toHaveLength(1)
    expect(repo.updateHost(h.id, { url: '' }).url).toBe('')
    for (const u of ['javascript:alert(1)', 'file:///etc/passwd', 'nope']) expect(() => repo.updateHost(h.id, { url: u })).toThrow(/URL/)
  })
})

describe('ping only', () => {
  it('skips TCP probing', async () => {
    const srv = net.createServer(); await new Promise<void>(r => srv.listen(0, '127.0.0.1', r)); const port = (srv.address() as net.AddressInfo).port
    const h = repo.addHost({ projectId: pid, ip: '127.0.0.1' }); repo.upsertService(h.id, { port })
    const res = await checkHosts(repo, [h.id], { pingOnly: true, timeoutMs: 800 })
    expect(res).toHaveLength(1); expect(['online', 'offline']).toContain(res[0].status)
    srv.close()
  })
})

describe('partial updates', () => {
  it('ignores undefined fields (as sent over IPC / from CLI flags)', () => {
    const h = repo.addHost({ projectId: pid, ip: '10.9.9.9', hostname: 'keep', os: 'Linux' })
    const u = repo.updateHost(h.id, { ip: undefined, hostname: undefined, os: 'BSD' })
    expect(u).toMatchObject({ ip: '10.9.9.9', hostname: 'keep', os: 'BSD' })
    const c = repo.addCredential(h.id, { username: 'a', secret: 'keepme' })
    expect(repo.updateCredential(c.id, { username: 'b', secret: undefined }).secret).toBe('keepme')
  })
})
