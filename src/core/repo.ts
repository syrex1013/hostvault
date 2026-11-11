import type { DB } from './db'
import { buildOrder, buildWhere } from './filter'
import {
  ACCESS_LEVELS, CRED_KINDS, STATUSES,
  type Activity, type Credential, type Filter, type Host, type HostInput, type HostSliver, type Note,
  type Project, type SavedFilter, type Service, type Status, type Tag,
} from './types'

const b = (v: unknown) => (v == null ? null : !!v)
const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

export class Repo {
  constructor(public db: DB) {}

  // ---------- projects ----------
  private mapProject = (r: any): Project => ({
    id: r.id, name: r.name, client: r.client, scope: r.scope, startDate: r.start_date, endDate: r.end_date,
    color: r.color, archived: !!r.archived, createdAt: r.created_at,
  })
  listProjects(includeArchived = true): Project[] {
    return this.db.prepare(`SELECT * FROM projects ${includeArchived ? '' : 'WHERE archived=0'} ORDER BY archived, name COLLATE NOCASE`).all().map(this.mapProject)
  }
  getProject(idOrName: number | string): Project | undefined {
    const r = typeof idOrName === 'number'
      ? this.db.prepare('SELECT * FROM projects WHERE id=?').get(idOrName)
      : this.db.prepare('SELECT * FROM projects WHERE name=? COLLATE NOCASE').get(idOrName)
    return r ? this.mapProject(r) : undefined
  }
  addProject(p: Partial<Project> & { name: string }): Project {
    if (!p.name.trim()) throw new Error('Project name required')
    const id = this.db.prepare(`INSERT INTO projects (name, client, scope, start_date, end_date, color) VALUES (?,?,?,?,?,?)`)
      .run(p.name.trim(), p.client ?? '', p.scope ?? '', p.startDate ?? null, p.endDate ?? null, p.color ?? '#DC2626').lastInsertRowid
    return this.getProject(Number(id))!
  }
  updateProject(id: number, p: Partial<Project>): Project {
    const cur = this.getProject(id); if (!cur) throw new Error('Project not found')
    const m = { ...cur, ...defined(p) }
    this.db.prepare(`UPDATE projects SET name=?, client=?, scope=?, start_date=?, end_date=?, color=?, archived=? WHERE id=?`)
      .run(m.name, m.client, m.scope, m.startDate, m.endDate, m.color, m.archived ? 1 : 0, id)
    return this.getProject(id)!
  }
  deleteProject(id: number) {
    if (this.listProjects().length <= 1) throw new Error('Cannot delete the last project')
    this.db.prepare('DELETE FROM projects WHERE id=?').run(id)
  }

