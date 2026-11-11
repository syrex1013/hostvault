import Database from 'better-sqlite3-multiple-ciphers'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MIGRATIONS } from './schema'

export type DB = Database.Database

export function defaultVaultPath(): string {
  if (process.env.HV_VAULT) return process.env.HV_VAULT
  const base = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'HostVault')
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'HostVault')
  return path.join(base, 'vault.db')
}

export class WrongPasswordError extends Error {
  constructor() { super('Wrong master password (or vault file is corrupted)'); this.name = 'WrongPasswordError' }
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`

function applyKey(db: DB, password: string) {
  db.pragma(`cipher='sqlcipher'`)
  db.pragma(`key=${q(password)}`)
}

export function vaultExists(file = defaultVaultPath()): boolean {
  return fs.existsSync(file) && fs.statSync(file).size > 0
}

/** Open (or create when `create`) an encrypted vault. Throws WrongPasswordError on bad key. */
export function openVault(password: string, file = defaultVaultPath(), create = false): DB {
  const exists = vaultExists(file)
  if (!exists && !create) throw new Error(`No vault at ${file}. Create one first (hv init).`)
  if (exists && create) throw new Error(`A vault already exists at ${file}.`)
  if (!password) throw new Error('Master password must not be empty')
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const db = new Database(file)
  try {
    applyKey(db, password)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
    db.pragma('foreign_keys = ON')
    db.prepare('SELECT count(*) FROM sqlite_master').get()
  } catch {
    db.close()
    throw new WrongPasswordError()
  }
  try { fs.chmodSync(file, 0o600) } catch { /* best effort */ }
  migrate(db)
  return db
}

export function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

export function rekey(db: DB, newPassword: string) {
  if (!newPassword) throw new Error('Master password must not be empty')
  db.pragma(`rekey=${q(newPassword)}`)
}

export function backupVault(db: DB, dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  db.pragma('wal_checkpoint(TRUNCATE)')
  fs.copyFileSync((db as any).name, dest)
}
