import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, ArrowUp, Columns3, Download, KeyRound, Menu, Plus, Radio, RefreshCw, Star, Tag, Trash2, Upload, X } from 'lucide-react'
import { useState } from 'react'
import type { Filter, Host, Status } from '../../core/types'
import { api } from './api'
import FilterBar from './FilterBar'
import { ALL_COLUMNS, useStore, type Column } from './store'
import { AccessBadge, ago, StatusPill, STATUS_META, TagChip, useConfirm, useOutside } from './ui'

const COLS: Record<Column, { label: string; sort?: Filter['sort']; cls?: string }> = {
  status: { label: 'Status', sort: 'status' }, host: { label: 'Host', sort: 'ip' }, os: { label: 'OS', sort: 'os', cls: 'hidden md:table-cell' },
  access: { label: 'Access', sort: 'access' }, tags: { label: 'Tags', cls: 'hidden lg:table-cell' }, services: { label: 'Svc', cls: 'hidden md:table-cell' },
  creds: { label: 'Creds', cls: 'hidden md:table-cell' }, lastSeen: { label: 'Last seen', sort: 'lastSeen', cls: 'hidden xl:table-cell' }, lastChecked: { label: 'Checked', sort: 'lastChecked', cls: 'hidden xl:table-cell' },
}

export async function runCheck(ids: number[], mode: 'check' | 'ping' = 'check') {
  const st = useStore.getState(); if (!ids.length) return
  st.markBusy(ids, true); st.toast(`${mode === 'ping' ? 'Pinging' : 'Checking'} ${ids.length} host${ids.length > 1 ? 's' : ''}…`, 'info')
  try { const res = await (mode === 'ping' ? api.ping(ids) : api.check(ids)); const on = res.filter(r => r.status === 'online').length; st.toast(`${on} online, ${res.length - on} offline${res.length < ids.length ? `, ${ids.length - res.length} skipped (dead)` : ''}${mode === 'ping' ? ' — ICMP only, blocked ping reads offline' : ''}`) }
  catch (e) { st.toast((e as Error).message, 'err') } finally { st.markBusy(ids, false); await st.refresh() }
}

