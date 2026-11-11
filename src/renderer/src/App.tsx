import { AnimatePresence, MotionConfig } from 'framer-motion'
import { useEffect } from 'react'
import Dashboard from './Dashboard'
import DetailPanel from './DetailPanel'
import { ConnectDialog, ExportDialog, HostDialog, ImportDialog, ProjectDialog, SaveFilterDialog, SettingsDialog } from './Dialogs'
import HostsView from './HostsView'
import Palette from './Palette'
import Sidebar from './Sidebar'
import { useStore } from './store'
import { Toasts } from './ui'
import Unlock from './Unlock'
import { api } from './api'

export default function App() {
  const s = useStore(); const { phase, modal, settings } = s
  useEffect(() => {
    void s.boot().catch(e => s.toast((e as Error).message, 'err'))
    const offLock = window.hv.onLocked(() => s.setPhase('locked'))
    const offSync = window.hv.onSliverSynced?.(r => {
      const x = r as { created?: number; updated?: number }
      s.toast(`Sliver auto-sync: ${x.created ?? 0} new, ${x.updated ?? 0} updated`)
      void s.refresh()
    })
    return () => { offLock(); offSync?.() }
  }, []) // eslint-disable-line
  useEffect(() => { const r = document.documentElement; r.dataset.density = settings.density ?? 'normal'; r.dataset.reduceMotion = String(!!settings.reduceMotion) }, [settings.density, settings.reduceMotion])
  useEffect(() => {
    if (phase !== 'ready') return
    const ping = () => void window.hv.activity(); const ev = ['mousedown', 'keydown', 'wheel']; let t = 0
    const h = () => { const n = Date.now(); if (n - t > 5000) { t = n; ping() } }; ev.forEach(e => window.addEventListener(e, h, { passive: true }))
    const key = (e: KeyboardEvent) => {
      const s = useStore.getState(); const m = e.metaKey || e.ctrlKey; const tag = (e.target as HTMLElement)?.tagName
      if (m && e.key.toLowerCase() === 'k') { e.preventDefault(); s.setModal({ kind: 'palette' }) }
      else if (m && e.key.toLowerCase() === 'f') { e.preventDefault(); s.setView('hosts'); document.getElementById('search')?.focus() }
      else if (m && e.key.toLowerCase() === 'n') { e.preventDefault(); s.setModal({ kind: 'host' }) }
      else if (m && e.key.toLowerCase() === 'l') { e.preventDefault(); void api.lock().then(() => s.setPhase('locked')) }
      else if (e.key === 'Escape' && !s.modal && tag !== 'INPUT' && tag !== 'TEXTAREA') { if (s.selected.size) s.clearSel(); else s.open(null) }
    }
    window.addEventListener('keydown', key)
    return () => { ev.forEach(e => window.removeEventListener(e, h)); window.removeEventListener('keydown', key) }
  }, [phase]) // eslint-disable-line
  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? 'always' : 'user'}>
      {phase === 'loading' ? null : phase !== 'ready' ? <Unlock /> : (
        <div className="flex h-full overflow-hidden">
          <div className="hidden lg:block"><Sidebar /></div>
          <AnimatePresence>{s.sidebarOpen && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-ink-900/30" onClick={s.toggleSidebar} /><div className="relative h-full w-64"><Sidebar /></div></div>}</AnimatePresence>
          {s.view === 'dashboard' ? <Dashboard /> : <HostsView />}
          <DetailPanel />
        </div>)}
      <AnimatePresence>
        {phase === 'ready' && modal?.kind === 'host' && <HostDialog key="h" host={modal.host} />}{modal?.kind === 'project' && <ProjectDialog key="p" project={modal.project} />}
        {modal?.kind === 'import' && <ImportDialog key="i" />}{modal?.kind === 'export' && <ExportDialog key="e" />}{modal?.kind === 'settings' && <SettingsDialog key="s" />}
        {modal?.kind === 'connect' && <ConnectDialog key="c" host={modal.host} />}{modal?.kind === 'saveFilter' && <SaveFilterDialog key="f" />}{modal?.kind === 'palette' && <Palette key="k" />}
      </AnimatePresence>
      <Toasts />
    </MotionConfig>
  )
}