  // ---------- hosts ----------
  private hostSelect = `
    SELECT h.*,
      (SELECT group_concat(t.name, char(31)) FROM host_tags ht JOIN tags t ON t.id=ht.tag_id WHERE ht.host_id=h.id) AS tag_list,
      (SELECT count(*) FROM services s WHERE s.host_id=h.id) AS svc_n,
      (SELECT count(*) FROM credentials c WHERE c.host_id=h.id) AS cred_n,
      (SELECT count(*) FROM notes n WHERE n.host_id=h.id) AS note_n
    FROM hosts h`
  private mapHost = (r: any): Host => ({
    id: r.id, projectId: r.project_id, ip: r.ip, hostname: r.hostname, mac: r.mac, os: r.os, url: r.url,
    status: r.status, access: r.access, favorite: !!r.favorite,
    firstSeen: r.first_seen, lastSeen: r.last_seen, lastChecked: r.last_checked,
    tags: r.tag_list ? String(r.tag_list).split('\x1f').sort((a, b) => a.localeCompare(b)) : [],
    serviceCount: r.svc_n, credCount: r.cred_n, noteCount: r.note_n,
  })
  listHosts(f: Filter = {}): Host[] {
    const { where, params } = buildWhere(f)
    const lim = f.limit ? ` LIMIT ${Math.max(1, Math.floor(f.limit))}` : ''
    return this.db.prepare(`${this.hostSelect} ${where} ${buildOrder(f)}${lim}`).all(...params).map(this.mapHost)
  }
  getHost(id: number): Host | undefined {
    const r = this.db.prepare(`${this.hostSelect} WHERE h.id=?`).get(id)
    return r ? this.mapHost(r) : undefined
  }
  /** Resolve by numeric id, IP or hostname (optionally within a project). */
  findHost(ref: string | number, projectId?: number | null): Host | undefined {
    if (typeof ref === 'number' || /^#\d+$/.test(String(ref))) return this.getHost(Number(String(ref).replace('#', '')))
    const proj = projectId != null ? 'AND h.project_id=?' : ''
    const args: unknown[] = [ref, ref]; if (projectId != null) args.push(projectId)
    const r = this.db.prepare(`${this.hostSelect} WHERE (h.ip=? OR h.hostname=? COLLATE NOCASE) ${proj} ORDER BY h.id LIMIT 1`).get(...args)
    return r ? this.mapHost(r) : undefined
  }
  private validateHost(i: HostInput) {
    if (i.status && !STATUSES.includes(i.status)) throw new Error(`Invalid status: ${i.status}`)
    if (i.access && !ACCESS_LEVELS.includes(i.access)) throw new Error(`Invalid access level: ${i.access}`)
    if (i.url?.trim()) { try { if (!/^https?:$/.test(new URL(i.url.trim()).protocol)) throw 0 } catch { throw new Error('URL must be http(s)://…') } }
  }
  addHost(i: HostInput & { projectId: number }): Host {
    this.validateHost(i)
    if (!(i.ip || '').trim() && !(i.hostname || '').trim()) throw new Error('Host needs an IP or a hostname')
    const id = this.db.prepare(`INSERT INTO hosts (project_id, ip, hostname, mac, os, url, status, access, favorite) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(i.projectId, (i.ip ?? '').trim(), (i.hostname ?? '').trim(), i.mac ?? '', i.os ?? '', (i.url ?? '').trim(), i.status ?? 'unknown', i.access ?? 'none', i.favorite ? 1 : 0).lastInsertRowid
    this.log(Number(id), 'created', 'Host added')
    return this.getHost(Number(id))!
  }
  updateHost(id: number, i: HostInput): Host {
    this.validateHost(i)
    const cur = this.getHost(id); if (!cur) throw new Error('Host not found')
    const m = { ...cur, ...defined(i) }
    if (!m.ip.trim() && !m.hostname.trim()) throw new Error('Host needs an IP or a hostname')
    this.db.prepare(`UPDATE hosts SET project_id=?, ip=?, hostname=?, mac=?, os=?, url=?, status=?, access=?, favorite=?, last_seen=? WHERE id=?`)
      .run(m.projectId, m.ip.trim(), m.hostname.trim(), m.mac, m.os, m.url.trim(), m.status, m.access, m.favorite ? 1 : 0, now(), id)
    if (i.status && i.status !== cur.status) this.log(id, 'status', `${cur.status} → ${i.status}`)
    if (i.access && i.access !== cur.access) this.log(id, 'access', `${cur.access} → ${i.access}`)
    const other = (['ip', 'hostname', 'mac', 'os', 'url', 'projectId'] as const).filter(k => i[k] !== undefined && i[k] !== cur[k])
    if (other.length) this.log(id, 'edit', `Changed ${other.join(', ')}`)
    return this.getHost(id)!
  }
  setStatus(id: number, status: Status, checked = false) {
    if (!STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`)
    const cur = this.getHost(id); if (!cur) throw new Error('Host not found')
    this.db.prepare(`UPDATE hosts SET status=?, last_checked=CASE WHEN ? THEN ? ELSE last_checked END WHERE id=?`)
      .run(status, checked ? 1 : 0, now(), id)
    if (cur.status !== status) this.log(id, checked ? 'check' : 'status', `${cur.status} → ${status}`)
    else if (checked) this.log(id, 'check', `Still ${status}`)
  }
  deleteHosts(ids: number[]) {
    const st = this.db.prepare('DELETE FROM hosts WHERE id=?')
    this.db.transaction(() => ids.forEach(i => st.run(i)))()
  }
  bulkSetStatus(ids: number[], status: Status) { this.db.transaction(() => ids.forEach(i => this.setStatus(i, status)))() }

  // ---------- services ----------
  private mapSvc = (r: any): Service => ({ id: r.id, hostId: r.host_id, port: r.port, protocol: r.protocol, name: r.name, product: r.product, version: r.version, state: r.state })
  listServices(hostId: number): Service[] {
    return this.db.prepare('SELECT * FROM services WHERE host_id=? ORDER BY port').all(hostId).map(this.mapSvc)
  }
  upsertService(hostId: number, s: Partial<Service> & { port: number }): Service {
    if (!Number.isInteger(s.port) || s.port < 0 || s.port > 65535) throw new Error('Invalid port')
    const proto = s.protocol ?? 'tcp'
    this.db.prepare(`INSERT INTO services (host_id, port, protocol, name, product, version, state) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(host_id, port, protocol) DO UPDATE SET name=excluded.name, product=excluded.product, version=excluded.version, state=excluded.state`)
      .run(hostId, s.port, proto, s.name ?? '', s.product ?? '', s.version ?? '', s.state ?? 'open')
    return this.mapSvc(this.db.prepare('SELECT * FROM services WHERE host_id=? AND port=? AND protocol=?').get(hostId, s.port, proto))
  }
  deleteService(id: number) { this.db.prepare('DELETE FROM services WHERE id=?').run(id) }

  // ---------- credentials ----------
  private mapCred = (r: any): Credential => ({
    id: r.id, hostId: r.host_id, serviceId: r.service_id, kind: r.kind, username: r.username, secret: r.secret,
    domain: r.domain, valid: b(r.valid), source: r.source, lastVerified: r.last_verified, createdAt: r.created_at,
  })
  listCredentials(hostId: number): Credential[] {
    return this.db.prepare('SELECT * FROM credentials WHERE host_id=? ORDER BY id').all(hostId).map(this.mapCred)
  }
  getCredential(id: number): Credential | undefined {
    const r = this.db.prepare('SELECT * FROM credentials WHERE id=?').get(id); return r ? this.mapCred(r) : undefined
  }
  addCredential(hostId: number, c: Partial<Credential>): Credential {
    const kind = c.kind ?? 'password'
    if (!CRED_KINDS.includes(kind)) throw new Error(`Invalid credential kind: ${kind}`)
    const id = this.db.prepare(`INSERT INTO credentials (host_id, service_id, kind, username, secret, domain, valid, source) VALUES (?,?,?,?,?,?,?,?)`)
      .run(hostId, c.serviceId ?? null, kind, c.username ?? '', c.secret ?? '', c.domain ?? '', c.valid == null ? null : c.valid ? 1 : 0, c.source ?? '').lastInsertRowid
    this.log(hostId, 'credential', `Added ${kind} for ${c.username || '(no user)'}`)
    return this.getCredential(Number(id))!
  }
  updateCredential(id: number, c: Partial<Credential>): Credential {
    const cur = this.getCredential(id); if (!cur) throw new Error('Credential not found')
    const m = { ...cur, ...defined(c) }
    if (!CRED_KINDS.includes(m.kind)) throw new Error(`Invalid credential kind: ${m.kind}`)
    this.db.prepare(`UPDATE credentials SET service_id=?, kind=?, username=?, secret=?, domain=?, valid=?, source=?, last_verified=? WHERE id=?`)
      .run(m.serviceId, m.kind, m.username, m.secret, m.domain, m.valid == null ? null : m.valid ? 1 : 0, m.source, m.lastVerified, id)
    this.log(cur.hostId, 'credential', `Updated ${m.kind} for ${m.username || '(no user)'}`)
    return this.getCredential(id)!
  }
  deleteCredential(id: number) {
    const c = this.getCredential(id); if (!c) return
    this.db.prepare('DELETE FROM credentials WHERE id=?').run(id)
    this.log(c.hostId, 'credential', `Removed ${c.kind} for ${c.username || '(no user)'}`)
  }

  // ---------- notes ----------
  private mapNote = (r: any): Note => ({ id: r.id, hostId: r.host_id, body: r.body, pinned: !!r.pinned, createdAt: r.created_at, updatedAt: r.updated_at })
  listNotes(hostId: number): Note[] {
    return this.db.prepare('SELECT * FROM notes WHERE host_id=? ORDER BY pinned DESC, updated_at DESC, id DESC').all(hostId).map(this.mapNote)
  }
  addNote(hostId: number, body: string, pinned = false): Note {
    if (!body.trim()) throw new Error('Note is empty')
    const id = this.db.prepare('INSERT INTO notes (host_id, body, pinned) VALUES (?,?,?)').run(hostId, body, pinned ? 1 : 0).lastInsertRowid
    this.log(hostId, 'note', 'Note added')
    return this.mapNote(this.db.prepare('SELECT * FROM notes WHERE id=?').get(id))
  }
  updateNote(id: number, p: { body?: string; pinned?: boolean }): Note {
    const r: any = this.db.prepare('SELECT * FROM notes WHERE id=?').get(id); if (!r) throw new Error('Note not found')
    this.db.prepare('UPDATE notes SET body=?, pinned=?, updated_at=? WHERE id=?').run(p.body ?? r.body, (p.pinned ?? !!r.pinned) ? 1 : 0, now(), id)
    return this.mapNote(this.db.prepare('SELECT * FROM notes WHERE id=?').get(id))
  }
  deleteNote(id: number) { this.db.prepare('DELETE FROM notes WHERE id=?').run(id) }

  // ---------- tags ----------
  listTags(projectId?: number | null): Tag[] {
    const scope = projectId != null ? 'AND h.project_id=?' : ''
    return this.db.prepare(`SELECT t.id, t.name, t.color,
      (SELECT count(*) FROM host_tags ht JOIN hosts h ON h.id=ht.host_id WHERE ht.tag_id=t.id ${scope}) AS count
      FROM tags t ORDER BY t.name COLLATE NOCASE`).all(...(projectId != null ? [projectId] : [])) as Tag[]
  }
  addTags(hostId: number, names: string[]) {
    this.db.transaction(() => {
      for (const raw of names) {
        const n = raw.trim(); if (!n) continue
        this.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(n)
        const t: any = this.db.prepare('SELECT id FROM tags WHERE name=?').get(n)
        const r = this.db.prepare('INSERT OR IGNORE INTO host_tags (host_id, tag_id) VALUES (?,?)').run(hostId, t.id)
        if (r.changes) this.log(hostId, 'tag', `Tagged ${n}`)
      }
    })()
  }
  removeTags(hostId: number, names: string[]) {
    for (const n of names) {
      const r = this.db.prepare('DELETE FROM host_tags WHERE host_id=? AND tag_id=(SELECT id FROM tags WHERE name=?)').run(hostId, n.trim())
      if (r.changes) this.log(hostId, 'tag', `Untagged ${n}`)
    }
    this.db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM host_tags)').run()
  }
  setTagColor(name: string, color: string) { this.db.prepare('UPDATE tags SET color=? WHERE name=?').run(color, name) }

