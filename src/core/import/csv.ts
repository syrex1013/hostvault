export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false
  const t = text.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = [] }
    else f += c
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}
export function csvEscape(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const HOST_FIELDS = ['ip', 'hostname', 'mac', 'os', 'status', 'access', 'tags', 'ports', 'username', 'password', 'note'] as const
export type HostField = (typeof HOST_FIELDS)[number]
const ALIASES: Record<HostField, string[]> = {
  ip: ['ip', 'ipaddress', 'address', 'host', 'target'], hostname: ['hostname', 'name', 'fqdn', 'dns'], mac: ['mac', 'macaddress'],
  os: ['os', 'operatingsystem', 'platform'], status: ['status', 'state'], access: ['access', 'accesslevel', 'privilege'],
  tags: ['tags', 'tag', 'labels'], ports: ['ports', 'openports', 'port'], username: ['username', 'user', 'login'],
  password: ['password', 'pass', 'secret'], note: ['note', 'notes', 'comment', 'comments'],
}
export function guessMapping(header: string[]): Record<number, HostField> {
  const m: Record<number, HostField> = {}; const used = new Set<HostField>()
  header.forEach((h, i) => {
    const k = h.toLowerCase().replace(/[^a-z]/g, '')
    const f = HOST_FIELDS.find(x => !used.has(x) && ALIASES[x].includes(k))
    if (f) { m[i] = f; used.add(f) }
  })
  return m
}
export interface CsvHost {
  ip: string; hostname: string; mac: string; os: string; status?: string; access?: string
  tags: string[]; ports: number[]; username: string; password: string; note: string
  sliverId?: string; sliverName?: string; sliverKind?: 'session' | 'beacon'; sliverConfig?: string; sliverHealth?: string
}
export function csvToHosts(rows: string[][], mapping: Record<number, HostField>, hasHeader = true): CsvHost[] {
  const out: CsvHost[] = []
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const v: Partial<Record<HostField, string>> = {}
    for (const [i, f] of Object.entries(mapping)) v[f] = (r[Number(i)] ?? '').trim()
    if (!v.ip && !v.hostname) continue
    out.push({
      ip: v.ip ?? '', hostname: v.hostname ?? '', mac: v.mac ?? '', os: v.os ?? '', status: v.status?.toLowerCase(), access: v.access?.toLowerCase(),
      tags: (v.tags ?? '').split(/[;|,]/).map(s => s.trim()).filter(Boolean),
      ports: (v.ports ?? '').split(/[;|,\s]+/).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 65535),
      username: v.username ?? '', password: v.password ?? '', note: v.note ?? '',
    })
  }
  return out
}
