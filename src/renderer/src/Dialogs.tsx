import { motion } from 'framer-motion'
import { Check, Copy, FileText, FolderOpen, Terminal, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ACCESS_LEVELS, STATUSES, type Host, type Project } from '../../core/types'
import { api, type ConnectCmd } from './api'
import { useStore } from './store'
import { Field, Modal } from './ui'

const COLORS = ['#DC2626', '#EA580C', '#CA8A04', '#16A34A', '#0891B2', '#2563EB', '#7C3AED', '#DB2777', '#52525B']

export function HostDialog({ host }: { host?: Host }) {
  const s = useStore(); const close = () => s.setModal(null)
  const [f, setF] = useState({ ip: host?.ip ?? '', hostname: host?.hostname ?? '', mac: host?.mac ?? '', os: host?.os ?? '', url: host?.url ?? '', status: host?.status ?? 'unknown', access: host?.access ?? 'none', projectId: host?.projectId ?? s.projectId ?? s.projects.find(p => !p.archived)?.id ?? s.projects[0].id, tags: '', note: '' })
  const [err, setErr] = useState('')
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  async function save() {
    try {
      const { tags, note, ...rest } = f; const h = host ? await api.updateHost(host.id, rest) : await api.addHost({ ...rest, projectId: Number(rest.projectId) })
      const t = tags.split(',').map(x => x.trim()).filter(Boolean); if (t.length) await api.addTags([h.id], t)
      if (!host && note.trim()) await api.addNote(h.id, note.trim())
      s.toast(host ? 'Host updated' : 'Host added'); close(); await s.refresh(); if (!host) s.open(h.id)
    } catch (e) { setErr((e as Error).message.replace(/^.*CHECK constraint failed.*$/, 'Host needs an IP or a hostname')) }
  }
  return <Modal title={host ? 'Edit host' : 'Add host'} onClose={close} footer={<><button className="btn-ghost" onClick={close}>Cancel</button><button className="btn-primary" onClick={save}>{host ? 'Save' : 'Add host'}</button></>}>
    <form className="grid grid-cols-2 gap-3" onSubmit={e => { e.preventDefault(); void save() }}>
      <Field label="IP address"><input autoFocus className="input font-mono" value={f.ip} onChange={set('ip')} placeholder="10.10.10.5" /></Field>
      <Field label="Hostname"><input className="input" value={f.hostname} onChange={set('hostname')} placeholder="dc01.corp.local" /></Field>
      <Field label="MAC"><input className="input font-mono" value={f.mac} onChange={set('mac')} /></Field>
      <Field label="Operating system"><input className="input" value={f.os} onChange={set('os')} placeholder="Windows Server 2019" /></Field>
      <div className="col-span-2"><Field label="URL"><input className="input font-mono" value={f.url} onChange={set('url')} placeholder="https://10.10.10.5:8443/admin" /></Field></div>
      <Field label="Status"><select className="input" value={f.status} onChange={set('status')}>{STATUSES.map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Access level"><select className="input" value={f.access} onChange={set('access')}>{ACCESS_LEVELS.map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Project"><select className="input" value={f.projectId} onChange={set('projectId')}>{s.projects.filter(p => !p.archived || p.id === f.projectId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      {!host && <Field label="Tags"><input className="input" value={f.tags} onChange={set('tags')} placeholder="dmz, web" /></Field>}
      {!host && <div className="col-span-2"><Field label="Note"><textarea className="input min-h-[72px]" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="Markdown supported" /></Field></div>}
      {err && <p role="alert" className="col-span-2 text-sm text-brand-700">{err}</p>}<button className="hidden" type="submit" />
    </form></Modal>
}

export function ProjectDialog({ project }: { project?: Project }) {
  const s = useStore(); const close = () => s.setModal(null)
  const [f, setF] = useState({ name: project?.name ?? '', client: project?.client ?? '', scope: project?.scope ?? '', startDate: project?.startDate ?? '', endDate: project?.endDate ?? '', color: project?.color ?? '#DC2626', archived: project?.archived ?? false }); const [err, setErr] = useState('')
  async function save() { try { const p = { ...f, startDate: f.startDate || null, endDate: f.endDate || null }; const r = project ? await api.updateProject(project.id, p) : await api.addProject(p); s.toast(project ? 'Project saved' : 'Project created'); close(); await s.refresh(); if (!project) s.setProject(r.id) } catch (e) { setErr((e as Error).message.includes('UNIQUE') ? 'A project with this name already exists' : (e as Error).message) } }
  async function del() { if (!project || !confirm(`Delete "${project.name}" and ALL its hosts, credentials and notes? This cannot be undone.`)) return; try { await api.deleteProject(project.id); if (s.projectId === project.id) s.setProject(null); close(); await s.refresh() } catch (e) { setErr((e as Error).message) } }
  return <Modal title={project ? 'Edit project' : 'New project'} onClose={close} footer={<>{project && <button className="btn-danger mr-auto" onClick={del}>Delete</button>}<button className="btn-ghost" onClick={close}>Cancel</button><button className="btn-primary" disabled={!f.name.trim()} onClick={save}>Save</button></>}>
    <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="Name"><input autoFocus className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field><Field label="Client"><input className="input" value={f.client} onChange={e => setF({ ...f, client: e.target.value })} /></Field></div>
      <Field label="Scope"><textarea className="input h-20" value={f.scope} onChange={e => setF({ ...f, scope: e.target.value })} placeholder="10.0.0.0/24, *.corp.local" /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Start"><input type="date" className="input" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} /></Field><Field label="End"><input type="date" className="input" value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} /></Field></div>
      <div><span className="label">Colour</span><div className="flex gap-2">{COLORS.map(c => <button key={c} aria-label={c} onClick={() => setF({ ...f, color: c })} className={`h-6 w-6 rounded-full transition ${f.color === c ? 'scale-110 ring-2 ring-offset-2 ring-ink-900' : ''}`} style={{ background: c }} />)}</div></div>
      {project && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={f.archived} onChange={e => setF({ ...f, archived: e.target.checked })} />Archived (engagement finished)</label>}
      {err && <p role="alert" className="text-sm text-brand-700">{err}</p>}</div></Modal>
}

export function SaveFilterDialog() {
  const s = useStore(); const [name, setName] = useState('')
  return <Modal title="Save filter" width="max-w-sm" onClose={() => s.setModal(null)} footer={<><button className="btn-ghost" onClick={() => s.setModal(null)}>Cancel</button><button className="btn-primary" disabled={!name.trim()} onClick={async () => { await api.saveFilter(name, s.filter); s.toast('Filter saved'); s.setModal(null); void s.refresh() }}>Save</button></>}>
    <Field label="Name"><input autoFocus className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Admin boxes with creds" /></Field></Modal>
}

export function ImportDialog() {
  const s = useStore(); const close = () => s.setModal(null)
  const [file, setFile] = useState<{ name: string; text: string } | null>(null); const [prev, setPrev] = useState<any>(null); const [map, setMap] = useState<Record<number, string>>({}); const [tag, setTag] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [src, setSrc] = useState<'file' | 'sliver'>('file')
  const [cfg, setCfg] = useState(''); const [cfgs, setCfgs] = useState<string[]>([]); const [auto, setAuto] = useState(15)
  useEffect(() => { if (src === 'sliver' && !cfgs.length) api.sliverConfigs().then(c => { setCfgs(c); if (c.length === 1) setCfg(c[0]) }).catch(() => {}) }, [src])
  const kind = file?.name.toLowerCase().endsWith('.csv') ? 'csv' : 'nmap'
  const pid = s.projectId ?? s.projects.find(p => !p.archived)!.id
  async function pick() { setErr(''); const f = await window.hv.openFile([{ name: 'Nmap XML / CSV', extensions: ['xml', 'csv'] }]); if (!f) return; setFile(f); try { const k = f.name.toLowerCase().endsWith('.csv') ? 'csv' : 'nmap'; const p = await api.importPreview(k, f.text); setPrev(p); if (p.mapping) setMap(p.mapping) } catch (e) { setPrev(null); setErr((e as Error).message) } }
  async function run() {
    if (src === 'sliver') {
      setBusy(true); setErr('')
      try {
        const r = await api.sliverImport(pid, { config: cfg || undefined, tag: tag.trim() || undefined })
        await api.setSetting('sliverConfig', cfg || cfgs[0] || '')
        await api.setSetting('sliverSyncMinutes', auto)
        s.toast(`Sliver: ${r.created} new, ${r.updated} updated${auto > 0 ? ` · auto-sync every ${auto} min` : ''}`); close(); await s.refresh()
      } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
      return
    }
    if (!file) return; setBusy(true); try { const r = await api.importApply(kind, file.text, pid, { tag: tag.trim() || undefined, mapping: map }); s.toast(`Imported: ${r.created} new, ${r.updated} updated, ${r.services} services`); close(); await s.refresh() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const hasId = src === 'sliver' || kind === 'nmap' || Object.values(map).some(v => v === 'ip' || v === 'hostname')
  return <Modal title="Import hosts" width="max-w-2xl" onClose={close} footer={<><button className="btn-ghost" onClick={close}>Cancel</button><button className="btn-primary" disabled={busy || (src === 'file' && (!prev || !hasId || !prev.count)) || (src === 'sliver' && !cfg)} onClick={run}>{busy ? 'Importing…' : src === 'sliver' ? 'Import from Sliver' : `Import ${prev?.count ?? ''} host${prev?.count === 1 ? '' : 's'}`}</button></>}>
    <div className="mb-3 grid grid-cols-2 gap-2">
      {(['file', 'sliver'] as const).map(k => <button key={k} onClick={() => setSrc(k)} className={`rounded-lg border py-2 text-sm transition ${src === k ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-glow' : 'border-ink-200 hover:border-brand-300'}`}>{k === 'file' ? 'Nmap XML / CSV' : 'Sliver server'}</button>)}
    </div>
    {src === 'file' && <>
      <button onClick={pick} className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-ink-200 p-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40"><Upload className="text-brand-600" /><span className="text-sm font-medium">{file ? file.name : 'Choose an Nmap XML (-oX) or CSV file'}</span><span className="text-xs text-ink-500">Existing hosts are matched by IP or hostname and merged; nothing is deleted.</span></button>
      {err && <p role="alert" className="mt-3 text-sm text-brand-700">{err}</p>}
      {prev && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 space-y-3">
        <p className="text-sm"><span className="font-semibold text-brand-700">{prev.count}</span> host(s) found into <b>{s.projects.find(p => p.id === pid)?.name}</b></p>
        {kind === 'csv' && <div className="overflow-auto rounded-lg border border-ink-200"><table className="w-full text-xs"><thead><tr>{prev.header.map((h: string, i: number) => <th key={i} className="border-b border-ink-200 bg-ink-50 p-2 text-left"><div className="mb-1 text-ink-500">{h}</div><select className="input !py-1 text-xs" value={map[i] ?? ''} onChange={e => setMap(m => { const n = { ...m }; if (e.target.value) n[i] = e.target.value; else delete n[i]; return n })} aria-label={`Map column ${h}`}><option value="">— skip —</option>{prev.fields.map((f: string) => <option key={f}>{f}</option>)}</select></th>)}</tr></thead>
          <tbody>{prev.rows.map((r: string[], i: number) => <tr key={i}>{prev.header.map((_: string, j: number) => <td key={j} className="max-w-[140px] truncate border-b border-ink-100 p-2 font-mono">{j in map && map[j] === 'password' ? '••••' : r[j]}</td>)}</tr>)}</tbody></table></div>}
        {kind === 'nmap' && <ul className="max-h-40 space-y-1 overflow-auto text-xs">{prev.sample.map((h: any, i: number) => <li key={i} className="flex gap-3 rounded bg-ink-50 px-2 py-1"><span className="font-mono font-medium">{h.ip || h.hostname}</span><span className="text-ink-500">{h.os}</span><span className="ml-auto text-ink-500">{h.services.length} open port(s)</span></li>)}</ul>}
        {!hasId && <p className="text-sm text-brand-700">Map at least an <b>ip</b> or <b>hostname</b> column.</p>}
        <Field label="Tag every imported host (optional)"><input className="input" value={tag} onChange={e => setTag(e.target.value)} placeholder="nmap-2026-11" /></Field>
      </motion.div>}
    </>}
    {src === 'sliver' && <div className="space-y-3">
      <p className="text-xs text-ink-500">Runs <code className="font-mono">sliver-client console</code> and imports every <b>beacon</b> and <b>session</b> as a host. Sessions take precedence over beacons for the same target.</p>
      <Field label="Operator config">
        {cfgs.length > 1
          ? <select className="input" value={cfg} onChange={e => setCfg(e.target.value)}><option value="">Pick a config…</option>{cfgs.map(c => <option key={c} value={c}>{c.split('/').pop()}</option>)}</select>
          : <input className="input" value={cfg || cfgs[0] || ''} onChange={e => setCfg(e.target.value)} placeholder="~/.sliver-client/configs/name.cfg" />}
      </Field>
      {err && <p role="alert" className="text-sm text-brand-700">{err}</p>}
      <Field label="Keep in sync automatically">
        <select className="input" value={auto} onChange={e => setAuto(Number(e.target.value))}>
          <option value={0}>Off — only when I import</option>
          <option value={5}>Every 5 minutes</option>
          <option value={15}>Every 15 minutes</option>
          <option value={60}>Every hour</option>
        </select>
      </Field>
      <Field label="Tag every imported host (optional)"><input className="input" value={tag} onChange={e => setTag(e.target.value)} placeholder="sliver-2026-11" /></Field>
    </div>}
  </Modal>
}

export function ExportDialog() {
  const s = useStore(); const close = () => s.setModal(null)
  const [fmt, setFmt] = useState<'json' | 'csv' | 'md'>('md'); const [secrets, setSecrets] = useState(false); const [scope, setScope] = useState<'sel' | 'filter'>(s.selected.size ? 'sel' : 'filter')
  const count = scope === 'sel' ? s.selected.size : s.hosts.length
  async function run() { try { const text = await api.exportRender(fmt, { ...s.filter, projectId: s.projectId }, secrets, scope === 'sel' ? [...s.selected] : undefined); const p = await window.hv.saveFile(`hosts-${new Date().toISOString().slice(0, 10)}.${fmt}`, text); if (p) { s.toast(`Exported ${count} host(s)`); close() } } catch (e) { s.toast((e as Error).message, 'err') } }
  return <Modal title="Export hosts" width="max-w-md" onClose={close} footer={<><button className="btn-ghost" onClick={close}>Cancel</button><button className="btn-primary" disabled={!count} onClick={run}>Export {count}</button></>}>
    <div className="space-y-4"><div><span className="label">Format</span><div className="grid grid-cols-3 gap-2">{([['md', 'Markdown'], ['csv', 'CSV'], ['json', 'JSON']] as const).map(([k, l]) => <button key={k} onClick={() => setFmt(k)} className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm transition ${fmt === k ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-glow' : 'border-ink-200 hover:border-brand-300'}`}><FileText size={14} />{l}</button>)}</div></div>
      <div><span className="label">Include</span><div className="space-y-1.5 text-sm"><label className="flex items-center gap-2"><input type="radio" className="accent-brand-600" checked={scope === 'filter'} onChange={() => setScope('filter')} />Current view ({s.hosts.length})</label><label className={`flex items-center gap-2 ${s.selected.size ? '' : 'opacity-40'}`}><input type="radio" className="accent-brand-600" disabled={!s.selected.size} checked={scope === 'sel'} onChange={() => setScope('sel')} />Selected hosts ({s.selected.size})</label></div></div>
      <label className={`flex gap-3 rounded-lg border p-3 text-sm transition ${secrets ? 'border-brand-300 bg-brand-50' : 'border-ink-200'}`}><input type="checkbox" className="mt-0.5 accent-brand-600" checked={secrets} onChange={e => setSecrets(e.target.checked)} /><span><b>Include secrets</b><br /><span className="text-xs text-ink-500">Off by default: passwords, keys and tokens are redacted. The exported file will be unencrypted.</span></span></label></div></Modal>
}

export function ConnectDialog({ host }: { host: Host }) {
  const s = useStore(); const [cmd, setCmd] = useState<ConnectCmd | null>(null); const [proto, setProto] = useState<string>(''); const [err, setErr] = useState(''); const [ok, setOk] = useState(false)
  const [creds, setCreds] = useState<{ id: number; label: string }[]>([]); const [credId, setCredId] = useState<number | undefined>()
  const [hasSliver, setHasSliver] = useState(false)
  useEffect(() => { api.creds(host.id).then(c => setCreds(c.map(x => ({ id: x.id, label: `${x.kind}: ${x.domain ? x.domain + '\\' : ''}${x.username || '(none)'}` })))) }, [host.id])
  useEffect(() => { api.sliverGet(host.id).then(b => { setHasSliver(!!b); if (b?.kind === 'session' && !proto) setProto('sliver') }).catch(() => setHasSliver(false)) }, [host.id]) // eslint-disable-line
  useEffect(() => {
    if (proto === 'sliver') {
      api.sliverShellArgv(host.id).then(argv => {
        const display = argv.map(a => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ')
        setCmd({ proto: 'sliver', argv, display, needsPassword: false, note: 'Opens sliver-client implant shell', credId: null }); setErr('')
      }).catch(e => { setCmd(null); setErr((e as Error).message) })
      return
    }
    api.connect(host.id, proto || undefined, undefined, credId).then(c => { setCmd(c); setErr(''); if (!proto) setProto(c.proto) }).catch(e => { setCmd(null); setErr((e as Error).message) })
  }, [host.id, proto, credId])
  const protos = [...(hasSliver ? ['sliver'] : []), 'ssh', 'rdp', 'smb', 'http', 'https', 'ftp', 'winrm', 'mssql', 'mysql', 'vnc', 'telnet']
  return <Modal title={`Quick connect · ${host.ip || host.hostname}`} width="max-w-lg" onClose={() => s.setModal(null)} footer={<button className="btn-ghost" onClick={() => s.setModal(null)}>Close</button>}>
    <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="Protocol"><select className="input" value={proto} onChange={e => setProto(e.target.value)}>{protos.map(p => <option key={p}>{p}</option>)}</select></Field>
      <Field label="Credential"><select className="input" value={credId ?? ''} disabled={proto === 'sliver'} onChange={e => setCredId(e.target.value ? Number(e.target.value) : undefined)}><option value="">First available</option>{creds.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field></div>
      {err && <p className="text-sm text-brand-700">{err}</p>}
      {cmd && <><pre className="overflow-auto rounded-lg bg-ink-900 p-3 font-mono text-xs text-ink-100"><span className="text-brand-400">$ </span>{cmd.display}</pre>{cmd.note && <p className="text-xs text-ink-500">{cmd.note}</p>}
        <div className="flex flex-wrap gap-2"><button className="btn-primary" onClick={async () => { await window.hv.copy(cmd.display); setOk(true); setTimeout(() => setOk(false), 1200) }}>{ok ? <Check size={14} /> : <Copy size={14} />}Copy command</button>
          {cmd.needsPassword && cmd.credId && <button className="btn-outline" onClick={async () => { await window.hv.copyCred(cmd.credId!); s.toast('Password copied — paste when prompted') }}><Copy size={14} />Copy password</button>}
          {window.hv.platform === 'darwin' && <button className="btn-outline" onClick={() => window.hv.openTerminal(cmd.argv)}><Terminal size={14} />Open in Terminal</button>}</div>
        <p className="text-xs text-ink-400">Passwords are never placed in the command. “Open in Terminal” runs the command in a new Terminal window.</p></>}</div></Modal>
}

export function SettingsDialog() {
  const s = useStore(); const set = s.setSetting; const st = s.settings; const [msg, setMsg] = useState(''); const [pw, setPw] = useState({ old: '', n: '' }); const [pwMsg, setPwMsg] = useState('')
  const Row = ({ l, children, hint }: { l: string; children: React.ReactNode; hint?: string }) => <div className="flex items-center justify-between gap-4 py-2.5"><div><div className="text-sm">{l}</div>{hint && <div className="text-xs text-ink-400">{hint}</div>}</div>{children}</div>
  const Num = ({ k, def, min, max }: { k: string; def: number; min: number; max: number }) => <input type="number" className="input !w-24" min={min} max={max} value={st[k] ?? def} onChange={e => set(k, Math.max(min, Math.min(max, Number(e.target.value) || 0)))} />
  const seg = (k: string, opts: string[], def: string) => <div className="flex rounded-lg bg-ink-100 p-0.5">{opts.map(o => <button key={o} onClick={() => set(k, o)} className={`rounded-md px-3 py-1 text-xs capitalize transition ${(st[k] ?? def) === o ? 'bg-white font-medium text-brand-700 shadow-sm' : 'text-ink-500'}`}>{o}</button>)}</div>
  return <Modal title="Settings" width="max-w-xl" onClose={() => s.setModal(null)}>
    <div className="max-h-[65vh] divide-y divide-ink-100 overflow-auto pr-1">
      <section className="pb-2"><h3 className="label">Security</h3>
        <Row l="Auto-lock after idle" hint="Minutes, 0 = never. Also locks on sleep and screen lock."><Num k="autoLockMinutes" def={10} min={0} max={1440} /></Row>
        <Row l="Clear clipboard after copying a secret" hint="Seconds, 0 = never"><Num k="clipboardClearSeconds" def={30} min={0} max={600} /></Row></section>
      <section className="py-2"><h3 className="label">Host checks</h3>
        <Row l="Use ICMP ping" hint="Uses the system ping command"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={st.checkPing !== false} onChange={e => set('checkPing', e.target.checked)} /></Row>
        <Row l="Timeout (ms)"><Num k="checkTimeout" def={1500} min={200} max={15000} /></Row>
        <Row l="Concurrency"><Num k="checkConcurrency" def={16} min={1} max={128} /></Row>
        <Row l="TCP ports to try" hint="Comma separated, plus each host's known services"><input className="input !w-48" defaultValue={(st.checkPorts ?? [22, 80, 443, 445, 3389, 135, 139, 21, 23, 25, 53, 8080]).join(',')} onBlur={e => set('checkPorts', e.target.value.split(/[,\s]+/).map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 65536))} /></Row></section>
      <section className="py-2"><h3 className="label">Sliver</h3>
        <Row l="Auto-sync" hint="Minutes between background beacons/sessions refresh. 0 = off."><Num k="sliverSyncMinutes" def={0} min={0} max={1440} /></Row>
        <Row l="Default config" hint="Operator .cfg used when sync has no explicit config"><input className="input !w-56 font-mono text-xs" placeholder="~/.sliver-client/configs/op.cfg" value={(st.sliverConfig as string) ?? ''} onChange={e => set('sliverConfig', e.target.value.trim())} /></Row>
        <Row l="Sync now" hint="Refresh bound implants into the active project"><button className="btn-outline" onClick={async () => { if (!s.projectId) return; try { const r = await api.sliverSync(s.projectId, { config: (st.sliverConfig as string) || undefined }); s.toast(`Sliver sync: ${r.created} new, ${r.updated} updated`); await s.refresh() } catch (e) { s.toast((e as Error).message, 'err') } }}>Sync</button></Row></section>
      <section className="py-2"><h3 className="label">Appearance</h3>
        <Row l="Table density">{seg('density', ['compact', 'normal', 'comfy'], 'normal')}</Row>
        <Row l="Reduce motion"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!st.reduceMotion} onChange={e => set('reduceMotion', e.target.checked)} /></Row></section>
      <section className="py-2"><h3 className="label">Vault</h3>
        <Row l="Vault file" hint={s.vaultPath}><button className="btn-outline" onClick={() => window.hv.revealVault()}><FolderOpen size={14} />Show</button></Row>
        <Row l="Backup" hint="Copies the encrypted file"><button className="btn-outline" onClick={async () => { const p = await window.hv.backup(); if (p) s.toast('Backup saved') }}>Back up…</button></Row>
        <Row l="Command-line tool" hint="Installs the hv command"><button className="btn-outline" onClick={async () => { const r = await window.hv.installCli(); setMsg(r.ok ? `Installed at ${r.path}` : r.error ?? 'Failed') }}><Terminal size={14} />Install hv</button></Row>{msg && <p className="pb-2 text-xs text-ink-500">{msg}</p>}
        <div className="py-2"><div className="mb-2 text-sm">Change master password</div><div className="grid grid-cols-[1fr_1fr_auto] gap-2"><input type="password" className="input" placeholder="Current" value={pw.old} onChange={e => setPw({ ...pw, old: e.target.value })} /><input type="password" className="input" placeholder="New (8+ chars)" value={pw.n} onChange={e => setPw({ ...pw, n: e.target.value })} /><button className="btn-primary" disabled={!pw.old || pw.n.length < 8} onClick={async () => { try { await api.passwd(pw.old, pw.n); setPw({ old: '', n: '' }); setPwMsg('Password changed') } catch (e) { setPwMsg((e as Error).message) } }}>Change</button></div>{pwMsg && <p className="mt-1 text-xs text-ink-500">{pwMsg}</p>}</div></section>
    </div></Modal>
}