  // ---------- activity / filters / settings ----------
  log(hostId: number, kind: string, detail = '') { this.db.prepare('INSERT INTO activity (host_id, kind, detail, at) VALUES (?,?,?,?)').run(hostId, kind, detail, now()) }
  listActivity(hostId: number, limit = 100): Activity[] {
    return this.db.prepare('SELECT * FROM activity WHERE host_id=? ORDER BY id DESC LIMIT ?').all(hostId, limit) as Activity[]
  }
  recentActivity(projectId: number | null, limit = 12): (Activity & { label: string })[] {
    const w = projectId != null ? 'WHERE h.project_id=?' : ''
    return this.db.prepare(`SELECT a.*, COALESCE(NULLIF(h.hostname,''), h.ip) AS label FROM activity a JOIN hosts h ON h.id=a.host_id ${w} ORDER BY a.id DESC LIMIT ?`)
      .all(...(projectId != null ? [projectId, limit] : [limit])) as any
  }
  listSavedFilters(): SavedFilter[] {
    return this.db.prepare('SELECT * FROM saved_filters ORDER BY name COLLATE NOCASE').all().map((r: any) => ({ id: r.id, name: r.name, filter: JSON.parse(r.json) }))
  }
  saveFilter(name: string, filter: Filter) {
    this.db.prepare('INSERT INTO saved_filters (name, json) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET json=excluded.json').run(name.trim(), JSON.stringify(filter))
  }
  deleteSavedFilter(id: number) { this.db.prepare('DELETE FROM saved_filters WHERE id=?').run(id) }
  getSettings(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const r of this.db.prepare('SELECT key, value FROM settings').all() as any[]) { try { out[r.key] = JSON.parse(r.value) } catch { /* skip */ } }
    return out
  }
  setSetting(key: string, value: unknown) {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value))
  }

  stats(projectId: number | null) {
    const w = projectId != null ? 'WHERE project_id=?' : ''
    const a = projectId != null ? [projectId] : []
    const group = (col: string) => Object.fromEntries((this.db.prepare(`SELECT ${col} k, count(*) n FROM hosts ${w} GROUP BY ${col}`).all(...a) as any[]).map(r => [r.k || 'unknown', r.n]))
    const total = (this.db.prepare(`SELECT count(*) n FROM hosts ${w}`).get(...a) as any).n as number
    const withCreds = (this.db.prepare(`SELECT count(*) n FROM hosts h ${projectId != null ? 'WHERE h.project_id=? AND' : 'WHERE'} EXISTS (SELECT 1 FROM credentials c WHERE c.host_id=h.id)`).get(...a) as any).n as number
    const creds = (this.db.prepare(`SELECT count(*) n FROM credentials c JOIN hosts h ON h.id=c.host_id ${projectId != null ? 'WHERE h.project_id=?' : ''}`).get(...a) as any).n as number
    const osRaw = this.db.prepare(`SELECT os k, count(*) n FROM hosts ${w} GROUP BY os ORDER BY n DESC`).all(...a) as any[]
    return { total, withCreds, creds, status: group('status'), access: group('access'), os: osRaw.map(r => ({ name: r.k || 'Unknown', count: r.n })) }
  }

  // ---------- sliver binding ----------
  private mapSliver = (r: any): HostSliver => ({
    hostId: r.host_id, implantId: r.implant_id, name: r.name, kind: r.kind,
    configPath: r.config_path, health: r.health, lastMessage: r.last_message, syncedAt: r.synced_at,
  })
  getSliver(hostId: number): HostSliver | undefined {
    const r = this.db.prepare('SELECT * FROM host_sliver WHERE host_id=?').get(hostId)
    return r ? this.mapSliver(r) : undefined
  }
  findHostBySliver(implantId: string, configPath = '', projectId?: number | null): Host | undefined {
    const proj = projectId != null ? 'AND h.project_id=?' : ''
    const args: unknown[] = [implantId, configPath]
    if (projectId != null) args.push(projectId)
    const r = this.db.prepare(`${this.hostSelect} JOIN host_sliver hs ON hs.host_id=h.id WHERE hs.implant_id=? AND hs.config_path=? ${proj} LIMIT 1`).get(...args)
    return r ? this.mapHost(r) : undefined
  }
  listSliverBindings(configPath?: string): HostSliver[] {
    if (configPath) return this.db.prepare('SELECT * FROM host_sliver WHERE config_path=? ORDER BY host_id').all(configPath).map(this.mapSliver)
    return this.db.prepare('SELECT * FROM host_sliver ORDER BY host_id').all().map(this.mapSliver)
  }
  upsertSliver(hostId: number, s: { implantId: string; name?: string; kind: 'session' | 'beacon'; configPath?: string; health?: string; lastMessage?: string }): HostSliver {
    if (!s.implantId.trim()) throw new Error('Sliver implant id required')
    if (s.kind !== 'session' && s.kind !== 'beacon') throw new Error('Sliver kind must be session or beacon')
    this.db.prepare(`INSERT INTO host_sliver (host_id, implant_id, name, kind, config_path, health, last_message, synced_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(host_id) DO UPDATE SET implant_id=excluded.implant_id, name=excluded.name, kind=excluded.kind,
        config_path=excluded.config_path, health=excluded.health, last_message=excluded.last_message, synced_at=excluded.synced_at`)
      .run(hostId, s.implantId.trim(), s.name ?? '', s.kind, s.configPath ?? '', s.health ?? '', s.lastMessage ?? '', now())
    this.log(hostId, 'sliver', `${s.kind} ${s.implantId}${s.name ? ` (${s.name})` : ''}`)
    return this.getSliver(hostId)!
  }
  deleteSliver(hostId: number) { this.db.prepare('DELETE FROM host_sliver WHERE host_id=?').run(hostId) }

  // ---------- full hosts + children (export) ----------
  fullHosts(f: Filter = {}) {
    return this.listHosts(f).map(h => ({ ...h, services: this.listServices(h.id), credentials: this.listCredentials(h.id), notes: this.listNotes(h.id) }))
  }
}
