import { motion } from 'framer-motion'
import { Download, LayoutDashboard, Lock, Plus, RefreshCw, Search, Server, Settings, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from './api'
import { runCheck } from './HostsView'
import { useStore } from './store'

export default function Palette() {
  const s = useStore(); const [q, setQ] = useState(''); const [i, setI] = useState(0); const close = () => s.setModal(null)
  const items = useMemo(() => {
    const a = [
      { l: 'Add host', i: Plus, run: () => s.setModal({ kind: 'host' }) }, { l: 'Import Nmap / CSV', i: Upload, run: () => s.setModal({ kind: 'import' }) }, { l: 'Export hosts', i: Download, run: () => s.setModal({ kind: 'export' }) },
      { l: 'Check hosts in view', i: RefreshCw, run: () => void runCheck(s.hosts.map(h => h.id)) }, { l: 'Go to dashboard', i: LayoutDashboard, run: () => s.setView('dashboard') }, { l: 'Go to hosts', i: Server, run: () => s.setView('hosts') },
      { l: 'Settings', i: Settings, run: () => s.setModal({ kind: 'settings' }) }, { l: 'Lock vault', i: Lock, run: () => api.lock().then(() => s.setPhase('locked')) },
      ...s.projects.filter(p => !p.archived).map(p => ({ l: `Switch project: ${p.name}`, i: Server, run: () => s.setProject(p.id) })),
      ...s.hosts.slice(0, 200).map(h => ({ l: `Host: ${h.ip || h.hostname}${h.ip && h.hostname ? ' · ' + h.hostname : ''}`, i: Search, run: () => { s.setView('hosts'); s.open(h.id) } })),
    ]
    const t = q.toLowerCase().trim(); return (t ? a.filter(x => x.l.toLowerCase().includes(t)) : a).slice(0, 9)
  }, [q, s.hosts, s.projects]) // eslint-disable-line
  const go = (k: number) => { const it = items[k]; if (it) { close(); it.run() } }
  return <div className="fixed inset-0 z-[55] flex items-start justify-center bg-ink-900/40 p-4 pt-[14vh] backdrop-blur-sm" onMouseDown={e => e.target === e.currentTarget && close()}>
    <motion.div initial={{ y: -12, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} className="card w-full max-w-xl overflow-hidden shadow-pop" role="dialog" aria-label="Command palette">
      <div className="flex items-center gap-2 border-b border-ink-200 px-4"><Search size={16} className="text-brand-600" /><input autoFocus className="w-full py-3.5 text-sm outline-none" placeholder="Type a command or host…" value={q} onChange={e => { setQ(e.target.value); setI(0) }}
        onKeyDown={e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowDown') { e.preventDefault(); setI(v => Math.min(v + 1, items.length - 1)) } if (e.key === 'ArrowUp') { e.preventDefault(); setI(v => Math.max(v - 1, 0)) } if (e.key === 'Enter') go(i) }} /><span className="kbd">esc</span></div>
      <ul className="max-h-80 overflow-auto p-1.5">{items.map((it, k) => <li key={it.l}><button onMouseEnter={() => setI(k)} onClick={() => go(k)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${k === i ? 'bg-brand-50 text-brand-700' : ''}`}><it.i size={15} />{it.l}</button></li>)}{!items.length && <li className="p-6 text-center text-sm text-ink-400">No matches</li>}</ul></motion.div></div>
}
