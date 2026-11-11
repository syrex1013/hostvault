import { AnimatePresence, motion } from 'framer-motion'
import { Bookmark, Filter as FilterIcon, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ACCESS_LEVELS, STATUSES, type Filter } from '../../core/types'
import { useStore } from './store'
import { STATUS_META, TagChip, useDebounced, useOutside } from './ui'

export default function FilterBar() {
  const { filter, setFilter, tags } = useStore(); const setModal = useStore(s => s.setModal)
  const [q, setQ] = useState(filter.search ?? ''); const dq = useDebounced(q, 180)
  const [open, setOpen] = useState(false); const ref = useOutside(() => setOpen(false))
  useEffect(() => { setQ(filter.search ?? '') }, [filter.search])
  useEffect(() => { if ((dq || undefined) !== (filter.search || undefined)) setFilter({ search: dq || undefined }) }, [dq]) // eslint-disable-line
  const toggle = <K extends 'status' | 'access'>(k: K, v: any) => { const cur = (filter[k] ?? []) as any[]; setFilter({ [k]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] } as Partial<Filter>) }
  const chips: { label: string; clear: () => void }[] = []
  filter.status?.forEach(x => chips.push({ label: `status: ${x}`, clear: () => toggle('status', x) }))
  filter.access?.forEach(x => chips.push({ label: `access: ${x}`, clear: () => toggle('access', x) }))
  filter.tags?.forEach(x => chips.push({ label: `#${x}`, clear: () => setFilter({ tags: filter.tags!.filter(t => t !== x) }) }))
  if (filter.os) chips.push({ label: `os: ${filter.os}`, clear: () => setFilter({ os: undefined }) })
  if (filter.port != null) chips.push({ label: `port: ${filter.port}`, clear: () => setFilter({ port: undefined }) })
  if (filter.service) chips.push({ label: `service: ${filter.service}`, clear: () => setFilter({ service: undefined }) })
  if (filter.hasCreds != null) chips.push({ label: filter.hasCreds ? 'has creds' : 'no creds', clear: () => setFilter({ hasCreds: undefined }) })
  if (filter.favorite) chips.push({ label: '★ favourites', clear: () => setFilter({ favorite: undefined }) })
  if (filter.seenWithinDays != null) chips.push({ label: `seen ≤ ${filter.seenWithinDays}d`, clear: () => setFilter({ seenWithinDays: undefined }) })
  const active = chips.length + (filter.search ? 1 : 0)
  return (
    <div className="flex flex-wrap items-center gap-2" ref={ref}>
      <div className="relative min-w-[200px] flex-1">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input id="search" className="input !pl-9 !pr-14" placeholder="Search IP, hostname, notes, services, users, tags…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search hosts" />
        {q ? <button aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-brand-600" onClick={() => setQ('')}><X size={14} /></button> : <span className="kbd absolute right-2 top-1/2 -translate-y-1/2">⌘F</span>}
      </div>
      <div className="relative">
        <button className={`btn-outline ${open || chips.length ? '!border-brand-300 !text-brand-700' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open}><FilterIcon size={14} />Filters{chips.length > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] text-white">{chips.length}</span>}</button>
        <AnimatePresence>{open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} className="card absolute right-0 z-30 mt-2 w-[min(92vw,380px)] space-y-4 p-4 shadow-pop">
            <div><div className="label">Status</div><div className="flex flex-wrap gap-1.5">{STATUSES.map(st => { const on = filter.status?.includes(st); return <button key={st} onClick={() => toggle('status', st)} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? STATUS_META[st].cls + ' ring-1 ring-current' : 'border-ink-200 text-ink-500 hover:border-brand-300'}`}>{STATUS_META[st].label}</button> })}</div></div>
            <div><div className="label">Access level</div><div className="flex flex-wrap gap-1.5">{ACCESS_LEVELS.map(a => { const on = filter.access?.includes(a); return <button key={a} onClick={() => toggle('access', a)} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-500 hover:border-brand-300'}`}>{a}</button> })}</div></div>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="label">OS contains</span><input className="input" value={filter.os ?? ''} onChange={e => setFilter({ os: e.target.value || undefined })} placeholder="windows" /></label>
              <label><span className="label">Service / product</span><input className="input" value={filter.service ?? ''} onChange={e => setFilter({ service: e.target.value || undefined })} placeholder="ssh, nginx" /></label>
              <label><span className="label">Open port</span><input className="input" inputMode="numeric" value={filter.port ?? ''} onChange={e => setFilter({ port: /^\d+$/.test(e.target.value) ? Number(e.target.value) : undefined })} placeholder="445" /></label>
              <label><span className="label">Seen within (days)</span><input className="input" inputMode="numeric" value={filter.seenWithinDays ?? ''} onChange={e => setFilter({ seenWithinDays: /^\d+$/.test(e.target.value) ? Number(e.target.value) : undefined })} placeholder="7" /></label>
            </div>
            <div><div className="label">Credentials</div><div className="flex gap-1.5">{([['Any', undefined], ['Has creds', true], ['No creds', false]] as const).map(([l, v]) => <button key={l} onClick={() => setFilter({ hasCreds: v })} className={`rounded-full border px-2.5 py-1 text-xs ${filter.hasCreds === v ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-500'}`}>{l}</button>)}</div></div>
            {tags.length > 0 && <div><div className="label">Tags (all of)</div><div className="flex flex-wrap gap-1.5">{tags.map(t => <button key={t.id} onClick={() => setFilter({ tags: filter.tags?.includes(t.name) ? filter.tags.filter(x => x !== t.name) : [...(filter.tags ?? []), t.name] })} className={`rounded-md px-1.5 py-0.5 text-xs ${filter.tags?.includes(t.name) ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-700'}`}>#{t.name}</button>)}</div></div>}
            <div className="flex justify-between border-t border-ink-200 pt-3"><button className="btn-ghost" onClick={() => setFilter({}, true)} disabled={!active}>Reset</button><button className="btn-outline" disabled={!active} onClick={() => { setOpen(false); setModal({ kind: 'saveFilter' }) }}><Bookmark size={13} />Save filter</button></div>
          </motion.div>)}</AnimatePresence>
      </div>
      {chips.length > 0 && <div className="flex w-full flex-wrap gap-1.5"><AnimatePresence initial={false}>{chips.map(c => <motion.span key={c.label} layout initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}><TagChip plain name={c.label} onRemove={c.clear} /></motion.span>)}</AnimatePresence></div>}
    </div>
  )
}
