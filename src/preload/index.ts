import { contextBridge, ipcRenderer } from 'electron'

const call = async (method: string, ...args: unknown[]) => {
  const r = await ipcRenderer.invoke('hv:call', method, args)
  if (!r.ok) { const e = new Error(r.error); e.name = r.code ?? 'Error'; throw e }
  return r.data
}
const api = {
  call,
  activity: () => ipcRenderer.invoke('hv:activity'),
  copy: (text: string, isSecret = false) => ipcRenderer.invoke('hv:copy', text, isSecret),
  copyCred: (id: number) => ipcRenderer.invoke('hv:copyCred', id) as Promise<boolean>,
  openFile: (filters: { name: string; extensions: string[] }[]) => ipcRenderer.invoke('hv:openFile', filters) as Promise<{ name: string; text: string } | null>,
  saveFile: (name: string, text: string) => ipcRenderer.invoke('hv:saveFile', name, text) as Promise<string | null>,
  backup: () => ipcRenderer.invoke('hv:backup') as Promise<string | null>,
  openUrl: (url: string) => ipcRenderer.invoke('hv:openUrl', url),
  revealVault: () => ipcRenderer.invoke('hv:revealVault'),
  openTerminal: (argv: string[]) => ipcRenderer.invoke('hv:openTerminal', argv) as Promise<boolean>,
  installCli: () => ipcRenderer.invoke('hv:installCli') as Promise<{ ok: boolean; path?: string; error?: string }>,
  onLocked: (cb: () => void) => { const h = () => cb(); ipcRenderer.on('vault:locked', h); return () => { ipcRenderer.removeListener('vault:locked', h) } },
  onSliverSynced: (cb: (r: unknown) => void) => { const h = (_: unknown, r: unknown) => cb(r); ipcRenderer.on('sliver:synced', h); return () => { ipcRenderer.removeListener('sliver:synced', h) } },
  platform: process.platform,
}
contextBridge.exposeInMainWorld('hv', api)
export type HvApi = typeof api
