const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JWT_SECRET = process.env.JWT_SECRET || 'meisner-autohaus-secret-2024';
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || '/data/meisner.db';

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// Init DB
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'reader',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    slot TEXT NOT NULL CHECK(slot IN ('vormittag','nachmittag')),
    tour_nr INTEGER NOT NULL CHECK(tour_nr BETWEEN 1 AND 4),
    liefern TEXT DEFAULT '',
    abholen TEXT DEFAULT '',
    leihwagen INTEGER DEFAULT 0,
    gesperrt INTEGER DEFAULT 0,
    notiz TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT DEFAULT '',
    UNIQUE(date, slot, tour_nr)
  );
`);

// Create default admin if no users exist
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (userCount.c === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')").run('admin', hash);
  console.log('✅ Default admin created: admin / admin123');
}

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../frontend/public')));

// ── Auth middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Ungültiger Token' });
  }
}

function authWriter(req, res, next) {
  auth(req, res, () => {
    if (req.user.role === 'reader') return res.status(403).json({ error: 'Keine Schreibrechte' });
    next();
  });
}

function authAdmin(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Nur für Administratoren' });
    next();
  });
}

// ── WebSocket broadcast ──────────────────────────────────────────────────────
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on('connection', (ws, req) => {
  console.log('WS client connected');
  ws.on('close', () => console.log('WS client disconnected'));
});

// ── Auth routes ──────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Ungültige Zugangsdaten' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ username: user.username, role: user.role });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// ── User management (admin only) ─────────────────────────────────────────────
app.get('/api/users', authAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();
  res.json(users);
});

app.post('/api/users', authAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !['admin', 'writer', 'reader'].includes(role)) {
    return res.status(400).json({ error: 'Ungültige Eingabe' });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, role);
    res.json({ id: result.lastInsertRowid, username, role });
  } catch (e) {
    res.status(409).json({ error: 'Benutzername bereits vergeben' });
  }
});

app.put('/api/users/:id', authAdmin, (req, res) => {
  const { role, password } = req.body;
  const { id } = req.params;
  if (role && !['admin', 'writer', 'reader'].includes(role)) {
    return res.status(400).json({ error: 'Ungültige Rolle' });
  }
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, id);
  }
  if (role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  res.json({ ok: true });
});

app.delete('/api/users/:id', authAdmin, (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'Eigenen Benutzer nicht löschbar' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── Tour routes ──────────────────────────────────────────────────────────────
app.get('/api/tours/:date', auth, (req, res) => {
  const { date } = req.params;
  const tours = db.prepare('SELECT * FROM tours WHERE date = ? ORDER BY slot, tour_nr').all(date);

  // Build full grid: 2 slots x 4 tours
  const result = { vormittag: [], nachmittag: [] };
  for (const slot of ['vormittag', 'nachmittag']) {
    for (let nr = 1; nr <= 4; nr++) {
      const existing = tours.find(t => t.slot === slot && t.tour_nr === nr);
      result[slot].push(existing || {
        date, slot, tour_nr: nr,
        liefern: '', abholen: '', leihwagen: 0, gesperrt: 0, notiz: '',
        updated_at: null, updated_by: ''
      });
    }
  }
  res.json(result);
});

app.put('/api/tours/:date/:slot/:nr', authWriter, (req, res) => {
  const { date, slot, nr } = req.params;
  const { liefern, abholen, leihwagen, gesperrt, notiz } = req.body;

  if (!['vormittag', 'nachmittag'].includes(slot)) return res.status(400).json({ error: 'Ungültiger Slot' });
  if (![1, 2, 3, 4].includes(parseInt(nr))) return res.status(400).json({ error: 'Ungültige Tour-Nummer' });

  const stmt = db.prepare(`
    INSERT INTO tours (date, slot, tour_nr, liefern, abholen, leihwagen, gesperrt, notiz, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(date, slot, tour_nr) DO UPDATE SET
      liefern = excluded.liefern,
      abholen = excluded.abholen,
      leihwagen = excluded.leihwagen,
      gesperrt = excluded.gesperrt,
      notiz = excluded.notiz,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `);

  stmt.run(date, slot, parseInt(nr), liefern || '', abholen || '', leihwagen ? 1 : 0, gesperrt ? 1 : 0, notiz || '', req.user.username);

  const updated = db.prepare('SELECT * FROM tours WHERE date = ? AND slot = ? AND tour_nr = ?').get(date, slot, parseInt(nr));

  broadcast('tour_updated', updated);
  res.json(updated);
});

// ── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

server.listen(PORT, () => {
  console.log(`🚗 Autohaus Meisner App läuft auf Port ${PORT}`);
});
