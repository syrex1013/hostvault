import type { Credential, Host, Service } from './types'

export type Proto = 'ssh' | 'rdp' | 'smb' | 'http' | 'https' | 'ftp' | 'winrm' | 'mssql' | 'mysql' | 'vnc' | 'telnet'
export interface ConnectCommand { proto: Proto; argv: string[]; display: string; needsPassword: boolean; note?: string }

const PORT_PROTO: Record<number, Proto> = { 22: 'ssh', 3389: 'rdp', 445: 'smb', 139: 'smb', 80: 'http', 8080: 'http', 443: 'https', 8443: 'https', 21: 'ftp', 5985: 'winrm', 5986: 'winrm', 1433: 'mssql', 3306: 'mysql', 5900: 'vnc', 23: 'telnet' }
export function guessProto(s: Pick<Service, 'port' | 'name'>): Proto | undefined {
  const n = s.name.toLowerCase()
  if (n.includes('ssh')) return 'ssh'
  if (n.includes('ms-wbt') || n.includes('rdp')) return 'rdp'
  if (n.includes('microsoft-ds') || n.includes('smb') || n.includes('netbios-ssn')) return 'smb'
  if (n.includes('https') || n.includes('ssl/http')) return 'https'
  if (n.includes('http')) return 'http'
  if (n.includes('ftp')) return 'ftp'
  if (n.includes('winrm')) return 'winrm'
  return PORT_PROTO[s.port]
}

const shq = (a: string) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)
export const toDisplay = (argv: string[]) => argv.map(shq).join(' ')

/** Builds an argv array. Secrets are never put on the command line. */
export function buildConnect(proto: Proto, host: Pick<Host, 'ip' | 'hostname'>, svc?: Pick<Service, 'port'>, cred?: Pick<Credential, 'username' | 'domain' | 'kind' | 'secret'>): ConnectCommand {
  const target = host.ip || host.hostname
  if (target.startsWith('-')) throw new Error('Invalid target')
  const port = svc?.port
  const user = cred?.username ?? ''
  const dom = cred?.domain ?? ''
  const hasPw = !!cred?.secret && cred.kind === 'password'
  let argv: string[]; let note: string | undefined
  switch (proto) {
    case 'ssh':
      argv = ['ssh', ...(port && port !== 22 ? ['-p', String(port)] : []), ...(user ? [`${user}@${target}`] : [target])]
      if (cred?.kind === 'ssh-key') note = 'Save the key to a file and add: -i <keyfile>'
      break
    case 'rdp':
      argv = ['xfreerdp', `/v:${target}${port && port !== 3389 ? ':' + port : ''}`, ...(user ? [`/u:${user}`] : []), ...(dom ? [`/d:${dom}`] : []), '/cert:ignore']; break
    case 'smb':
      argv = ['smbclient', `//${target}/C$`, ...(user ? ['-U', dom ? `${dom}\\${user}` : user] : ['-N'])]; break
    case 'http': case 'https': {
      const def = proto === 'http' ? 80 : 443
      argv = ['open', `${proto}://${target}${port && port !== def ? ':' + port : ''}/`]; break
    }
    case 'ftp': argv = ['ftp', ...(port && port !== 21 ? [target, String(port)] : [target])]; break
    case 'winrm': argv = ['evil-winrm', '-i', target, ...(user ? ['-u', user] : []), ...(port ? ['-P', String(port)] : [])]; break
    case 'mssql': argv = ['impacket-mssqlclient', `${dom ? dom + '/' : ''}${user}@${target}`, ...(port && port !== 1433 ? ['-port', String(port)] : []), ...(dom ? ['-windows-auth'] : [])]; break
    case 'mysql': argv = ['mysql', '-h', target, ...(port && port !== 3306 ? ['-P', String(port)] : []), ...(user ? ['-u', user] : []), ...(hasPw ? ['-p'] : [])]; break
    case 'vnc': argv = ['open', `vnc://${target}${port && port !== 5900 ? ':' + port : ''}`]; break
    case 'telnet': argv = ['telnet', target, ...(port ? [String(port)] : [])]; break
  }
  if (hasPw && !note && proto !== 'http' && proto !== 'https' && proto !== 'vnc') note = 'Password is not included — paste it from the clipboard when prompted.'
  return { proto, argv, display: toDisplay(argv), needsPassword: hasPw, note }
}
