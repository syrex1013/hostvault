import { AnimatePresence, motion } from 'framer-motion'
import { Archive, ChevronsLeft, FolderKanban, LayoutDashboard, Lock, Plus, Server, Settings, Star, Tag as TagIcon, Bookmark, X } from 'lucide-react'
import { api } from './api'
import { STATUS_META } from './ui'
import { useStore } from './store'
import { Logo } from './Unlock'
import type { Status } from '../../core/types'

export default function Sidebar() {
  const s = useStore()
  const { projects, projectId, stats, tags, saved, filter, view } = s
  const nav = (v: 'hosts' | 'dashboard') => s.setView(v)
  const Item = ({ active, onClick, children, count }: { active?: boolean; onClick: () => void; children: React.ReactNode; count?: number }) => (
    <button onClick={onClick} className={`group relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${active ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-ink-100'}`}>
      {active && <motion.span layoutId="nav-active" className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand-600" />}
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
      {count != null && <span className="text-xs tabular-nums text-ink-400">{count}</span>}
    </button>)
  const Head = ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => <div className="mb-1 mt-5 flex items-center justify-between px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{children}{action}</div>
  const cur = projects.find(p => p.id === projectId)
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-ink-200 bg-ink-50/70 backdrop-blur">
      <div className="drag flex h-14 items-center gap-2 px-4 pl-20"><Logo size={22} /><span className="font-semibold tracking-tight">Host<span className="text-brand-600">Vault</span></span>
        <button className="btn-ghost no-drag ml-auto !p-1 lg:hidden" aria-label="Close sidebar" onClick={s.toggleSidebar}><ChevronsLeft size={16} /></button></div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <Item active={view === 'dashboard'} onClick={() => nav('dashboard')}><LayoutDashboard size={15} />Dashboard</Item>
        <Item active={view === 'hosts' && !Object.keys(filter).length} onClick={() => { nav('hosts'); s.setFilter({}, true) }} count={stats?.total}><Server size={15} />All hosts</Item>
        <Item active={!!filter.favorite} onClick={() => { nav('hosts'); s.setFilter({ ...filter, favorite: !filter.favorite }, true) }}><Star size={15} />Favourites</Item>

        <Head action={<button aria-label="New project" className="rounded p-0.5 hover:bg-ink-200 hover:text-brand-600" onClick={() => s.setModal({ kind: 'project' })}><Plus size={13} /></button>}>Projects</Head>
        <Item active={projectId == null} onClick={() => s.setProject(null)}><FolderKanban size={15} />All projects</Item>
        {projects.map(p => (
          <div key={p.id} className="group relative">
            <Item active={projectId === p.id} onClick={() => s.setProject(p.id)}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} /><span className={`truncate ${p.archived ? 'text-ink-400 line-through' : ''}`}>{p.name}</span>{p.archived && <Archive size={11} className="text-ink-400" />}
            </Item>
            <button aria-label={`Edit ${p.name}`} className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded p-1 text-ink-400 hover:bg-ink-200 group-hover:block" onClick={() => s.setModal({ kind: 'project', project: p })}><Settings size={12} /></button>
          </div>))}

        <Head>Status</Head>
        {(['online', 'offline', 'dead', 'unknown'] as Status[]).map(st => {
          const on = filter.status?.length === 1 && filter.status[0] === st; const M = STATUS_META[st]
          return <Item key={st} active={on} count={stats?.status[st] ?? 0} onClick={() => { nav('hosts'); s.setFilter({ ...filter, status: on ? undefined : [st] }, true) }}><span className={`h-2 w-2 rounded-full ${M.dot}`} />{M.label}</Item>
        })}

        {tags.length > 0 && <><Head>Tags</Head>
          <AnimatePresence initial={false}>{tags.map(t => {
            const on = filter.tags?.includes(t.name)
            return <motion.div key={t.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <Item active={!!on} count={t.count} onClick={() => { nav('hosts'); const cur = filter.tags ?? []; s.setFilter({ ...filter, tags: on ? cur.filter(x => x !== t.name) : [...cur, t.name] }, true) }}><TagIcon size={13} />{t.name}</Item></motion.div>
          })}</AnimatePresence></>}

        {saved.length > 0 && <><Head>Saved filters</Head>
          {saved.map(f => <div key={f.id} className="group relative"><Item onClick={() => { nav('hosts'); s.setFilter(f.filter, true) }}><Bookmark size={13} />{f.name}</Item>
            <button aria-label={`Delete ${f.name}`} className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded p-1 text-ink-400 hover:text-brand-600 group-hover:block" onClick={async () => { await api.deleteFilter(f.id); void s.refresh() }}><X size={12} /></button></div>)}</>}
      </div>
      <div className="flex items-center gap-1 border-t border-ink-200 p-2">
        <div className="min-w-0 flex-1 px-2 text-xs text-ink-500"><div className="truncate font-medium text-ink-700">{cur?.name ?? 'All projects'}</div><div className="truncate">{cur?.client || `${stats?.total ?? 0} hosts`}</div></div>
        <button className="btn-ghost !p-2" aria-label="Settings" title="Settings" onClick={() => s.setModal({ kind: 'settings' })}><Settings size={16} /></button>
        <button className="btn-ghost !p-2 hover:!text-brand-600" aria-label="Lock vault" title="Lock (⌘L)" onClick={() => api.lock().then(() => s.setPhase('locked'))}><Lock size={16} /></button>
      </div>
    </aside>
  )
}
