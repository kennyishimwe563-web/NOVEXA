// Connects the Novexa front end to the backend. Loaded after the main script.
var API = "", tok = null, who = "";
function jpost(path, body) {
  return fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) },
    body: JSON.stringify(body),
  }).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Request failed"); return d; });
}

// Chat: replaces the demo ask() with a streaming call to /api/chat
ask = async function (text) {
  text = (text || "").trim(); if (!text || busy) return;
  busy = true; $("chips").style.display = "none";
  add("user", text); convo.push({ role: "user", content: text });
  var out = add("a", "…"), acc = "";
  try {
    const r = await fetch(API + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) },
      body: JSON.stringify({ messages: convo.slice(-12) }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Request failed");
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).replace(/^data: /, ""); buf = buf.slice(i + 2);
        if (!line) continue; const m = JSON.parse(line);
        if (m.error) throw new Error(m.error);
        if (m.t) { acc += m.t; out.textContent = acc; $("msgs").scrollTop = 1e9; }
      }
    }
    convo.push({ role: "assistant", content: acc });
  } catch (e) { out.textContent = e.message || "Something went wrong."; convo.pop(); }
  busy = false;
};

// Sign in / sign up (first try login, then create the account)
$("si").onsubmit = async function (e) {
  e.preventDefault();
  var f = e.target, name = $("sn").value.trim(), email = f.elements[1].value, password = f.elements[2].value;
  try {
    var d;
    try { d = await jpost("/api/login", { email, password }); }
    catch (err) { d = await jpost("/api/signup", { name, email, password }); }
    tok = d.token; user = d.name;
    $("sok").hidden = false; $("sok").textContent = "Welcome, " + user + "! Opening your workspace…";
    setTimeout(function () { show("workspace"); reset(); }, 700);
  } catch (err) { $("sok").hidden = false; $("sok").textContent = err.message; }
};

// Feedback form saves to the database
$("fb").onsubmit = async function (e) {
  e.preventDefault();
  var f = e.target.elements;
  try {
    await jpost("/api/feedback", { name: f[0].value, email: f[1].value, topic: f[2].value, message: f[3].value });
    $("fbok").hidden = false; $("fbok").textContent = "Thanks! Your message was sent."; e.target.reset();
  } catch (err) { $("fbok").hidden = false; $("fbok").textContent = err.message; }
};
