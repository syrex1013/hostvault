# HostVault

Encrypted host & access manager for penetration tests — macOS app (Electron + React) and `hv` command-line tool sharing one core.

- **Encrypted vault** (SQLCipher / AES-256) unlocked with a master password; auto-lock on idle, sleep and screen lock; clipboard auto-clear.
- **Hosts** with status `online / offline / dead / unknown`, access level, favourites, tags, services, credentials (passwords, SSH keys, hashes, tokens), Markdown notes and an activity log.
- **Projects** (engagements) with scope and dates; archive when finished.
- **Filtering**: free-text search across IP, hostname, notes, services, users and tags, plus status, access, tags, OS, port, service, has-credentials, last-seen. Save filters as presets.
- **Status checks are on demand only** (ping + TCP) for the hosts you pick. Hosts marked `dead` are skipped. Nothing touches the network by itself (except optional Sliver auto-sync).
- **Import** Nmap XML / CSV (column mapping) / Sliver beacons+sessions, **export** JSON / CSV / Markdown (secrets redacted unless you opt in), **quick connect** command builder (passwords never placed on the command line).
- **Sliver**: bind implant IDs on import/sync; C2 ping, exec, interactive shell; optional background sync (`Settings → Sliver → Auto-sync`).

## Build on macOS

```bash
npm install          # also rebuilds the SQLCipher native module for Electron
npm run dist:mac     # → dist/HostVault-*.dmg (universal)
```

Development: `npm run dev`. The app must be first launched once to create the vault, or run `hv init`.
In the app: *Settings → Install hv* installs the `hv` launcher into `/usr/local/bin` (falls back to `~/.local/bin`).
The app is unsigned; sign/notarize it with your Apple Developer ID before distributing.

## CLI

```bash
hv init                                   # create vault
hv host add 10.0.0.5 --hostname dc01 --tag ad --port 445,3389 --status online --access admin
hv host ls --status online --tag ad       # filters: --access --os --port --service --has-creds --seen 7 -s text --sort ip --desc
hv host show dc01 [--reveal]              hv host status dc01 dead
hv cred add dc01 -u Administrator -d CORP  # secret prompted (hidden) or --secret-stdin
hv note add dc01 "DA via kerberoasting"   hv tag add dc01 crown-jewel
hv check --status unknown                 # on-demand ping + TCP probe
hv connect dc01 --proto rdp               # prints the command; --run for ssh/telnet/ftp
hv import nmap scan.xml --tag nmap-1      hv import csv hosts.csv     hv import sliver --config ~/.sliver-client/configs/op.cfg
hv export md --tag ad -o report.md        # add --include-secrets to include secrets
hv project add "ACME 2026" && hv project use "ACME 2026"
```

`--json` on any command for scripting. Password: interactive prompt, `--password-stdin`, or `HV_PASSWORD`. Vault path: `~/Library/Application Support/HostVault/vault.db` (override with `HV_VAULT`).

### Sliver C2

```bash
hv import sliver --list-configs                              # configs in ~/.sliver-client/configs
hv sliver sync --config ~/.sliver-client/configs/op.cfg      # beacons + sessions → hosts, implant id bound
hv sliver show worker2                                       # binding: implant id, name, kind, health, last sync
hv sliver ping worker2                                       # C2 round-trip (not ICMP)
hv sliver exec worker2 "id; uname -a"                        # run a command (interactive sessions only)
hv sliver shell worker2                                      # interactive implant shell
hv check --via sliver --status unknown                       # C2 ping bound hosts instead of ICMP/TCP
hv connect worker2 --proto sliver                            # opens a sliver shell
```

- The implant ID is the identity. Sliver names repeat, and several implants can share one NAT address (same `Remote Address`, different hostnames), so sync binds `implant_id` to the host and never merges two implants by IP.
- When several operator configs exist, every Sliver command needs `--config`; it is passed to `sliver-client --config`, so the file is never read into an argument.
- Auto-sync is opt-in (`Settings → Sliver → Auto-sync`, or the choice in the import dialog): minutes between background refreshes, `0` = off. Sessions win over beacons for the same target; beacons have no live shell.

## Tests

`npm test` (core, vault, CLI-facing logic) · `npm run build && node tests/gui/walk.cjs` (GUI walkthrough in Chromium against a bridge to the real core; see `tests/gui/`).

**Forgotten master password cannot be recovered.** Keep backups (Settings → Back up) — they stay encrypted.
