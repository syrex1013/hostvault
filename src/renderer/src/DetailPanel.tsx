import { AnimatePresence, motion } from 'framer-motion'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { Check, Copy, Eye, EyeOff, KeyRound, Pencil, Pin, PinOff, Plug, Plus, Radio, RefreshCw, Star, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ACCESS_LEVELS, CRED_KINDS, STATUSES, type Activity, type CredKind, type Host, type HostSliver, type Note, type Service } from '../../core/types'
import { api, type MaskedCred } from './api'
import { runCheck } from './HostsView'
import { useStore } from './store'
import { AccessBadge, ago, Field, fmtDate, StatusPill, STATUS_META, TagChip, useConfirm } from './ui'

const TABS = ['Overview', 'Services', 'Access', 'Notes', 'Activity'] as const
type Tab = (typeof TABS)[number]

export default function DetailPanel() {
  const s = useStore(); const host = s.hosts.find(h => h.id === s.openId)
  const [tab, setTab] = useState<Tab>('Overview')
  useEffect(() => { setTab('Overview') }, [s.openId])
  return (
    <AnimatePresence>{host && (
      <>
        <motion.div className="fixed inset-0 z-30 bg-ink-900/20 xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => s.open(null)} />
        <motion.aside key="panel" role="complementary" aria-label="Host details" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          className="fixed inset-y-0 right-0 z-40 flex w-[min(100vw,440px)] flex-col border-l border-ink-200 bg-white shadow-pop xl:static xl:z-auto xl:shadow-none">
          <Header host={host} />
          <div className="relative flex gap-1 border-b border-ink-200 px-3">{TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`relative px-3 py-2.5 text-sm transition ${tab === t ? 'font-medium text-brand-700' : 'text-ink-500 hover:text-ink-900'}`}>{t}
              {t === 'Access' && host.credCount > 0 && <span className="ml-1 rounded-full bg-brand-100 px-1.5 text-[10px] text-brand-700">{host.credCount}</span>}
              {t === 'Notes' && host.noteCount > 0 && <span className="ml-1 rounded-full bg-ink-100 px-1.5 text-[10px]">{host.noteCount}</span>}
              {tab === t && <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />}</button>))}</div>
          <div className="flex-1 overflow-y-auto p-4">
            <AnimatePresence mode="wait"><motion.div key={tab + host.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              {tab === 'Overview' && <Overview host={host} />}{tab === 'Services' && <Services host={host} />}{tab === 'Access' && <Access host={host} />}{tab === 'Notes' && <Notes host={host} />}{tab === 'Activity' && <ActivityTab host={host} />}
            </motion.div></AnimatePresence>
          </div>
        </motion.aside>
      </>)}</AnimatePresence>
  )
}

function Header({ host }: { host: Host }) {
  const s = useStore(); const busy = s.busy.has(host.id)
  const setStatus = async (st: typeof STATUSES[number]) => { await api.setStatus([host.id], st); void s.refresh() }
  return (
    <div className="drag border-b border-ink-200 p-4 pt-5">
      <div className="no-drag flex items-start gap-2">
        <div className="min-w-0 flex-1"><div className="truncate font-mono text-lg font-semibold">{host.ip || host.hostname}</div>{host.ip && host.hostname && <div className="truncate text-sm text-ink-500">{host.hostname}</div>}</div>
        <button aria-label="Favourite" className="btn-ghost !p-1.5" onClick={async () => { await api.updateHost(host.id, { favorite: !host.favorite }); void s.refresh() }}><Star size={16} className={host.favorite ? 'fill-brand-600 text-brand-600' : ''} /></button>
        <button aria-label="Close panel" className="btn-ghost !p-1.5" onClick={() => s.open(null)}><X size={16} /></button>
      </div>
      <div className="no-drag mt-3 flex items-center gap-2"><StatusPill status={host.status} busy={busy} /><AccessBadge level={host.access} /><span className="text-xs text-ink-400">checked {ago(host.lastChecked)}</span>
        <div className="ml-auto flex gap-1"><button className="btn-outline !px-2" title="Check now" disabled={host.status === 'dead'} onClick={() => runCheck([host.id])}><RefreshCw size={13} className={busy ? 'animate-spin' : ''} /></button>
          <button className="btn-outline !px-2" title="Ping now (ICMP only)" disabled={host.status === 'dead'} onClick={() => runCheck([host.id], 'ping')}><Radio size={13} /></button>
          <button className="btn-outline !px-2" title="Quick connect" onClick={() => s.setModal({ kind: 'connect', host })}><Plug size={13} /></button><button className="btn-outline !px-2" title="Edit host" onClick={() => s.setModal({ kind: 'host', host })}><Pencil size={13} /></button></div></div>
      <div className="no-drag mt-3 grid grid-cols-4 gap-1 rounded-lg bg-ink-100 p-1" role="radiogroup" aria-label="Status">{STATUSES.map(st => (
        <button key={st} role="radio" aria-checked={host.status === st} onClick={() => setStatus(st)} className={`relative rounded-md py-1 text-xs font-medium transition ${host.status === st ? 'text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}>
          {host.status === st && <motion.span layoutId="status-seg" className="absolute inset-0 rounded-md bg-white shadow-sm" />}<span className="relative flex items-center justify-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[st].dot}`} />{STATUS_META[st].label}</span></button>))}</div>
    </div>
  )
}

