import { XMLParser } from 'fast-xml-parser'

export interface ImportedHost {
  ip: string; hostname: string; mac: string; os: string; status?: 'online' | 'offline'
  services: { port: number; protocol: string; name: string; product: string; version: string; state: string }[]
}
const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])

export function parseNmapXml(xml: string): ImportedHost[] {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: false }).parse(xml)
  if (!doc?.nmaprun) throw new Error('Not a valid Nmap XML file (missing <nmaprun>)')
  const out: ImportedHost[] = []
  for (const h of arr<any>(doc.nmaprun.host)) {
    const addrs = arr<any>(h.address)
    const ip = addrs.find(a => a['@_addrtype'] === 'ipv4' || a['@_addrtype'] === 'ipv6')?.['@_addr'] ?? ''
    const mac = addrs.find(a => a['@_addrtype'] === 'mac')?.['@_addr'] ?? ''
    const hn = arr<any>(h.hostnames?.hostname)
    const hostname = (hn.find(x => x['@_type'] === 'user')?.['@_name'] ?? hn[0]?.['@_name'] ?? '') as string
    const osm = arr<any>(h.os?.osmatch)[0]
    const os = osm?.['@_name'] ?? arr<any>(h.os?.osclass)[0]?.['@_osfamily'] ?? ''
    if (!ip && !hostname) continue
    const services = arr<any>(h.ports?.port).map(p => ({
      port: Number(p['@_portid']), protocol: p['@_protocol'] ?? 'tcp',
      name: p.service?.['@_name'] ?? '', product: p.service?.['@_product'] ?? '', version: p.service?.['@_version'] ?? '',
      state: p.state?.['@_state'] ?? 'open',
    })).filter(s => Number.isInteger(s.port) && s.state === 'open')
    const up = h.status?.['@_state']
    out.push({ ip: String(ip), hostname: String(hostname), mac: String(mac), os: String(os), status: up === 'up' ? 'online' : up === 'down' ? 'offline' : undefined, services })
  }
  return out
}
