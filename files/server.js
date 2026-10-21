require("dotenv").config();
const express = require("express");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const Anthropic = require("@anthropic-ai/sdk");

const { ANTHROPIC_API_KEY, JWT_SECRET, PORT = 3000 } = process.env;
if (!ANTHROPIC_API_KEY || !JWT_SECRET) {
  console.error("Missing ANTHROPIC_API_KEY or JWT_SECRET in .env");
  process.exit(1);
}

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-5-5";
const SYSTEM =
  "You are Novexa, a friendly, concise AI assistant. Answer clearly in the user's language. " +
  "Use short paragraphs and simple lists when helpful. Never claim to be anything but Novexa.";

// ---------- Database ----------
const db = new Database("novexa.db");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS feedback(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, email TEXT, topic TEXT, message TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// ---------- App ----------
const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static("public"));

const limiter = (max) => rateLimit({ windowMs: 60_000, max, standardHeaders: true, legacyHeaders: false });
const clean = (v, n) => String(v || "").trim().slice(0, n);

function auth(req, _res, next) {
  const t = (req.headers.authorization || "").replace("Bearer ", "");
  try { req.user = jwt.verify(t, JWT_SECRET); } catch { req.user = null; }
  next();
}
const token = (u) => jwt.sign({ id: u.id, name: u.name }, JWT_SECRET, { expiresIn: "7d" });

app.get("/api/health", (_q, r) => r.json({ ok: true }));

app.post("/api/signup", limiter(10), (req, res) => {
  const name = clean(req.body.name, 80), email = clean(req.body.email, 120).toLowerCase(), pw = String(req.body.password || "");
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || pw.length < 8)
    return res.status(400).json({ error: "Enter a name, a valid email and a password of 8+ characters." });
  try {
    const info = db.prepare("INSERT INTO users(name,email,hash) VALUES(?,?,?)").run(name, email, bcrypt.hashSync(pw, 10));
    res.json({ token: token({ id: info.lastInsertRowid, name }), name });
  } catch {
    res.status(409).json({ error: "That email is already registered." });
  }
});

app.post("/api/login", limiter(10), (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!u || !bcrypt.compareSync(String(req.body.password || ""), u.hash))
    return res.status(401).json({ error: "Wrong email or password." });
  res.json({ token: token(u), name: u.name });
});

app.post("/api/feedback", limiter(5), (req, res) => {
  const message = clean(req.body.message, 2000);
  if (!message) return res.status(400).json({ error: "Message is required." });
  db.prepare("INSERT INTO feedback(name,email,topic,message) VALUES(?,?,?,?)")
    .run(clean(req.body.name, 80), clean(req.body.email, 120), clean(req.body.topic, 40), message);
  res.json({ ok: true });
});

// Streaming chat (Server-Sent Events)
app.post("/api/chat", limiter(20), auth, async (req, res) => {
  let msgs = Array.isArray(req.body.messages) ? req.body.messages : [];
  msgs = msgs
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user")
    return res.status(400).json({ error: "Send at least one user message." });

  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM + (req.user ? ` The user's name is ${req.user.name}.` : ""),
      messages: msgs,
    });
    stream.on("text", (t) => send({ t }));
    req.on("close", () => stream.abort());
    await stream.finalMessage();
    send({ done: true });
  } catch (e) {
    console.error("chat error:", e.message);
    send({ error: "The assistant had a problem. Please try again." });
  }
  res.end();
});

app.listen(PORT, () => console.log(`Novexa running at http://localhost:${PORT}`));
