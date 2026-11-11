import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, powerMonitor, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Service } from './service'

const svc = new Service()
let win: BrowserWindow | null = null
let idleTimer: NodeJS.Timeout | null = null
let clipTimer: NodeJS.Timeout | null = null
let sliverTimer: NodeJS.Timeout | null = null
let sliverKick: NodeJS.Timeout | null = null
let lastCopied = ''

function armIdle() {
  if (idleTimer) clearTimeout(idleTimer)
  if (!svc.repo) return
  const mins = Number(svc.repo.getSettings().autoLockMinutes ?? 10)
  if (mins > 0) idleTimer = setTimeout(() => svc.lock(), mins * 60_000)
}
function armSliverSync() {
  if (sliverTimer) { clearInterval(sliverTimer); sliverTimer = null }
  if (sliverKick) { clearTimeout(sliverKick); sliverKick = null }
  if (!svc.repo) return
  const mins = Number(svc.repo.getSettings().sliverSyncMinutes ?? 0)
  if (mins <= 0) return
  const tick = async () => {
    if (!svc.repo) return
    try {
      const projects = svc.repo.listProjects(false)
      const activeName = svc.repo.getSettings().activeProject as string | undefined
      const project = (activeName && svc.repo.getProject(activeName)) || projects[0]
      if (!project) return
      const r = svc.syncBoundSliver(project.id)
      win?.webContents.send('sliver:synced', r)
    } catch (e) { win?.webContents.send('sliver:sync-error', (e as Error).message) }
  }
  sliverTimer = setInterval(() => { void tick() }, mins * 60_000)
  // first sync shortly after unlock, so "automatic" needs no wait; keeps the unlock IPC responsive
  sliverKick = setTimeout(() => { void tick() }, 2500)
}
svc.onLock = () => {
  if (idleTimer) clearTimeout(idleTimer)
  if (sliverTimer) { clearInterval(sliverTimer); sliverTimer = null }
  if (sliverKick) { clearTimeout(sliverKick); sliverKick = null }
  win?.webContents.send('vault:locked')
}

function copySecret(text: string) {
  clipboard.writeText(text); lastCopied = text
  if (clipTimer) clearTimeout(clipTimer)
  const secs = Number(svc.repo?.getSettings().clipboardClearSeconds ?? 30)
  if (secs > 0) clipTimer = setTimeout(async () => { if ((await clipboard.readText()) === lastCopied) clipboard.clear(); lastCopied = '' }, secs * 1000)
}

const trusted = (e: Electron.IpcMainInvokeEvent) => !!win && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame

ipcMain.handle('hv:call', async (e, method: string, args: unknown[]) => {
  if (!trusted(e)) throw new Error('Untrusted sender')
  const fn = Object.prototype.hasOwnProperty.call(svc.api, method) ? svc.api[method] : undefined
  if (!fn) throw new Error(`Unknown method: ${method}`)
  try {
    const r = await fn(...(Array.isArray(args) ? args : []))
    armIdle()
    if (method === 'vault.unlock' || method === 'vault.create' || method === 'settings.set') armSliverSync()
    return { ok: true, data: r ?? null }
  } catch (err) { return { ok: false, error: (err as Error).message, code: (err as Error).name } }
})
ipcMain.handle('hv:activity', e => { if (trusted(e)) armIdle() })
ipcMain.handle('hv:copy', (e, text: string, isSecret: boolean) => { if (!trusted(e)) return; isSecret ? copySecret(String(text)) : clipboard.writeText(String(text)) })
ipcMain.handle('hv:copyCred', (e, id: number) => {
  if (!trusted(e)) return false
  const c = svc.repo?.getCredential(id); if (!c) return false
  copySecret(c.secret); return true
})
ipcMain.handle('hv:openFile', async (e, filters: Electron.FileFilter[]) => {
  if (!trusted(e) || !win) return null
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters }); if (r.canceled || !r.filePaths[0]) return null
  const p = r.filePaths[0]; if (fs.statSync(p).size > 100 * 1024 * 1024) throw new Error('File too large (>100 MB)')
  return { name: path.basename(p), text: fs.readFileSync(p, 'utf8') }
})
ipcMain.handle('hv:saveFile', async (e, name: string, text: string) => {
  if (!trusted(e) || !win) return null
  const r = await dialog.showSaveDialog(win, { defaultPath: name }); if (r.canceled || !r.filePath) return null
  fs.writeFileSync(r.filePath, text, { mode: 0o600 }); return r.filePath
})
ipcMain.handle('hv:backup', async e => {
  if (!trusted(e) || !win) return null
  const r = await dialog.showSaveDialog(win, { defaultPath: `hostvault-backup-${new Date().toISOString().slice(0, 10)}.db` }); if (r.canceled || !r.filePath) return null
  svc.backupTo(r.filePath); return r.filePath
})
ipcMain.handle('hv:openUrl', (e, url: string) => { if (trusted(e) && typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url) })
ipcMain.handle('hv:revealVault', e => { if (trusted(e)) shell.showItemInFolder(svc.vaultPath) })
ipcMain.handle('hv:openTerminal', (e, argv: string[]) => {
  // Opens Terminal with the command pre-typed but NOT executed, so the user reviews it first.
  if (!trusted(e) || process.platform !== 'darwin') return false
  if (!Array.isArray(argv) || !argv.every(a => typeof a === 'string')) return false
  const q = (a: string) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)
  const line = argv.map(q).join(' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  require('node:child_process').execFile('osascript', ['-e', `tell application "Terminal" to activate`, '-e', `tell application "Terminal" to do script "${line}"`]); return true
})
ipcMain.handle('hv:installCli', async e => {
  if (!trusted(e)) return { ok: false, error: 'untrusted' }
  const res = process.resourcesPath
  const cli = app.isPackaged ? path.join(res, 'cli', 'hv.cjs') : path.join(app.getAppPath(), 'out', 'cli', 'hv.cjs')
  const nodePath = app.isPackaged ? path.join(res, 'app.asar.unpacked', 'node_modules') : path.join(app.getAppPath(), 'node_modules')
  const script = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 NODE_PATH="${nodePath}" exec "${process.execPath}" "${cli}" "$@"\n`
  for (const dir of ['/usr/local/bin', path.join(app.getPath('home'), '.local', 'bin')]) {
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'hv'), script, { mode: 0o755 }); return { ok: true, path: path.join(dir, 'hv') } } catch { /* try next */ }
  }
  return { ok: false, error: 'Could not write to /usr/local/bin or ~/.local/bin' }
})

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 720, minHeight: 520, show: false, backgroundColor: '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', trafficLightPosition: { x: 16, y: 18 },
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (ev, url) => { if (!url.startsWith('file://') && !url.startsWith('http://localhost')) ev.preventDefault() })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, '../../resources/icon.png'))
  nativeTheme.themeSource = 'light'
  app.on('web-contents-created', (_e, c) => c.session.setPermissionRequestHandler((_wc, _p, cb) => cb(false)))
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Vault', submenu: [{ label: 'Lock', accelerator: 'CmdOrCtrl+L', click: () => svc.lock() }, { label: 'Show Vault File in Finder', click: () => shell.showItemInFolder(svc.vaultPath) }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]))
  createWindow()
  powerMonitor.on('lock-screen', () => svc.lock()); powerMonitor.on('suspend', () => svc.lock())
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})
app.on('before-quit', () => svc.lock())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
