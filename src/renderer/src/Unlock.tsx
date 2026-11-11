import { motion } from 'framer-motion'
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { api } from './api'
import { useStore } from './store'

export const Logo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="9" fill="#DC2626" /><path d="M9 10v12M23 10v12M9 16h14" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></svg>
)
function strength(pw: string) {
  let s = 0; if (pw.length >= 8) s++; if (pw.length >= 12) s++; if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++
  return Math.min(s, 4)
}
export default function Unlock() {
  const { phase, vaultPath, enter } = useStore()
  const creating = phase === 'create'
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [show, setShow] = useState(false)
  const [err, setErr] = useState(''); const [shake, setShake] = useState(0); const [busy, setBusy] = useState(false)
  const s = strength(pw)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('')
    if (creating && pw.length < 8) return fail('Use at least 8 characters')
    if (creating && pw !== pw2) return fail('Passwords do not match')
    setBusy(true)
    try { await (creating ? api.create(pw) : api.unlock(pw)); setPw(''); setPw2(''); await enter() }
    catch (x) { fail((x as Error).message) } finally { setBusy(false) }
  }
  const fail = (m: string) => { setErr(m); setShake(n => n + 1) }
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-gradient-to-br from-white via-white to-brand-50">
      <div className="drag absolute inset-x-0 top-0 h-10" />
      <motion.div aria-hidden className="absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-brand-600/10 blur-3xl" animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 8, repeat: Infinity }} />
      <motion.div aria-hidden className="absolute -bottom-48 -left-32 h-[26rem] w-[26rem] rounded-full bg-brand-400/10 blur-3xl" animate={{ scale: [1.1, 1, 1.1] }} transition={{ duration: 10, repeat: Infinity }} />
      <motion.form onSubmit={submit} key={shake} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={`card relative z-10 w-[min(92vw,400px)] p-8 ${shake ? 'animate-shake' : ''}`}>
        <div className="mb-6 flex flex-col items-center text-center">
          <motion.div initial={{ rotate: -12, scale: 0.7 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260 }}><Logo size={52} /></motion.div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Host<span className="text-brand-600">Vault</span></h1>
          <p className="mt-1 text-sm text-ink-500">{creating ? 'Create your encrypted vault' : 'Vault is locked'}</p>
        </div>
        <label className="label" htmlFor="pw">{creating ? 'Master password' : 'Password'}</label>
        <div className="relative">
          <input id="pw" autoFocus type={show ? 'text' : 'password'} className="input pr-9" value={pw} onChange={e => setPw(e.target.value)} autoComplete="off" />
          <button type="button" aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700" onClick={() => setShow(v => !v)}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
        </div>
        {creating && <>
          <div className="mt-2 flex gap-1" aria-label={`Strength ${s} of 4`}>{[1, 2, 3, 4].map(i => <motion.div key={i} className="h-1 flex-1 rounded-full" animate={{ backgroundColor: i <= s ? (s < 2 ? '#ef4444' : s < 3 ? '#f59e0b' : '#22c55e') : '#e4e4e7' }} />)}</div>
          <label className="label mt-4" htmlFor="pw2">Confirm password</label>
          <input id="pw2" type={show ? 'text' : 'password'} className="input" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="off" />
          <p className="mt-3 flex gap-2 rounded-lg bg-brand-50 p-3 text-xs text-brand-800"><ShieldCheck size={14} className="mt-0.5 shrink-0" />There is no recovery: if you forget this password the vault cannot be opened.</p>
        </>}
        {err && <p role="alert" className="mt-3 text-sm text-brand-700">{err}</p>}
        <button className="btn-primary mt-5 w-full !py-2" disabled={busy || !pw}><Lock size={14} />{busy ? 'Working…' : creating ? 'Create vault' : 'Unlock'}</button>
        <p className="mt-4 truncate text-center font-mono text-[10px] text-ink-400" title={vaultPath}>{vaultPath}</p>
      </motion.form>
    </div>
  )
}
