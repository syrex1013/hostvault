import type { Filter } from './types'

export function buildWhere(f: Filter): { where: string; params: unknown[] } {
  const c: string[] = []
  const p: unknown[] = []
  if (f.projectId != null) { c.push('h.project_id = ?'); p.push(f.projectId) }
  if (f.status?.length) { c.push(`h.status IN (${f.status.map(() => '?').join(',')})`); p.push(...f.status) }
  if (f.access?.length) { c.push(`h.access IN (${f.access.map(() => '?').join(',')})`); p.push(...f.access) }
  if (f.os) { c.push('h.os LIKE ?'); p.push(`%${f.os}%`) }
  if (f.favorite) c.push('h.favorite = 1')
  if (f.seenWithinDays != null) { c.push(`h.last_seen >= datetime('now', ?)`); p.push(`-${Math.floor(f.seenWithinDays)} days`) }
  if (f.hasCreds === true) c.push('EXISTS (SELECT 1 FROM credentials x WHERE x.host_id = h.id)')
  if (f.hasCreds === false) c.push('NOT EXISTS (SELECT 1 FROM credentials x WHERE x.host_id = h.id)')
  for (const t of f.tags ?? []) {
    c.push('EXISTS (SELECT 1 FROM host_tags ht JOIN tags t ON t.id = ht.tag_id WHERE ht.host_id = h.id AND t.name = ?)')
    p.push(t)
  }
  if (f.port != null) { c.push('EXISTS (SELECT 1 FROM services s WHERE s.host_id = h.id AND s.port = ?)'); p.push(f.port) }
  if (f.service) {
    c.push(`EXISTS (SELECT 1 FROM services s WHERE s.host_id = h.id AND (s.name LIKE ? OR s.product LIKE ?))`)
    p.push(`%${f.service}%`, `%${f.service}%`)
  }
  const s = f.search?.trim()
  if (s) {
    const like = `%${s.replace(/[%_\\]/g, m => '\\' + m)}%`
    c.push(`(h.ip LIKE ? ESCAPE '\\' OR h.hostname LIKE ? ESCAPE '\\' OR h.mac LIKE ? ESCAPE '\\' OR h.os LIKE ? ESCAPE '\\' OR h.url LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM notes n WHERE n.host_id = h.id AND n.body LIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM services s WHERE s.host_id = h.id AND (s.name LIKE ? ESCAPE '\\' OR s.product LIKE ? ESCAPE '\\' OR CAST(s.port AS TEXT) = ?))
      OR EXISTS (SELECT 1 FROM credentials x WHERE x.host_id = h.id AND (x.username LIKE ? ESCAPE '\\' OR x.domain LIKE ? ESCAPE '\\'))
      OR EXISTS (SELECT 1 FROM host_tags ht JOIN tags t ON t.id = ht.tag_id WHERE ht.host_id = h.id AND t.name LIKE ? ESCAPE '\\'))`)
    p.push(like, like, like, like, like, like, like, like, s, like, like, like)
  }
  return { where: c.length ? 'WHERE ' + c.join(' AND ') : '', params: p }
}

const SORTS: Record<string, string> = {
  ip: `CASE WHEN h.ip GLOB '[0-9]*.[0-9]*.[0-9]*.[0-9]*' THEN
        (CAST(substr(h.ip,1,instr(h.ip,'.')-1) AS INTEGER)*16777216) +
        (CAST(substr(substr(h.ip,instr(h.ip,'.')+1),1,instr(substr(h.ip,instr(h.ip,'.')+1),'.')-1) AS INTEGER)*65536) +
        (CAST(substr(substr(substr(h.ip,instr(h.ip,'.')+1),instr(substr(h.ip,instr(h.ip,'.')+1),'.')+1),1,
          instr(substr(substr(h.ip,instr(h.ip,'.')+1),instr(substr(h.ip,instr(h.ip,'.')+1),'.')+1),'.')-1) AS INTEGER)*256) +
        CAST(replace(h.ip, rtrim(h.ip, '0123456789'), '') AS INTEGER)
       ELSE 9e15 END, h.ip`,
  hostname: 'h.hostname COLLATE NOCASE', os: 'h.os COLLATE NOCASE',
  status: `CASE h.status WHEN 'online' THEN 0 WHEN 'offline' THEN 1 WHEN 'unknown' THEN 2 ELSE 3 END`,
  access: `CASE h.access WHEN 'root' THEN 0 WHEN 'admin' THEN 1 WHEN 'user' THEN 2 ELSE 3 END`,
  lastSeen: 'h.last_seen', lastChecked: 'h.last_checked', created: 'h.id',
}
export function buildOrder(f: Filter): string {
  const col = SORTS[f.sort ?? 'ip'] ?? SORTS.ip
  return `ORDER BY h.favorite DESC, ${col} ${f.desc ? 'DESC' : 'ASC'}, h.id`
}
