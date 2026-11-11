import type { Activity, Credential, Filter, Host, HostInput, HostSliver, Note, Project, SavedFilter, Service, Status, Tag } from '../../core/types'
import type { HvApi } from '../../preload'

declare global { interface Window { hv: HvApi } }
export type MaskedCred = Omit<Credential, 'secret'> & { secret: ''; hasSecret: boolean }
const c = <T,>(m: string, ...a: unknown[]) => window.hv.call(m, ...a) as Promise<T>

export interface Stats { total: number; withCreds: number; creds: number; status: Record<string, number>; access: Record<string, number>; os: { name: string; count: number }[] }
export interface ConnectCmd { proto: string; argv: string[]; display: string; needsPassword: boolean; note?: string; credId: number | null }
export const api = {
  status: () => c<{ exists: boolean; unlocked: boolean; path: string }>('vault.status'),
  create: (pw: string) => c('vault.create', pw), unlock: (pw: string) => c('vault.unlock', pw), lock: () => c<void>('vault.lock'),
  passwd: (o: string, n: string) => c<void>('vault.passwd', o, n),
  projects: () => c<Project[]>('projects.list'), addProject: (p: Partial<Project>) => c<Project>('projects.add', p),
  updateProject: (id: number, p: Partial<Project>) => c<Project>('projects.update', id, p), deleteProject: (id: number) => c<void>('projects.delete', id),
  hosts: (f: Filter) => c<Host[]>('hosts.list', f), addHost: (i: HostInput & { projectId: number }) => c<Host>('hosts.add', i),
  updateHost: (id: number, i: HostInput) => c<Host>('hosts.update', id, i), deleteHosts: (ids: number[]) => c<void>('hosts.delete', ids),
  setStatus: (ids: number[], s: Status) => c<void>('hosts.setStatus', ids, s), check: (ids: number[]) => c<{ id: number; status: Status }[]>('hosts.check', ids), ping: (ids: number[]) => c<{ id: number; status: Status }[]>('hosts.ping', ids),
  services: (id: number) => c<Service[]>('services.list', id), upsertService: (id: number, s: Partial<Service>) => c<Service>('services.upsert', id, s), deleteService: (id: number) => c<void>('services.delete', id),
  creds: (id: number) => c<MaskedCred[]>('creds.list', id), addCred: (id: number, x: Partial<Credential>) => c<MaskedCred>('creds.add', id, x),
  updateCred: (id: number, x: Partial<Credential>) => c<MaskedCred>('creds.update', id, x), deleteCred: (id: number) => c<void>('creds.delete', id), reveal: (id: number) => c<string>('creds.reveal', id),
  notes: (id: number) => c<Note[]>('notes.list', id), addNote: (id: number, body: string, pinned?: boolean) => c<Note>('notes.add', id, body, pinned),
  updateNote: (id: number, p: { body?: string; pinned?: boolean }) => c<Note>('notes.update', id, p), deleteNote: (id: number) => c<void>('notes.delete', id),
  tags: (pid?: number | null) => c<Tag[]>('tags.list', pid), addTags: (ids: number[], n: string[]) => c<void>('tags.add', ids, n), removeTags: (ids: number[], n: string[]) => c<void>('tags.remove', ids, n),
  activity: (id: number) => c<Activity[]>('activity.list', id), recent: (pid: number | null) => c<(Activity & { label: string })[]>('activity.recent', pid),
  savedFilters: () => c<SavedFilter[]>('filters.list'), saveFilter: (n: string, f: Filter) => c<void>('filters.save', n, f), deleteFilter: (id: number) => c<void>('filters.delete', id),
  settings: () => c<Record<string, any>>('settings.get'), setSetting: (k: string, v: unknown) => c<void>('settings.set', k, v), stats: (pid: number | null) => c<Stats>('stats.get', pid),
  connect: (hostId: number, proto?: string, port?: number, credId?: number) => c<ConnectCmd>('connect.build', hostId, proto, port, credId),
  importPreview: (kind: 'nmap' | 'csv', text: string) => c<any>('import.preview', kind, text),
  importApply: (kind: 'nmap' | 'csv', text: string, pid: number, o: { tag?: string; mapping?: Record<number, string> }) => c<{ created: number; updated: number; services: number; credentials: number }>('import.apply', kind, text, pid, o),
  sliverConfigs: () => c<string[]>('import.sliverConfigs'),
  sliverImport: (pid: number, o: { config?: string; tag?: string }) => c<{ created: number; updated: number; services: number; credentials: number; skipped: number }>('import.sliver', pid, o),
  sliverGet: (hostId: number) => c<HostSliver | null>('sliver.get', hostId),
  sliverSync: (pid: number, o: { config?: string; tag?: string } = {}) => c<{ created: number; updated: number; services: number; credentials: number; skipped: number }>('sliver.sync', pid, o),
  sliverPing: (hostId: number) => c<{ ok: boolean; output: string; ms?: number }>('sliver.ping', hostId),
  sliverExec: (hostId: number, command: string[]) => c<{ ok: boolean; output: string }>('sliver.exec', hostId, command),
  sliverShellArgv: (hostId: number) => c<string[]>('sliver.shellArgv', hostId),
  exportRender: (fmt: 'json' | 'csv' | 'md', f: Filter, secrets: boolean, ids?: number[]) => c<string>('export.render', fmt, f, secrets, ids),
}
