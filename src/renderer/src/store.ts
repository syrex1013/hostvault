import { create } from 'zustand'
import type { Filter, Host, Project, SavedFilter, Tag } from '../../core/types'
import { api, type Stats } from './api'

export type Phase = 'loading' | 'create' | 'locked' | 'ready'
export type Modal = null | { kind: 'host'; host?: Host } | { kind: 'import' } | { kind: 'export' } | { kind: 'settings' } | { kind: 'project'; project?: Project } | { kind: 'palette' } | { kind: 'connect'; host: Host } | { kind: 'saveFilter' }
export interface Toast { id: number; text: string; tone: 'ok' | 'err' | 'info' }
export const ALL_COLUMNS = ['status', 'host', 'os', 'access', 'tags', 'services', 'creds', 'lastSeen', 'lastChecked'] as const
export type Column = (typeof ALL_COLUMNS)[number]

interface S {
  phase: Phase; vaultPath: string; view: 'hosts' | 'dashboard'
  projects: Project[]; projectId: number | null; filter: Filter; hosts: Host[]; tags: Tag[]; stats: Stats | null; saved: SavedFilter[]
  settings: Record<string, any>; selected: Set<number>; openId: number | null; modal: Modal; toasts: Toast[]; busy: Set<number>; sidebarOpen: boolean
  columns: Column[]
  boot: () => Promise<void>; enter: () => Promise<void>; refresh: () => Promise<void>; setFilter: (f: Partial<Filter>, replace?: boolean) => void
  setProject: (id: number | null) => void; toast: (text: string, tone?: Toast['tone']) => void; setModal: (m: Modal) => void
  select: (ids: number[], on: boolean) => void; clearSel: () => void; open: (id: number | null) => void; setSetting: (k: string, v: unknown) => Promise<void>
  setView: (v: 'hosts' | 'dashboard') => void; setPhase: (p: Phase) => void; toggleSidebar: () => void; setColumns: (c: Column[]) => void; markBusy: (ids: number[], on: boolean) => void
}
let tid = 0
let seq = 0
export const useStore = create<S>((set, get) => ({
  phase: 'loading', vaultPath: '', view: 'hosts', projects: [], projectId: null, filter: {}, hosts: [], tags: [], stats: null, saved: [], settings: {},
  selected: new Set(), openId: null, modal: null, toasts: [], busy: new Set(), sidebarOpen: false, columns: [...ALL_COLUMNS],
  async boot() { const s = await api.status(); set({ vaultPath: s.path, phase: s.unlocked ? 'ready' : s.exists ? 'locked' : 'create' }); if (s.unlocked) await get().enter() },
  async enter() {
    const [projects, settings] = await Promise.all([api.projects(), api.settings()])
    const active = projects.find(p => p.id === settings.activeProject && !p.archived) ?? projects.find(p => !p.archived) ?? projects[0]
    set({ projects, settings, projectId: settings.activeProject === 0 ? null : active.id, phase: 'ready', columns: settings.columns ?? [...ALL_COLUMNS], selected: new Set(), openId: null })
    await get().refresh()
  },
  async refresh() {
    const my = ++seq; const { filter, projectId } = get(); const f = { ...filter, projectId }
    try {
      const [hosts, tags, stats, saved, projects] = await Promise.all([api.hosts(f), api.tags(projectId), api.stats(projectId), api.savedFilters(), api.projects()])
      if (my !== seq) return
      const ids = new Set(hosts.map(h => h.id))
      set(s => ({ hosts, tags, stats, saved, projects, selected: new Set([...s.selected].filter(i => ids.has(i))), openId: s.openId != null && !ids.has(s.openId) ? null : s.openId }))
    } catch (e) { if (my === seq) get().toast((e as Error).message, 'err') }
  },
  setFilter(f, replace) { set(s => ({ filter: replace ? f : { ...s.filter, ...f } })); void get().refresh() },
  setProject(id) { set({ projectId: id, selected: new Set(), openId: null }); void api.setSetting('activeProject', id ?? 0); void get().refresh() },
  toast(text, tone = 'ok') { const id = ++tid; set(s => ({ toasts: [...s.toasts, { id, text, tone }] })); setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), tone === 'err' ? 6000 : 3200) },
  setModal: modal => set({ modal }),
  select(ids, on) { set(s => { const n = new Set(s.selected); ids.forEach(i => (on ? n.add(i) : n.delete(i))); return { selected: n } }) },
  clearSel: () => set({ selected: new Set() }), open: id => set({ openId: id }),
  async setSetting(k, v) { set(s => ({ settings: { ...s.settings, [k]: v } })); await api.setSetting(k, v) },
  setView: view => set({ view }), setPhase: phase => set({ phase, ...(phase !== 'ready' ? { hosts: [], stats: null, selected: new Set(), openId: null, modal: null, settings: {} } : {}) }),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  setColumns(columns) { set({ columns }); void api.setSetting('columns', columns) },
  markBusy(ids, on) { set(s => { const n = new Set(s.busy); ids.forEach(i => (on ? n.add(i) : n.delete(i))); return { busy: n } }) },
}))
