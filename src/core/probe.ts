import net from 'node:net'
import { execFile } from 'node:child_process'
import type { Repo } from './repo'

export interface ProbeOptions { ports?: number[]; timeoutMs?: number; concurrency?: number; ping?: boolean; pingOnly?: boolean }
export const DEFAULT_PORTS = [22, 80, 443, 445, 3389, 135, 139, 21, 23, 25, 53, 8080]

export function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.connect({ host, port })
    let done = false
    const end = (ok: boolean) => { if (!done) { done = true; s.destroy(); resolve(ok) } }
    s.setTimeout(timeoutMs, () => end(false))
    s.once('connect', () => end(true))
    s.once('error', (e: NodeJS.ErrnoException) => end(e.code === 'ECONNREFUSED')) // refused == host is alive
  })
}

export function pingProbe(host: string, timeoutMs: number): Promise<boolean> {
  if (!/^[A-Za-z0-9._:-]+$/.test(host) || host.startsWith('-')) return Promise.resolve(false)
  const args = process.platform === 'darwin' ? ['-c', '1', '-t', String(Math.max(1, Math.ceil(timeoutMs / 1000))), host]
    : ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), host]
  return new Promise(resolve => execFile('ping', args, { timeout: timeoutMs + 1500 }, err => resolve(!err)))
}

export async function probeHost(target: string, knownPorts: number[], o: ProbeOptions = {}): Promise<boolean> {
  const timeout = o.timeoutMs ?? 1500
  if (o.pingOnly) return pingProbe(target, timeout)
  const ports = [...new Set([...(knownPorts ?? []), ...(o.ports ?? DEFAULT_PORTS)])].slice(0, 24)
  if (o.ping !== false && await pingProbe(target, timeout)) return true
  const results = await Promise.all(ports.map(p => tcpProbe(target, p, timeout)))
  return results.some(Boolean)
}

/** Check selected hosts; updates status online/offline. Hosts marked dead are skipped. */
export async function checkHosts(repo: Repo, ids: number[], o: ProbeOptions = {}, onResult?: (id: number, status: 'online' | 'offline') => void) {
  const queue = ids.map(i => repo.getHost(i)).filter((h): h is NonNullable<typeof h> => !!h && h.status !== 'dead')
  const out: { id: number; status: 'online' | 'offline' }[] = []
  const workers = Array.from({ length: Math.min(o.concurrency ?? 16, queue.length) }, async () => {
    for (let h = queue.shift(); h; h = queue.shift()) {
      const target = h.ip || h.hostname
      const ports = repo.listServices(h.id).filter(s => s.protocol === 'tcp').map(s => s.port)
      const status = (await probeHost(target, ports, o)) ? 'online' : 'offline'
      repo.setStatus(h.id, status, true)
      out.push({ id: h.id, status }); onResult?.(h.id, status)
    }
  })
  await Promise.all(workers)
  return out
}