export default function HostsView() {
  const s = useStore(); const { hosts, filter, selected, openId, columns, busy } = s
  const [colMenu, setColMenu] = useState(false); const colRef = useOutside(() => setColMenu(false)); const [tagInput, setTagInput] = useState(false)
  const confirm = useConfirm()
  const allSel = hosts.length > 0 && hosts.every(h => selected.has(h.id))
  const ids = [...selected]
  const sortBy = (k: Filter['sort']) => s.setFilter(filter.sort === k ? { desc: !filter.desc } : { sort: k, desc: false })
  const fav = async (h: Host, e: React.MouseEvent) => { e.stopPropagation(); await api.updateHost(h.id, { favorite: !h.favorite }); void s.refresh() }
  const bulkStatus = async (st: Status) => { await api.setStatus(ids, st); s.toast(`Set ${ids.length} host(s) to ${st}`); void s.refresh() }
  const bulkDelete = () => confirm.ask(`Permanently delete ${ids.length} host${ids.length > 1 ? 's' : ''}, with their credentials and notes?`, async () => { await api.deleteHosts(ids); s.clearSel(); s.toast(`Deleted ${ids.length}`); void s.refresh() })
  const cell = (c: Column, h: Host) => {
    switch (c) {
      case 'status': return <StatusPill status={h.status} busy={busy.has(h.id)} />
      case 'host': return <div className="min-w-0"><div className="truncate font-mono text-[13px] font-medium">{h.ip || h.hostname}</div>{h.ip && h.hostname && <div className="truncate text-xs text-ink-500">{h.hostname}</div>}</div>
      case 'os': return <span className="truncate text-ink-700">{h.os || '—'}</span>
      case 'access': return <AccessBadge level={h.access} />
      case 'tags': return <div className="flex flex-wrap gap-1">{h.tags.slice(0, 3).map(t => <TagChip key={t} name={t} onClick={() => s.setFilter({ tags: [...(filter.tags ?? []).filter(x => x !== t), t] })} />)}{h.tags.length > 3 && <span className="text-xs text-ink-400">+{h.tags.length - 3}</span>}</div>
      case 'services': return <span className="tabular-nums text-ink-500">{h.serviceCount || '—'}</span>
      case 'creds': return h.credCount ? <span className="inline-flex items-center gap-1 text-brand-700"><KeyRound size={12} />{h.credCount}</span> : <span className="text-ink-400">—</span>
      case 'lastSeen': return <span className="text-xs text-ink-500">{ago(h.lastSeen)}</span>
      case 'lastChecked': return <span className="text-xs text-ink-500">{ago(h.lastChecked)}</span>
    }
  }
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="drag space-y-3 border-b border-ink-200 px-4 pb-3 pt-3 sm:px-6">
        <div className="no-drag flex items-center gap-2">
          <button className="btn-ghost !p-2 lg:hidden" aria-label="Toggle sidebar" onClick={s.toggleSidebar}><Menu size={18} /></button>
          <div className="min-w-0 flex-1"><h1 className="truncate text-lg font-semibold tracking-tight">Hosts</h1><p className="text-xs text-ink-500"><span className="tabular-nums">{hosts.length}</span> shown · <span className="tabular-nums">{s.stats?.total ?? 0}</span> total</p></div>
          <div className="relative" ref={colRef}>
            <button className="btn-ghost !p-2" aria-label="Choose columns" title="Columns" onClick={() => setColMenu(v => !v)}><Columns3 size={16} /></button>
            <AnimatePresence>{colMenu && <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card absolute right-0 z-30 mt-1 w-44 p-2 shadow-pop">
              {ALL_COLUMNS.map(c => <label key={c} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-ink-100"><input type="checkbox" className="accent-brand-600" checked={columns.includes(c)} disabled={c === 'host'} onChange={() => s.setColumns(ALL_COLUMNS.filter(x => x === c ? !columns.includes(c) : columns.includes(x)))} />{COLS[c].label}</label>)}</motion.div>}</AnimatePresence>
          </div>
          <button className="btn-outline" onClick={() => s.setModal({ kind: 'import' })}><Upload size={14} /><span className="hidden sm:inline">Import</span></button>
          <button className="btn-outline" onClick={() => s.setModal({ kind: 'export' })}><Download size={14} /><span className="hidden sm:inline">Export</span></button>
          <button className="btn-outline" disabled={!hosts.length} onClick={() => runCheck(selected.size ? ids : hosts.map(h => h.id))} title="Ping + TCP check, only on demand"><RefreshCw size={14} className={busy.size ? 'animate-spin' : ''} /><span className="hidden sm:inline">Check{selected.size ? ` ${selected.size}` : ''}</span></button>
          <button className="btn-outline" disabled={!hosts.length} onClick={() => runCheck(selected.size ? ids : hosts.map(h => h.id), 'ping')} title="ICMP ping only, on demand"><Radio size={14} /><span className="hidden sm:inline">Ping{selected.size ? ` ${selected.size}` : ''}</span></button>
          <button className="btn-primary" onClick={() => s.setModal({ kind: 'host' })}><Plus size={14} />Add host</button>
        </div>
        <div className="no-drag"><FilterBar /></div>
      </header>
      <div className="relative flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur"><tr>
            <th className="w-10 border-b border-ink-200 py-2 pl-4 sm:pl-6"><input type="checkbox" aria-label="Select all" className="accent-brand-600" checked={allSel} onChange={e => s.select(hosts.map(h => h.id), e.target.checked)} /></th>
            <th className="w-8 border-b border-ink-200" />
            {columns.map(c => { const m = COLS[c]; const on = m.sort && (filter.sort ?? 'ip') === m.sort
              return <th key={c} className={`border-b border-ink-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 ${m.cls ?? ''}`}>
                {m.sort ? <button onClick={() => sortBy(m.sort)} className={`inline-flex items-center gap-1 hover:text-brand-700 ${on ? 'text-brand-700' : ''}`}>{m.label}{on && (filter.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}</button> : m.label}</th> })}
          </tr></thead>
          <tbody>
            <AnimatePresence initial={false}>{hosts.map((h, i) => {
              const sel = selected.has(h.id); const open = openId === h.id
              return <motion.tr key={h.id} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.015 } }} exit={{ opacity: 0 }}
                onClick={() => s.open(open ? null : h.id)} className={`group cursor-pointer transition-colors ${open ? 'bg-brand-50' : sel ? 'bg-brand-50/50' : 'hover:bg-ink-50'} ${h.status === 'dead' ? 'opacity-60' : ''}`}>
                <td className="border-b border-ink-100 pl-4 sm:pl-6" style={{ paddingBlock: 'var(--row-py)' }} onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${h.ip || h.hostname}`} className="accent-brand-600" checked={sel} onChange={e => s.select([h.id], e.target.checked)} /></td>
                <td className="border-b border-ink-100" onClick={e => fav(h, e)}><Star size={14} className={h.favorite ? 'fill-brand-600 text-brand-600' : 'text-ink-200 group-hover:text-ink-400'} /></td>
                {columns.map(c => <td key={c} className={`border-b border-ink-100 px-3 ${COLS[c].cls ?? ''}`} style={{ paddingBlock: 'var(--row-py)' }}>{cell(c, h)}</td>)}
              </motion.tr> })}</AnimatePresence>
          </tbody>
        </table>
        {!hosts.length && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <div className="rounded-2xl bg-brand-50 p-4 text-brand-600"><Plus size={28} /></div>
          <p className="font-medium">{Object.keys(filter).length ? 'No hosts match these filters' : 'No hosts yet'}</p>
          <p className="max-w-xs text-sm text-ink-500">{Object.keys(filter).length ? 'Try removing a filter or searching for something else.' : 'Add a host manually or import an Nmap XML / CSV file.'}</p>
          <div className="flex gap-2">{Object.keys(filter).length ? <button className="btn-outline" onClick={() => s.setFilter({}, true)}>Clear filters</button> : <><button className="btn-primary" onClick={() => s.setModal({ kind: 'host' })}>Add host</button><button className="btn-outline" onClick={() => s.setModal({ kind: 'import' })}>Import</button></>}</div></motion.div>}
      </div>
      <AnimatePresence>{selected.size > 0 && (
        <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          className="absolute inset-x-0 bottom-4 z-20 mx-auto flex w-fit max-w-[95vw] flex-wrap items-center gap-1 rounded-2xl border border-ink-200 bg-white px-3 py-2 shadow-pop">
          <span className="px-2 text-sm font-medium"><span className="text-brand-600">{selected.size}</span> selected</span>
          {(['online', 'offline', 'dead', 'unknown'] as Status[]).map(st => <button key={st} className="btn-ghost !px-2" onClick={() => bulkStatus(st)}><span className={`h-2 w-2 rounded-full ${STATUS_META[st].dot}`} />{STATUS_META[st].label}</button>)}
          <span className="mx-1 h-5 w-px bg-ink-200" />
          {tagInput ? <input autoFocus className="input !w-36" placeholder="tag1, tag2 ↵" onBlur={() => setTagInput(false)} onKeyDown={async e => { if (e.key === 'Escape') setTagInput(false); if (e.key === 'Enter') { const v = e.currentTarget.value.split(',').map(x => x.trim()).filter(Boolean); if (v.length) { await api.addTags(ids, v); s.toast(`Tagged ${ids.length} host(s)`); void s.refresh() } setTagInput(false) } }} />
            : <button className="btn-ghost" onClick={() => setTagInput(true)}><Tag size={14} />Tag</button>}
          <button className="btn-ghost" onClick={() => runCheck(ids)}><RefreshCw size={14} />Check</button>
          <button className="btn-ghost" onClick={() => runCheck(ids, 'ping')}><Radio size={14} />Ping</button>
          <button className="btn-ghost" onClick={() => s.setModal({ kind: 'export' })}><Download size={14} />Export</button>
          <button className="btn-danger" onClick={bulkDelete}><Trash2 size={14} />Delete</button>
          <button className="btn-ghost !p-1.5" aria-label="Clear selection" onClick={s.clearSel}><X size={14} /></button>
        </motion.div>)}</AnimatePresence>
      {confirm.node}
    </div>
  )
}
