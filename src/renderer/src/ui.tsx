import { AnimatePresence, motion } from 'framer-motion'
import { CircleCheck, CircleHelp, Skull, WifiOff, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AccessLevel, Status } from '../../core/types'
import { useStore } from './store'

export const STATUS_META: Record<Status, { label: string; icon: LucideIcon; cls: string; dot: string }> = {
  online: { label: 'Online', icon: CircleCheck, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  offline: { label: 'Offline', icon: WifiOff, cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  dead: { label: 'Dead', icon: Skull, cls: 'bg-brand-50 text-brand-700 border-brand-200', dot: 'bg-brand-600' },
  unknown: { label: 'Unknown', icon: CircleHelp, cls: 'bg-ink-100 text-ink-500 border-ink-200', dot: 'bg-ink-400' },
}
export function StatusPill({ status, busy }: { status: Status; busy?: boolean }) {
  const m = STATUS_META[status]; const I = m.icon
  return (
    <motion.span key={status} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${m.cls}`}>
      {busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <I size={12} />}
      {busy ? 'Checking' : m.label}{status === 'online' && !busy && <span aria-hidden className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-emerald-500" />}
    </motion.span>
  )
}
export const ACCESS_META: Record<AccessLevel, string> = { none: 'bg-ink-100 text-ink-500', user: 'bg-sky-50 text-sky-700', admin: 'bg-orange-50 text-orange-700', root: 'bg-brand-600 text-white' }
export const AccessBadge = ({ level }: { level: AccessLevel }) => <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${ACCESS_META[level]}`}>{level === 'none' ? '—' : level}</span>
export const TagChip = ({ name, onRemove, onClick, plain }: { name: string; onRemove?: () => void; onClick?: () => void; plain?: boolean }) => (
  <span onClick={onClick} className={`inline-flex items-center gap-1 rounded-md bg-ink-100 px-1.5 py-0.5 text-xs text-ink-700 ${onClick ? 'cursor-pointer hover:bg-brand-100 hover:text-brand-700' : ''}`}>
    {plain ? '' : '#'}{name}{onRemove && <button aria-label={`Remove ${name}`} onClick={e => { e.stopPropagation(); onRemove() }} className="text-ink-400 hover:text-brand-600"><X size={10} /></button>}
  </span>
)

export function Modal({ title, onClose, children, width = 'max-w-lg', footer }: { title: string; onClose: () => void; children: ReactNode; width?: string; footer?: ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  return (
    <motion.div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink-900/40 p-4 pt-[8vh] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <motion.div role="dialog" aria-label={title} className={`card w-full ${width} shadow-pop`} initial={{ y: 24, scale: 0.97, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 12, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
        <div className="flex items-center justify-between border-b border-ink-200 px-5 py-3"><h2 className="text-base font-semibold">{title}</h2><button aria-label="Close" className="btn-ghost !p-1" onClick={onClose}><X size={16} /></button></div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-200 bg-ink-50 px-5 py-3 rounded-b-xl">{footer}</div>}
      </motion.div>
    </motion.div>
  )
}
export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => <label className="block"><span className="label">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}</label>

export function Toasts() {
  const toasts = useStore(s => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
      <AnimatePresence>{toasts.map(t => (
        <motion.div key={t.id} layout initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }} className={`pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-pop ${t.tone === 'err' ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-900'}`}>
          <span className={`mr-2 inline-block h-2 w-2 rounded-full ${t.tone === 'err' ? 'bg-brand-600' : t.tone === 'ok' ? 'bg-emerald-500' : 'bg-ink-400'}`} />{t.text}
        </motion.div>))}</AnimatePresence>
    </div>
  )
}
export function useConfirm() {
  const [state, setState] = useState<{ text: string; yes: () => void } | null>(null)
  const node = (
    <AnimatePresence>{state && (
      <Modal title="Please confirm" onClose={() => setState(null)} width="max-w-sm" footer={<><button className="btn-ghost" onClick={() => setState(null)}>Cancel</button><button className="btn-primary" autoFocus onClick={() => { state.yes(); setState(null) }}>Confirm</button></>}>
        <p className="text-sm text-ink-700">{state.text}</p></Modal>)}</AnimatePresence>)
  return { ask: (text: string, yes: () => void) => setState({ text, yes }), node }
}
export function useDebounced<T>(v: T, ms = 200) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms]); return d }
export function useOutside(cb: () => void) { const r = useRef<HTMLDivElement>(null); useEffect(() => { const h = (e: MouseEvent) => r.current && !r.current.contains(e.target as Node) && cb(); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [cb]); return r }
export const fmtDate = (s: string | null) => (s ? s.slice(0, 16) : '—')
export function ago(s: string | null) {
  if (!s) return 'never'; const d = (Date.now() - new Date(s.replace(' ', 'T') + 'Z').getTime()) / 1000
  if (d < 60) return 'just now'; if (d < 3600) return `${Math.floor(d / 60)}m ago`; if (d < 86400) return `${Math.floor(d / 3600)}h ago`; return `${Math.floor(d / 86400)}d ago`
}
