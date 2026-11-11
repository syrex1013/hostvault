import type { Repo } from '../repo'
import { ACCESS_LEVELS, STATUSES, type AccessLevel, type Status } from '../types'
import type { CsvHost } from './csv'
import type { ImportedHost } from './nmap'

export interface ImportResult { created: number; updated: number; services: number; credentials: number; skipped: number }

/** Merge by sliver implant id when present (never by IP alone: NAT peers are distinct implants), else by IP (else hostname). Never downgrades a user-set 'dead' status. */
export function applyImport(repo: Repo, projectId: number, hosts: (ImportedHost | CsvHost)[], tag?: string): ImportResult {
  const res: ImportResult = { created: 0, updated: 0, services: 0, credentials: 0, skipped: 0 }
  repo.db.transaction(() => {
    for (const h of hosts) {
      if (!h.ip && !h.hostname) { res.skipped++; continue }
      const sliverId = 'sliverId' in h ? h.sliverId : undefined
      const sliverCfg = 'sliverConfig' in h ? (h.sliverConfig ?? '') : ''
      let cur = (sliverId && repo.findHostBySliver(sliverId, sliverCfg, projectId)) || undefined
      if (!cur && sliverId) {
        // Distinct implants can share a NAT address, so never merge a sliver row by IP alone:
        // match by hostname (with a compatible IP), or by IP only when that host has no binding yet.
        const byName = h.hostname ? repo.findHost(h.hostname, projectId) : undefined
        const byIp = h.ip ? repo.findHost(h.ip, projectId) : undefined
        if (byName && (!byName.ip || !h.ip || byName.ip === h.ip)) cur = byName
        else if (byIp && !repo.getSliver(byIp.id)) cur = byIp
      }
      if (!cur && !sliverId) cur = (h.ip && repo.findHost(h.ip, projectId)) || (h.hostname && repo.findHost(h.hostname, projectId)) || undefined
      const st = 'status' in h && h.status && (STATUSES as readonly string[]).includes(h.status) ? (h.status as Status) : undefined
      const ac = 'access' in h && h.access && (ACCESS_LEVELS as readonly string[]).includes(h.access) ? (h.access as AccessLevel) : undefined
      if (!cur) { cur = repo.addHost({ projectId, ip: h.ip, hostname: h.hostname, mac: h.mac, os: h.os, status: st, access: ac }); res.created++ }
      else {
        repo.updateHost(cur.id, {
          ip: cur.ip || h.ip, hostname: cur.hostname || h.hostname, mac: cur.mac || h.mac, os: h.os || cur.os,
          ...(st && cur.status !== 'dead' ? { status: st } : {}), ...(ac ? { access: ac } : {}),
        }); res.updated++
      }
      const ports = 'services' in h ? h.services : (h as CsvHost).ports.map(port => ({ port, protocol: 'tcp', name: '', product: '', version: '', state: 'open' }))
      for (const s of ports) { repo.upsertService(cur.id, s); res.services++ }
      if ('tags' in h && h.tags.length) repo.addTags(cur.id, h.tags)
      if (tag) repo.addTags(cur.id, [tag])
      if ('username' in h && (h.username || h.password)) { repo.addCredential(cur.id, { username: h.username, secret: h.password, kind: 'password', source: 'import' }); res.credentials++ }
      if ('note' in h && h.note) {
        // Avoid duplicating the same sliver note on every sync
        const notes = repo.listNotes(cur.id)
        if (!notes.some(n => n.body === h.note)) repo.addNote(cur.id, h.note)
      }
      if (sliverId && 'sliverKind' in h && h.sliverKind) {
        repo.upsertSliver(cur.id, {
          implantId: sliverId,
          name: h.sliverName ?? '',
          kind: h.sliverKind,
          configPath: sliverCfg,
          health: h.sliverHealth ?? '',
        })
      }
    }
  })()
  return res
}