function Overview({ host }: { host: Host }) {
  const s = useStore(); const [t, setT] = useState(''); const [sliver, setSliver] = useState<HostSliver | null>(null)
  const [execCmd, setExecCmd] = useState(''); const [execOut, setExecOut] = useState(''); const [busy, setBusy] = useState(false)
  const addTag = async () => { const v = t.split(',').map(x => x.trim()).filter(Boolean); if (!v.length) return; await api.addTags([host.id], v); setT(''); void s.refresh() }
  useEffect(() => { setExecOut(''); setExecCmd(''); api.sliverGet(host.id).then(setSliver).catch(() => setSliver(null)) }, [host.id])
  const row = (k: string, v: string, mono = false) => <div className="flex justify-between gap-4 border-b border-ink-100 py-2 text-sm"><span className="text-ink-500">{k}</span><span className={`truncate text-right ${mono ? 'font-mono text-[13px]' : ''}`}>{v || '—'}</span></div>
  const doPing = async () => { setBusy(true); try { const r = await api.sliverPing(host.id); s.toast(r.ok ? `Sliver alive${r.ms != null ? ` (${r.ms}ms)` : ''}` : 'Sliver unreachable'); setSliver(await api.sliverGet(host.id)); await s.refresh() } catch (e) { s.toast((e as Error).message, 'err') } finally { setBusy(false) } }
  const doShell = async () => { try { const argv = await api.sliverShellArgv(host.id); await window.hv.openTerminal(argv) } catch (e) { s.toast((e as Error).message, 'err') } }
  const doExec = async () => { if (!execCmd.trim()) return; setBusy(true); try { const r = await api.sliverExec(host.id, [execCmd.trim()]); setExecOut(r.output || '(no output)') } catch (e) { setExecOut((e as Error).message); s.toast((e as Error).message, 'err') } finally { setBusy(false) } }
  return <div>
    {row('IP', host.ip, true)}{row('Hostname', host.hostname)}{row('MAC', host.mac, true)}{row('OS', host.os)}
    <div className="flex justify-between gap-4 border-b border-ink-100 py-2 text-sm"><span className="text-ink-500">URL</span>{host.url ? <button className="truncate text-right text-brand-700 hover:underline" title="Open in browser" onClick={() => window.hv.openUrl(host.url)}>{host.url}</button> : <span>—</span>}</div>
    <div className="flex items-center justify-between border-b border-ink-100 py-2 text-sm"><span className="text-ink-500">Access level</span>
      <select className="input !w-auto !py-1" value={host.access} aria-label="Access level" onChange={async e => { await api.updateHost(host.id, { access: e.target.value as Host['access'] }); void s.refresh() }}>{ACCESS_LEVELS.map(a => <option key={a}>{a}</option>)}</select></div>
    {row('First seen', fmtDate(host.firstSeen))}{row('Last seen', fmtDate(host.lastSeen))}{row('Last checked', fmtDate(host.lastChecked))}
    {sliver && <div className="mt-4 rounded-lg border border-ink-200 bg-ink-50 p-3">
      <div className="mb-2 flex items-center justify-between"><div className="text-sm font-medium">Sliver {sliver.kind}</div><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${/alive/i.test(sliver.health) ? 'bg-emerald-100 text-emerald-700' : 'bg-ink-200 text-ink-600'}`}>{sliver.health || sliver.kind}</span></div>
      <div className="space-y-1 text-xs text-ink-500"><div><span className="text-ink-400">id </span><span className="font-mono text-ink-800">{sliver.implantId}</span></div>
        {sliver.name && <div><span className="text-ink-400">name </span><span className="font-mono text-ink-800">{sliver.name}</span></div>}
        {sliver.lastMessage && <div><span className="text-ink-400">rtt </span>{sliver.lastMessage}</div>}
        <div><span className="text-ink-400">synced </span>{ago(sliver.syncedAt)}</div></div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button className="btn-outline !px-2 !py-1 text-xs" disabled={busy} onClick={doPing}><Radio size={12} />C2 ping</button>
        {sliver.kind === 'session' && <button className="btn-outline !px-2 !py-1 text-xs" onClick={doShell}>Open shell</button>}
        {sliver.kind === 'session' && <button className="btn-outline !px-2 !py-1 text-xs" onClick={() => s.setModal({ kind: 'connect', host })}>Connect…</button>}
      </div>
      {sliver.kind === 'session' && <div className="mt-3 flex gap-2"><input className="input font-mono text-xs" placeholder="execute command…" value={execCmd} disabled={busy} onChange={e => setExecCmd(e.target.value)} onKeyDown={e => e.key === 'Enter' && doExec()} /><button className="btn-primary !px-2.5" disabled={busy || !execCmd.trim()} onClick={doExec}>Run</button></div>}
      {execOut && <pre className="mt-2 max-h-40 overflow-auto rounded bg-ink-900 p-2 font-mono text-[11px] text-ink-100 whitespace-pre-wrap">{execOut}</pre>}
    </div>}
    <div className="mt-4"><div className="label">Tags</div><div className="flex flex-wrap gap-1.5"><AnimatePresence>{host.tags.map(x => <motion.span key={x} layout initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }}><TagChip name={x} onRemove={async () => { await api.removeTags([host.id], [x]); void s.refresh() }} /></motion.span>)}</AnimatePresence></div>
      <input className="input mt-2" placeholder="Add tags (comma separated) and press Enter" value={t} onChange={e => setT(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTag()} list="tag-suggest" /><datalist id="tag-suggest">{s.tags.map(x => <option key={x.id} value={x.name} />)}</datalist></div>
  </div>
}

function Services({ host }: { host: Host }) {
  const [rows, setRows] = useState<Service[]>([]); const [f, setF] = useState({ port: '', name: '', product: '' }); const s = useStore()
  const load = useCallback(() => api.services(host.id).then(setRows), [host.id]); useEffect(() => { void load() }, [load])
  const add = async () => { const port = Number(f.port); if (!Number.isInteger(port) || port < 0 || port > 65535) return s.toast('Enter a valid port (0–65535)', 'err'); await api.upsertService(host.id, { port, name: f.name, product: f.product }); setF({ port: '', name: '', product: '' }); await load(); void s.refresh() }
  return <div>
    <div className="mb-3 grid grid-cols-[70px_1fr_1fr_auto] gap-2"><input className="input" placeholder="Port" inputMode="numeric" value={f.port} onChange={e => setF({ ...f, port: e.target.value })} aria-label="Port" /><input className="input" placeholder="Service" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} aria-label="Service" /><input className="input" placeholder="Product / version" value={f.product} onChange={e => setF({ ...f, product: e.target.value })} aria-label="Product" onKeyDown={e => e.key === 'Enter' && add()} /><button className="btn-primary !px-2.5" aria-label="Add service" onClick={add}><Plus size={14} /></button></div>
    {!rows.length && <p className="py-8 text-center text-sm text-ink-400">No services recorded.</p>}
    <ul className="divide-y divide-ink-100">{rows.map(r => <li key={r.id} className="group flex items-center gap-3 py-2 text-sm"><span className="w-20 font-mono text-[13px] font-medium text-brand-700">{r.port}/{r.protocol}</span><span className="w-24 truncate">{r.name || '—'}</span><span className="min-w-0 flex-1 truncate text-ink-500">{[r.product, r.version].filter(Boolean).join(' ')}</span>
      <button aria-label="Delete service" className="invisible rounded p-1 text-ink-400 hover:text-brand-600 group-hover:visible" onClick={async () => { await api.deleteService(r.id); await load(); void s.refresh() }}><Trash2 size={13} /></button></li>)}</ul></div>
}

function Access({ host }: { host: Host }) {
  const s = useStore(); const [rows, setRows] = useState<MaskedCred[]>([]); const [shown, setShown] = useState<Record<number, string>>({}); const [form, setForm] = useState<null | { id?: number; kind: CredKind; username: string; domain: string; secret: string; source: string; valid: boolean | null }>(null)
  const [copied, setCopied] = useState<number | null>(null); const confirm = useConfirm()
  const load = useCallback(() => api.creds(host.id).then(setRows), [host.id]); useEffect(() => { setShown({}); void load() }, [load])
  const reveal = async (c: MaskedCred) => { if (c.id in shown) return setShown(({ [c.id]: _, ...r }) => r); const v = await api.reveal(c.id); setShown(p => ({ ...p, [c.id]: v })); setTimeout(() => setShown(({ [c.id]: _, ...r }) => r), 15000) }
  const save = async () => { if (!form) return; const { id, ...p } = form; try { if (id) await api.updateCred(id, p.secret ? p : { ...p, secret: undefined } as any); else await api.addCred(host.id, p); setForm(null); await load(); void s.refresh() } catch (e) { s.toast((e as Error).message, 'err') } }
  const edit = async (c: MaskedCred) => setForm({ id: c.id, kind: c.kind, username: c.username, domain: c.domain, secret: '', source: c.source, valid: c.valid })
  return <div>
    <button className="btn-primary mb-3 w-full" onClick={() => setForm({ kind: 'password', username: '', domain: '', secret: '', source: '', valid: null })}><Plus size={14} />Add access data</button>
    <AnimatePresence>{form && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="card mb-3 space-y-3 bg-ink-50 p-3">
      <div className="grid grid-cols-2 gap-2"><Field label="Type"><select className="input" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as CredKind })}>{CRED_KINDS.map(k => <option key={k}>{k}</option>)}</select></Field><Field label="Verified"><select className="input" value={String(form.valid)} onChange={e => setForm({ ...form, valid: e.target.value === 'null' ? null : e.target.value === 'true' })}><option value="null">Unknown</option><option value="true">Valid</option><option value="false">Invalid</option></select></Field></div>
      <div className="grid grid-cols-2 gap-2"><Field label="Username"><input className="input" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} autoComplete="off" /></Field><Field label="Domain"><input className="input" value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} /></Field></div>
      <Field label={form.kind === 'ssh-key' ? 'Private key' : 'Secret'} hint={form.id ? 'Leave empty to keep the stored secret' : undefined}>{form.kind === 'ssh-key' || form.kind === 'cookie' || form.kind === 'token' ? <textarea className="input h-24 font-mono text-xs" value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })} spellCheck={false} /> : <input className="input font-mono" type="text" value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })} autoComplete="off" spellCheck={false} />}</Field>
      <Field label="Source"><input className="input" placeholder="where it was obtained" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} /></Field>
      <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={() => setForm(null)}>Cancel</button><button className="btn-primary" onClick={save}>{form.id ? 'Save' : 'Add'}</button></div></div></motion.div>}</AnimatePresence>
    {!rows.length && !form && <p className="py-8 text-center text-sm text-ink-400">No access data stored.</p>}
    <ul className="space-y-2"><AnimatePresence initial={false}>{rows.map(c => (
      <motion.li key={c.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} className="card p-3">
        <div className="flex items-center gap-2"><KeyRound size={14} className="text-brand-600" /><span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-500">{c.kind}</span><span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium">{c.domain ? c.domain + '\\' : ''}{c.username || '(no user)'}</span>
          {c.valid != null && <span className={`text-[10px] font-semibold uppercase ${c.valid ? 'text-emerald-600' : 'text-brand-600'}`}>{c.valid ? 'valid' : 'invalid'}</span>}</div>
        <div className="mt-2 flex items-center gap-1"><code className="min-w-0 flex-1 truncate rounded bg-ink-50 px-2 py-1 font-mono text-xs">{c.id in shown ? shown[c.id].split('\n')[0] : c.hasSecret ? '••••••••••••' : 'no secret'}</code>
          <button className="btn-ghost !p-1.5" aria-label={c.id in shown ? 'Hide secret' : 'Reveal secret'} disabled={!c.hasSecret} onClick={() => reveal(c)}>{c.id in shown ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          <button className="btn-ghost !p-1.5" aria-label="Copy secret" disabled={!c.hasSecret} onClick={async () => { await window.hv.copyCred(c.id); setCopied(c.id); setTimeout(() => setCopied(null), 1200); s.toast(`Copied — clipboard clears in ${s.settings.clipboardClearSeconds ?? 30}s`) }}>{copied === c.id ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}</button>
          <button className="btn-ghost !p-1.5" aria-label="Copy username" title="Copy username" disabled={!c.username} onClick={() => { void window.hv.copy(c.username); s.toast('Username copied') }}><span className="text-[10px] font-bold">U</span></button>
          <button className="btn-ghost !p-1.5" aria-label="Edit" onClick={() => edit(c)}><Pencil size={14} /></button>
          <button className="btn-ghost !p-1.5 hover:!text-brand-600" aria-label="Delete" onClick={() => confirm.ask(`Delete this ${c.kind} for ${c.username || 'this host'}?`, async () => { await api.deleteCred(c.id); await load(); void s.refresh() })}><Trash2 size={14} /></button></div>
        {(c.source || c.lastVerified) && <p className="mt-1.5 text-xs text-ink-400">{c.source && `Source: ${c.source}`}</p>}
      </motion.li>))}</AnimatePresence></ul>{confirm.node}</div>
}

function Notes({ host }: { host: Host }) {
  const s = useStore(); const [rows, setRows] = useState<Note[]>([]); const [text, setText] = useState(''); const [preview, setPreview] = useState(false); const [editing, setEditing] = useState<number | null>(null)
  const load = useCallback(() => api.notes(host.id).then(setRows), [host.id]); useEffect(() => { void load() }, [load])
  const render = (md: string) => ({ __html: DOMPurify.sanitize(marked.parse(md, { async: false }) as string, { FORBID_TAGS: ['style', 'img', 'iframe'], FORBID_ATTR: ['style'] }) })
  const save = async () => { if (!text.trim()) return; try { if (editing) await api.updateNote(editing, { body: text }); else await api.addNote(host.id, text); setText(''); setEditing(null); setPreview(false); await load(); void s.refresh() } catch (e) { s.toast((e as Error).message, 'err') } }
  return <div>
    <div className="card mb-4 overflow-hidden"><div className="flex items-center justify-between border-b border-ink-100 bg-ink-50 px-3 py-1.5 text-xs"><span className="text-ink-500">{editing ? 'Editing note' : 'New note'} · Markdown</span><div className="flex gap-1"><button className={`rounded px-2 py-0.5 ${!preview ? 'bg-white shadow-sm' : 'text-ink-500'}`} onClick={() => setPreview(false)}>Write</button><button className={`rounded px-2 py-0.5 ${preview ? 'bg-white shadow-sm' : 'text-ink-500'}`} onClick={() => setPreview(true)}>Preview</button></div></div>
      {preview ? <div className="md min-h-[96px] p-3 text-sm" dangerouslySetInnerHTML={render(text || '_Nothing to preview_')} /> : <textarea className="h-28 w-full resize-y p-3 font-mono text-sm outline-none" placeholder="Findings, attack paths, commands… (⌘↵ to save)" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && save()} aria-label="Note" />}
      <div className="flex justify-end gap-2 border-t border-ink-100 p-2">{editing && <button className="btn-ghost" onClick={() => { setEditing(null); setText('') }}>Cancel</button>}<button className="btn-primary" onClick={save} disabled={!text.trim()}>{editing ? 'Save' : 'Add note'}</button></div></div>
    <ul className="space-y-3"><AnimatePresence initial={false}>{rows.map(n => <motion.li key={n.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`card group p-3 ${n.pinned ? 'border-brand-200 bg-brand-50/40' : ''}`}>
      <div className="md text-sm" dangerouslySetInnerHTML={render(n.body)} />
      <div className="mt-2 flex items-center gap-1 text-xs text-ink-400"><span className="flex-1">{ago(n.updatedAt)}</span>
        <button className="btn-ghost !p-1" aria-label={n.pinned ? 'Unpin' : 'Pin'} onClick={async () => { await api.updateNote(n.id, { pinned: !n.pinned }); await load() }}>{n.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
        <button className="btn-ghost !p-1" aria-label="Edit note" onClick={() => { setEditing(n.id); setText(n.body); setPreview(false) }}><Pencil size={13} /></button>
        <button className="btn-ghost !p-1 hover:!text-brand-600" aria-label="Delete note" onClick={async () => { await api.deleteNote(n.id); await load(); void s.refresh() }}><Trash2 size={13} /></button></div></motion.li>)}</AnimatePresence></ul></div>
}

function ActivityTab({ host }: { host: Host }) {
  const [rows, setRows] = useState<Activity[]>([]); useEffect(() => { api.activity(host.id).then(setRows) }, [host.id, host.status, host.access, host.lastChecked, host.credCount, host.noteCount, host.tags.length])
  return <ol className="relative ml-2 border-l border-ink-200">{rows.map((a, i) => <motion.li key={a.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0, transition: { delay: Math.min(i, 10) * 0.02 } }} className="mb-4 ml-4"><span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-600" />
    <div className="text-sm"><span className="mr-2 text-[10px] font-semibold uppercase text-ink-500">{a.kind}</span>{a.detail}</div><div className="text-xs text-ink-400">{fmtDate(a.at)} · {ago(a.at)}</div></motion.li>)}</ol>
}
