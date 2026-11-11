import { motion } from 'framer-motion'
import { KeyRound, Menu, ServerCog, ShieldAlert, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { useStore } from './store'
import { ago, STATUS_META } from './ui'
import type { Status } from '../../core/types'

function Counter({ to }: { to: number }) {
  const [n, setN] = useState(0)
  useEffect(() => { let raf = 0; const t0 = performance.now(); const step = (t: number) => { const p = Math.min(1, (t - t0) / 600); setN(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(step) }; raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf) }, [to])
  return <>{n}</>
}
function Bar({ label, value, max, color, onClick }: { label: string; value: number; max: number; color: string; onClick?: () => void }) {
  return <button onClick={onClick} className="group block w-full text-left"><div className="mb-1 flex justify-between text-sm"><span className="truncate text-ink-700 group-hover:text-brand-700">{label}</span><span className="tabular-nums text-ink-500">{value}</span></div>
    <div className="h-2 overflow-hidden rounded-full bg-ink-100"><motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${max ? (value / max) * 100 : 0}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} /></div></button>
}
export default function Dashboard() {
  const s = useStore(); const st = s.stats
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof api.recent>>>([])
  useEffect(() => { api.recent(s.projectId).then(setRecent).catch(() => {}) }, [s.projectId, s.hosts])
  if (!st) return null
  const go = (f: object) => { s.setView('hosts'); s.setFilter(f, true) }
  const cards = [
    { l: 'Total hosts', v: st.total, i: ServerCog, onClick: () => go({}) }, { l: 'Online now', v: st.status.online ?? 0, i: Wifi, onClick: () => go({ status: ['online'] }) },
    { l: 'Admin / root access', v: (st.access.admin ?? 0) + (st.access.root ?? 0), i: ShieldAlert, onClick: () => go({ access: ['admin', 'root'] }) }, { l: 'Credentials stored', v: st.creds, i: KeyRound, onClick: () => go({ hasCreds: true }) },
  ]
  const maxAcc = Math.max(1, ...Object.values(st.access)); const maxOs = Math.max(1, ...st.os.map(o => o.count))
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-auto">
      <header className="drag flex items-center gap-2 border-b border-ink-200 px-4 py-4 sm:px-6"><button className="btn-ghost no-drag !p-2 lg:hidden" aria-label="Toggle sidebar" onClick={s.toggleSidebar}><Menu size={18} /></button><div><h1 className="text-lg font-semibold tracking-tight">Dashboard</h1><p className="text-xs text-ink-500">{s.projects.find(p => p.id === s.projectId)?.name ?? 'All projects'}</p></div></header>
      <div className="space-y-5 p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map((c, i) => (
          <motion.button key={c.l} onClick={c.onClick} initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: i * 0.06 }} whileHover={{ y: -3 }} className="card group p-5 text-left transition-shadow hover:border-brand-300 hover:shadow-pop">
            <div className="flex items-center justify-between text-ink-500"><span className="text-sm">{c.l}</span><c.i size={16} className="text-brand-600" /></div>
            <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight"><Counter to={c.v} /></div></motion.button>))}</div>
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="card p-5"><h2 className="mb-4 text-sm font-semibold">By status</h2>
            <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-ink-100">{(['online', 'offline', 'unknown', 'dead'] as Status[]).map(k => st.total ? <motion.div key={k} title={`${k}: ${st.status[k] ?? 0}`} className={STATUS_META[k].dot} initial={{ width: 0 }} animate={{ width: `${((st.status[k] ?? 0) / st.total) * 100}%` }} transition={{ duration: 0.8 }} /> : null)}</div>
            <div className="space-y-3">{(['online', 'offline', 'unknown', 'dead'] as Status[]).map(k => <Bar key={k} label={STATUS_META[k].label} value={st.status[k] ?? 0} max={st.total} color={k === 'online' ? '#22c55e' : k === 'offline' ? '#f59e0b' : k === 'dead' ? '#dc2626' : '#a1a1aa'} onClick={() => go({ status: [k] })} />)}</div></section>
          <section className="card p-5"><h2 className="mb-4 text-sm font-semibold">Access level</h2><div className="space-y-3">{(['root', 'admin', 'user', 'none'] as const).map(k => <Bar key={k} label={k} value={st.access[k] ?? 0} max={maxAcc} color={k === 'none' ? '#d4d4d8' : '#dc2626'} onClick={() => go({ access: [k] })} />)}</div></section>
          <section className="card p-5"><h2 className="mb-4 text-sm font-semibold">Operating systems</h2><div className="space-y-3">{st.os.slice(0, 6).map(o => <Bar key={o.name} label={o.name} value={o.count} max={maxOs} color="#ef4444" onClick={() => go({ os: o.name === 'Unknown' ? undefined : o.name })} />)}{!st.os.length && <p className="text-sm text-ink-400">No data yet</p>}</div></section>
        </div>
        <section className="card p-5"><h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
          {recent.length ? <ul className="divide-y divide-ink-100">{recent.map(a => <motion.li key={a.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 py-2 text-sm"><span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-500">{a.kind}</span><button className="font-mono text-[13px] hover:text-brand-700" onClick={() => { s.setView('hosts'); s.open(a.hostId) }}>{a.label}</button><span className="min-w-0 flex-1 truncate text-ink-500">{a.detail}</span><span className="text-xs text-ink-400">{ago(a.at)}</span></motion.li>)}</ul> : <p className="text-sm text-ink-400">Nothing yet.</p>}</section>
      </div>
    </div>
  )
}
