// Test-only: serves the built renderer and exposes the real Service over HTTP so the GUI can be driven in plain Chromium.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { Service } from '../../src/main/service'

const svc = new Service(); const root = path.resolve('out/renderer'); const port = Number(process.env.PORT ?? 5199)
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/rpc') {
    let body = ''; for await (const c of req) body += c
    const { method, args } = JSON.parse(body); res.setHeader('content-type', 'application/json')
    try { const fn = svc.api[method]; if (!fn) throw new Error('Unknown method ' + method); res.end(JSON.stringify({ ok: true, data: (await fn(...args)) ?? null })) }
    catch (e) { res.end(JSON.stringify({ ok: false, error: (e as Error).message, code: (e as Error).name })) }
    return
  }
  if (req.method === 'POST' && req.url === '/cred') { let b = ''; for await (const c of req) b += c; res.end(JSON.stringify(svc.repo?.getCredential(JSON.parse(b).id)?.secret ?? '')); return }
  const f = path.join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url!.split('?')[0]))
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.statusCode = 404; return void res.end() }
  res.setHeader('content-type', types[path.extname(f)] ?? 'application/octet-stream'); res.end(fs.readFileSync(f))
}).listen(port, () => console.log('bridge on', port))
