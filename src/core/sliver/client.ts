import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { listSliverConfigs } from '../import/sliver'

export interface SliverRunOpts { config?: string; binary?: string; timeoutMs?: number }

export function resolveSliverConfig(explicit?: string): string {
  if (explicit) {
    const p = path.resolve(explicit)
    if (!fs.existsSync(p)) throw new Error(`Sliver config not found: ${p}`)
    return p
  }
  const configs = listSliverConfigs()
  if (!configs.length) throw new Error('No sliver configs in ~/.sliver-client/configs. Pass --config.')
  if (configs.length > 1) throw new Error(`Multiple sliver configs — pick one with --config:\n  ${configs.join('\n  ')}`)
  return configs[0]
}

function bin(opts?: SliverRunOpts) { return opts?.binary ?? 'sliver-client' }

function stripNoise(out: string): string {
  return out.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\[\?[0-9;]*[hl]/g, '')
}

function runSync(argv: string[], opts: SliverRunOpts = {}): { status: number | null; out: string } {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: opts.timeoutMs ?? 60_000, env: { ...process.env, TERM: 'dumb' } })
  if (r.error) throw r.error
  return { status: r.status, out: stripNoise(String(r.stdout ?? '') + String(r.stderr ?? '')) }
}

function failHint(out: string, status: number | null): string {
  const line = out.split('\n').map(l => l.trim()).find(l => /error|failed|denied|refus|deadline|no (session|beacon|implant|target)/i.test(l))
  return line || out.trim().split('\n').filter(Boolean).slice(-3).join(' | ') || `exit ${status}`
}

/** Build argv for `sliver-client implant --config … --use <id> <cmd…>`. */
export function implantArgv(implantId: string, cmd: string[], opts: SliverRunOpts = {}): string[] {
  if (!implantId.trim()) throw new Error('Implant id required')
  if (implantId.startsWith('-')) throw new Error('Invalid implant id')
  const cfg = resolveSliverConfig(opts.config)
  return [bin(opts), 'implant', '--config', cfg, '--use', implantId, ...cmd]
}

export function shellArgv(implantId: string, opts: SliverRunOpts = {}): string[] {
  return implantArgv(implantId, ['shell'], opts)
}

export function pingImplant(implantId: string, opts: SliverRunOpts = {}): { ok: boolean; output: string; ms?: number } {
  const { status, out } = runSync(implantArgv(implantId, ['ping'], opts), opts)
  const m = out.match(/(\d+)\s*ms/i)
  const ok = status === 0 && !/error|failed|no (session|beacon|implant|target)/i.test(out)
  if (!ok && status !== 0) throw new Error(`sliver ping failed: ${failHint(out, status)}`)
  return { ok, output: out.trim(), ms: m ? Number(m[1]) : undefined }
}

export function execImplant(implantId: string, command: string[], opts: SliverRunOpts = {}): { ok: boolean; output: string } {
  if (!command.length) throw new Error('Command required')
  // `execute <path> -- [args…]` — when caller passes a shell string, run via sh -c
  const argv = command.length === 1 && /\s/.test(command[0])
    ? implantArgv(implantId, ['execute', '/bin/sh', '--', '-c', command[0]], opts)
    : implantArgv(implantId, ['execute', command[0], ...(command.length > 1 ? ['--', ...command.slice(1)] : [])], opts)
  const { status, out } = runSync(argv, opts)
  const ok = status === 0
  if (!ok) throw new Error(`sliver exec failed: ${failHint(out, status)}`)
  return { ok, output: out.trim() }
}

/** Interactive shell: inherit stdio (CLI only). */
export function runShell(implantId: string, opts: SliverRunOpts = {}): Promise<number> {
  const argv = shellArgv(implantId, opts)
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', env: process.env })
    child.on('error', reject)
    child.on('exit', code => resolve(code ?? 0))
  })
}
