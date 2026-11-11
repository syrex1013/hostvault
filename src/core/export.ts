import type { Repo } from './repo'
import type { Filter } from './types'
import { csvEscape } from './import/csv'

export interface ExportOptions { includeSecrets?: boolean }
const R = '••• redacted •••'

function data(repo: Repo, f: Filter, o: ExportOptions, ids?: number[]) {
  let hosts = repo.fullHosts(f)
  if (ids) hosts = hosts.filter(h => ids.includes(h.id))
  return hosts.map(h => ({ ...h, credentials: h.credentials.map(c => ({ ...c, secret: o.includeSecrets ? c.secret : c.secret ? R : '' })) }))
}
export function exportJson(repo: Repo, f: Filter = {}, o: ExportOptions = {}, ids?: number[]) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), secretsIncluded: !!o.includeSecrets, hosts: data(repo, f, o, ids) }, null, 2)
}
export function exportCsv(repo: Repo, f: Filter = {}, o: ExportOptions = {}, ids?: number[]) {
  const head = ['ip', 'hostname', 'mac', 'os', 'url', 'status', 'access', 'tags', 'ports', 'credentials', 'last_seen']
  const rows = data(repo, f, o, ids).map(h => [
    h.ip, h.hostname, h.mac, h.os, h.url, h.status, h.access, h.tags.join(';'), h.services.map(s => `${s.port}/${s.protocol}`).join(';'),
    h.credentials.map(c => `${c.domain ? c.domain + '\\' : ''}${c.username}${o.includeSecrets && c.secret ? ':' + c.secret : ''}`).join(';'), h.lastSeen,
  ].map(csvEscape).join(','))
  return [head.join(','), ...rows].join('\n') + '\n'
}
const md = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
export function exportMarkdown(repo: Repo, f: Filter = {}, o: ExportOptions = {}, ids?: number[]) {
  const hosts = data(repo, f, o, ids)
  const L = [`# Host inventory`, ``, `_${hosts.length} host(s) — exported ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC. ${o.includeSecrets ? '**Contains secrets.**' : 'Secrets redacted.'}_`, ``]
  for (const h of hosts) {
    L.push(`## ${h.hostname || h.ip}${h.hostname && h.ip ? ` (${h.ip})` : ''}`, ``,
      `- **Status:** ${h.status}  ·  **Access:** ${h.access}  ·  **OS:** ${h.os || '—'}`,
      ...(h.tags.length ? [`- **Tags:** ${h.tags.join(', ')}`] : []), ``)
    if (h.services.length) L.push(`| Port | Service | Version |`, `|---|---|---|`, ...h.services.map(s => `| ${s.port}/${s.protocol} | ${md(s.name)} | ${md([s.product, s.version].filter(Boolean).join(' '))} |`), ``)
    if (h.credentials.length) L.push(`| Type | User | Secret |`, `|---|---|---|`, ...h.credentials.map(c => `| ${c.kind} | ${md((c.domain ? c.domain + '\\' : '') + c.username)} | ${md(c.secret)} |`), ``)
    for (const n of h.notes) L.push(`> ${n.body.replace(/\n/g, '\n> ')}`, ``)
  }
  return L.join('\n')
}
