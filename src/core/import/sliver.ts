import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CsvHost } from './csv'

export function listSliverConfigs(dir = process.env.SLIVER_CONFIG_DIR || path.join(os.homedir(), '.sliver-client', 'configs')): string[] {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.cfg')).map(f => path.join(dir, f)).sort() } catch { return [] }
}

const ANSI = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\[\?[0-9;]*[hl]/g
const BORDER = /^[┌┬┐├┼┤└┴┘╞╪╡╞╟─═=\s┐┤┘┬┴┼╮╯╰╭\-+]*$/

/** Strip ANSI, split a go-pretty table block into rows of cell strings. */
function tableRows(block: string): string[][] {
  const out: string[][] = []
  for (const raw of block.split(/\r?\n/)) {
    const l = raw.replace(ANSI, '')
    if (!l.trim() || BORDER.test(l)) continue
    let cells: string[]
    if (l.includes('│')) cells = l.split('│').map(c => c.trim()).filter((c, i, a) => c !== '' || (i > 0 && i < a.length - 1))
    else cells = l.split(/\s{2,}/).map(c => c.trim()).filter(Boolean)
    if (cells.length) out.push(cells)
  }
  return out
}

const stripPort = (addr: string) => {
  const m = addr.match(/^(\d{1,3}(?:\.\d{1,3}){3}):?\d*$|^\[?([0-9a-fA-F:]+)\]?:?\d*$/)
  return m ? (m[1] ?? m[2] ?? '') : ''
}

const looksId = (c: string) => /^[0-9a-f]{6,16}$/i.test(c)

/** Parse one sliver table (from `beacons` or `sessions`). Column positions derive from the header; merged cells shift values right — re-align via per-row IP position. */
function parseSliverTable(block: string, tag: 'session' | 'beacon'): CsvHost[] {
  const rows = tableRows(block)
  if (rows.length < 2) return []
  const header = rows[0].map(h => h.toLowerCase())
  const col = (name: string) => header.findIndex(h => h === name)
  const ci = { id: col('id'), name: col('name'), remote: col('remote address'), host: col('hostname'), user: col('username'), os: col('operating system'), health: col('health') }
  if (ci.remote < 0 && ci.host < 0) return []
  const out: CsvHost[] = []
  for (const r of rows.slice(1)) {
    // Find the remote-address column per row: first cell that looks like ip[:port] or [v6]:port
    const remoteIdx = r.findIndex(c => /^[\d.]+:\d+$|^\d{1,3}(\.\d{1,3}){3}$|^\[[0-9a-f:]+\]/.test(c))
    const ip = remoteIdx >= 0 ? stripPort(r[remoteIdx]) : ''
    // hostname: cell right after remote (columns before remote may merge when Name contains spaces)
    const hostname = remoteIdx >= 0 ? (r[remoteIdx + 1] ?? '') : (ci.host >= 0 ? r[ci.host] : '')
    if (!ip && !hostname) continue
    const user = (remoteIdx >= 0 ? r[remoteIdx + 2] : r[ci.user])?.replace(/^[-–—]$/, '') ?? ''
    const os = r.find(c => /^[a-z]+\/[a-z0-9_]+$/i.test(c)) ?? ''
    const dead = r.join(' ').toLowerCase().includes('[dead]')
    const health = (ci.health >= 0 ? r[ci.health] : '') || (dead ? '[DEAD]' : r.find(c => /^\[[A-Z]+\]$/.test(c)) || '')
    // ID: header col (authoritative), else first hex-ish cell before remote when cells merged
    let sliverId = ci.id >= 0 ? (r[ci.id] ?? '') : ''
    if (!sliverId || /\s/.test(sliverId)) sliverId = (remoteIdx > 0 ? r.slice(0, remoteIdx).find(looksId) : r.find(looksId)) ?? sliverId
    // Name: header col, else cell after ID / before transport
    let sliverName = ci.name >= 0 ? (r[ci.name] ?? '') : ''
    if (!sliverName && sliverId) {
      const idIdx = r.indexOf(sliverId)
      if (idIdx >= 0 && r[idIdx + 1] && !/^(mtls|wg|http|dns|named)/i.test(r[idIdx + 1])) sliverName = r[idIdx + 1]
    }
    const parts = [`sliver ${tag}`]
    if (sliverId) parts.push(`id ${sliverId}`)
    if (sliverName) parts.push(`name ${sliverName}`)
    if (user) parts.push(`user ${user}`)
    out.push({
      ip, hostname, mac: '', os,
      status: dead ? 'offline' : 'online',
      access: '', tags: ['sliver', tag], ports: [],
      username: '', password: '', note: parts.join('; '),
      sliverId: sliverId || undefined, sliverName: sliverName || undefined, sliverKind: tag, sliverHealth: health || undefined,
    })
  }
  return out
}

/**
 * Parse the combined stdout of `sliver-client console --rc …` running `beacons` and `sessions`.
 * Tables are located by their header row; other console chatter is ignored.
 */
export function parseSliverOutput(stdout: string, configPath = ''): CsvHost[] {
  const lines = stdout.split(/\r?\n/)
  const hosts = new Map<string, CsvHost>()
  // Split output into table blocks: a block starts at a header row containing "Remote Address" or "Hostname"
  let cur: string[] = []
  let kind: 'beacons' | 'sessions' | null = null
  const flush = () => {
    if (!kind || !cur.length) { cur = []; return }
    for (const h of parseSliverTable(cur.join('\n'), kind === 'sessions' ? 'session' : 'beacon')) {
      if (configPath) h.sliverConfig = configPath
      // one row per target (ip|hostname): a session always wins over its beacon;
      // extra beacons on a target that already has one are dropped (import merges by IP anyway)
      const target = `${h.ip}|${h.hostname}`.toLowerCase()
      const key = target !== '|' ? target : h.sliverId || ''
      const prev = hosts.get(key)
      if (!prev || (h.sliverKind === 'session' && prev.sliverKind === 'beacon')) hosts.set(key, h)
    }
    cur = []; kind = null
  }
  for (const line of lines) {
    const clean = line.replace(ANSI, '')
    const isBorder = BORDER.test(clean) || !clean.trim()
    const isTableRow = clean.includes('│') || /\S\s{2,}\S/.test(clean)
    const hasAddr = /remote address/i.test(clean)
    const hasHost = /hostname/i.test(clean)
    const inHeader = (hasAddr || hasHost) && /operating system|username|transport|last check|health|last message/i.test(clean)
    if (inHeader) { flush(); kind = /next check/i.test(clean) || /tasks/i.test(clean) ? 'beacons' : 'sessions'; cur = [line]; continue }
    if (kind && isBorder) continue
    if (kind && isTableRow) { cur.push(line); continue }
    if (kind) flush()
  }
  flush()
  return [...hosts.values()]
}

/**
 * Run `sliver-client console --rc <tmp>` with `beacons` and `sessions` and return parsed hosts.
 * Throws on missing binary/config or non-zero exit.
 */
export function fetchSliverHosts(opts: { config?: string; binary?: string; timeoutMs?: number } = {}): CsvHost[] {
  const bin = opts.binary ?? 'sliver-client'
  const configs = listSliverConfigs()
  let cfg = opts.config
  if (!cfg) {
    if (!configs.length) throw new Error(`No sliver configs found in ${path.join(os.homedir(), '.sliver-client', 'configs')}. Pass --config.`)
    if (configs.length > 1) throw new Error(`Multiple sliver configs — pick one with --config:\n  ${configs.join('\n  ')}`)
    cfg = configs[0]
  }
  const rc = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hv-sliver-')), 'rc')
  fs.writeFileSync(rc, 'beacons\nsessions\nexit\n')
  try {
    const r = spawnSync(bin, ['console', '--config', cfg, '--rc', rc], { encoding: 'utf8', timeout: opts.timeoutMs ?? 30000, env: { ...process.env, TERM: 'dumb' } })
    if (r.error) throw r.error
    const out = String(r.stdout ?? '') + String(r.stderr ?? '')
    if (r.status !== 0 && !/beacons|sessions/i.test(out)) {
      const errLine = out.split('\n').map(l => l.trim()).find(l => /error|failed|denied|refus|deadline/i.test(l) && !/^(usage|flags|help)\b|^--/.test(l))
      throw new Error(`sliver-client failed: ${errLine ?? (out.trim().split('\n').slice(-3).join(' | ') || `exit ${r.status}`)}`)
    }
    return parseSliverOutput(out, cfg)
  } finally {
    try { fs.rmSync(path.dirname(rc), { recursive: true, force: true }) } catch {}
  }
}
