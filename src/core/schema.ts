export const MIGRATIONS: string[] = [
`
CREATE TABLE projects (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, client TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '', start_date TEXT, end_date TEXT,
  color TEXT NOT NULL DEFAULT '#DC2626', archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE hosts (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ip TEXT NOT NULL DEFAULT '', hostname TEXT NOT NULL DEFAULT '', mac TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown','online','offline','dead')),
  access TEXT NOT NULL DEFAULT 'none' CHECK (access IN ('none','user','admin','root')),
  favorite INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked TEXT,
  CHECK (ip <> '' OR hostname <> '')
);
CREATE INDEX hosts_project ON hosts(project_id);
CREATE INDEX hosts_status ON hosts(status);
CREATE TABLE services (
  id INTEGER PRIMARY KEY, host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  port INTEGER NOT NULL, protocol TEXT NOT NULL DEFAULT 'tcp', name TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'open',
  UNIQUE (host_id, port, protocol)
);
CREATE TABLE credentials (
  id INTEGER PRIMARY KEY, host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'password', username TEXT NOT NULL DEFAULT '', secret TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT '', valid INTEGER, source TEXT NOT NULL DEFAULT '',
  last_verified TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY, host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, color TEXT NOT NULL DEFAULT '#6B7280');
CREATE TABLE host_tags (
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (host_id, tag_id)
);
CREATE TABLE activity (
  id INTEGER PRIMARY KEY, host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE saved_filters (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, json TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO projects (name) VALUES ('Default');
`,
`ALTER TABLE hosts ADD COLUMN url TEXT NOT NULL DEFAULT '';`,
`
CREATE TABLE host_sliver (
  host_id INTEGER PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
  implant_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('session','beacon')),
  config_path TEXT NOT NULL DEFAULT '',
  health TEXT NOT NULL DEFAULT '',
  last_message TEXT NOT NULL DEFAULT '',
  synced_at TEXT,
  UNIQUE (config_path, implant_id)
);
CREATE INDEX host_sliver_implant ON host_sliver(implant_id);
`,
]
