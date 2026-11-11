export const STATUSES = ['unknown', 'online', 'offline', 'dead'] as const
export type Status = (typeof STATUSES)[number]
export const ACCESS_LEVELS = ['none', 'user', 'admin', 'root'] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]
export const CRED_KINDS = ['password', 'ssh-key', 'hash', 'token', 'cookie', 'other'] as const
export type CredKind = (typeof CRED_KINDS)[number]

export interface Project {
  id: number; name: string; client: string; scope: string
  startDate: string | null; endDate: string | null; color: string
  archived: boolean; createdAt: string
}
export interface Service {
  id: number; hostId: number; port: number; protocol: string
  name: string; product: string; version: string; state: string
}
export interface Credential {
  id: number; hostId: number; serviceId: number | null; kind: CredKind
  username: string; secret: string; domain: string; valid: boolean | null
  source: string; lastVerified: string | null; createdAt: string
}
export interface Note { id: number; hostId: number; body: string; pinned: boolean; createdAt: string; updatedAt: string }
export interface Activity { id: number; hostId: number; kind: string; detail: string; at: string }
export interface Tag { id: number; name: string; color: string; count?: number }
export interface Host {
  id: number; projectId: number; ip: string; hostname: string; mac: string; os: string; url: string
  status: Status; access: AccessLevel; favorite: boolean
  firstSeen: string; lastSeen: string; lastChecked: string | null
  tags: string[]; serviceCount: number; credCount: number; noteCount: number
}
export interface HostInput {
  projectId?: number; ip?: string; hostname?: string; mac?: string; os?: string; url?: string
  status?: Status; access?: AccessLevel; favorite?: boolean
}
export interface Filter {
  projectId?: number | null
  search?: string
  status?: Status[]
  access?: AccessLevel[]
  tags?: string[]
  os?: string
  port?: number
  service?: string
  hasCreds?: boolean
  favorite?: boolean
  seenWithinDays?: number
  sort?: 'ip' | 'hostname' | 'os' | 'status' | 'access' | 'lastSeen' | 'lastChecked' | 'created'
  desc?: boolean
  limit?: number
}
export interface SavedFilter { id: number; name: string; filter: Filter }
export interface HostSliver {
  hostId: number; implantId: string; name: string; kind: 'session' | 'beacon'
  configPath: string; health: string; lastMessage: string; syncedAt: string | null
}
