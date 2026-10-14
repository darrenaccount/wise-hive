// The idea Council: 1-7 seats argue an idea in parallel, then the Judge rules on the seats that sat.
// Seats: council-seats.json (the /wise-hive:council skill reads it too, for non-classic seats). The user's default seat
// set: <brain>\app-settings\council.json, written only by the app's seat bar. Routes: GET/POST /api/council/seats,
// POST /api/council (streams the debate), POST /api/council/more (Swap a seat or Hear one more seat on a recent debate:
// 2 runs instead of a whole new council). A broken roster falls back to the classic three (and test/council-test.js
// FAILs, so the gate catches it). Seats and the Judge run with no tools (only a "read" seat, the Engineer, may Read,
// Grep and Glob) and, in the full edition, no MCP servers: measured 2026-10-13 on Claude Code 2.1.296, a run then starts
// with ~6.5k input tokens instead of ~32k. Lite: lean Sonnet runs (as before), at most liteMax seats.
// A running council counts as busy work (busy(): restarts and Quit wait for it); closing the page stops it and saves the
// answers so far. Moved out of server.js on 2026-10-13 (design: .research/designs/council.md).
"use strict";
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const path = require("path");

const VERDICTS = ["PURSUE", "PIVOT", "PASS"];
const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven"];
const STOPPED = "(Stopped: the page closed before the Judge ruled.)";
// Used when council-seats.json is missing or broken, so the classic council keeps working.
// The three seats are the classic entries of council-seats.json, verbatim (test/council-test.js compares them).
const FALLBACK = { version: 1, min: 1, max: 3, liteMax: 3, default: ["believer", "skeptic", "investor"], words: [[3, 250]],
  groups: { classic: "Classic" }, aliases: {}, seats: [
    { id: "believer", name: "Believer", callsign: "BELIEVER", group: "classic", role: "The case for",
      blurb: "Makes the strongest case for the idea and who would buy it.", plate: "BELIEVER", accent: "#e2557a", icon: "heart", cheer: ["PURSUE"],
      brief: "Make the strongest honest case that this idea works: who exactly buys it, the painful problem it solves, why now, how to reach the first 100 customers. Use what you know about the user from your recall context." },
    { id: "skeptic", name: "Skeptic", callsign: "SKEPTIC", group: "classic", role: "The attack",
      blurb: "Attacks the idea and finds what wasn't thought through.", plate: "SKEPTIC", accent: "#7aa2d6", icon: "?!", cheer: ["PASS"], lookY: false,
      brief: "Attack the idea: competitors and substitutes, why people won't pay, build cost and risk, platform or legal risk, hidden assumptions. Rank the top 3 fatal risks first." },
    { id: "investor", name: "Investor", callsign: "INVESTOR", group: "classic", role: "The upside",
      blurb: "Sizes the opportunity and where it could go.", plate: "INVESTOR", accent: "#e9b949", icon: "bars", cheer: ["PURSUE"],
      brief: "Size the opportunity: rough market size with reasoning, business model and pricing, moat, what it becomes in 3-5 years, and the milestone that would make you invest." },
  ] };

// Reads and checks the roster; throws with a readable message on the first problem.
function loadRoster(file) {
  const bad = (m) => { throw new Error("council-seats.json: " + m); };
  let r; const ids = new Set();
  try { r = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { bad(String((e && e.message) || e)); }
  const str = (v, max) => typeof v === "string" && v.trim() !== "" && v.length <= max;
  if (!r || typeof r.groups !== "object" || !r.groups || Array.isArray(r.groups)) bad("groups missing");
  if (!Array.isArray(r.seats) || !r.seats.length) bad("no seats");
  for (const s of r.seats) {
    const id = s && s.id;
    if (typeof id !== "string" || !/^[a-z]{2,20}$/.test(id) || id === "judge" || ids.has(id)) bad("bad or repeated id " + id);
    if (!/^[A-Z][A-Z ]{2,30}$/.test(s.callsign || "")) bad("bad callsign for " + id);
    if (!str(s.name, 16)) bad("name missing or over 16 chars for " + id);
    if (!str(s.role, 24)) bad("role missing or over 24 chars for " + id);
    if (!str(s.blurb, 120)) bad("blurb missing or over 120 chars for " + id);
    if (!Object.prototype.hasOwnProperty.call(r.groups, s.group)) bad(`group "${s.group}" of ${id} isn't in groups`);
    if (!/^[A-Z0-9 ?!'-]{1,8}$/.test(s.plate || "")) bad("plate must be 1-8 capitals for " + id);
    if (!/^#[0-9a-f]{6}$/i.test(s.accent || "")) bad("accent must be #rrggbb for " + id);
    if (!/^(heart|bars|[A-Z0-9 !?.,:+/'"%#()*=<>_-]{1,3})$/.test(s.icon || "")) bad("icon must be heart, bars or 1-3 pixel-font characters for " + id);
    if (!Array.isArray(s.cheer) || !s.cheer.every((w) => VERDICTS.includes(w))) bad("cheer must list PURSUE, PIVOT or PASS for " + id);
    if (s.lookY !== undefined && typeof s.lookY !== "boolean") bad("lookY must be true or false for " + id);
    if (s.tools !== undefined && s.tools !== "read") bad('tools can only be "read" for ' + id);
    if (!str(s.brief, 1200)) bad("brief missing or over 1200 chars for " + id);
    ids.add(id);
  }
  for (const [a, id] of Object.entries(r.aliases || {})) if (!ids.has(id)) bad(`alias ${a} -> unknown ${id}`);
  if (![r.min, r.max, r.liteMax].every(Number.isInteger) || !(r.min >= 1 && r.min <= r.liteMax && r.liteMax <= r.max && r.max <= 7)) bad("limits must be integers with 1 <= min <= liteMax <= max <= 7");
  if (!Array.isArray(r.default) || !r.default.length || r.default.length > r.liteMax || !r.default.every((id) => ids.has(id))) bad("bad default");
  if (!Array.isArray(r.words) || !r.words.length || !r.words.every((w) => Array.isArray(w) && Number.isInteger(w[0]) && Number.isInteger(w[1]) && w[1] >= 50)
    || r.words[r.words.length - 1][0] < r.max) bad("words must be [[upToSeats, words], ...] up to max");
  return r;
}

module.exports = (ctx) => {
  const { BRAIN, LITE, json, body, sse, runClaude, stopRun, simplify } = ctx;
  const trk = typeof ctx.trk === "function" ? ctx.trk : () => null;   // the activity panel (jobs.js); never throws
  let R, rosterError = "";
  try { R = loadRoster(path.join(ctx.APP_DIR, "council-seats.json")); }
  catch (e) { R = FALLBACK; rosterError = String((e && e.message) || e); console.error(new Date().toISOString(), "council: only the classic three are available:", rosterError); }
  const BY = Object.assign(Object.create(null), Object.fromEntries(R.seats.map((s) => [s.id, s])));
  const MIN = R.min, MAX = LITE ? R.liteMax : R.max;
  const CFG = path.join(BRAIN, "app-settings", "council.json");
  const DIR = path.join(BRAIN, "council");
  const CLASSIC = R.default.join(",");
  let active = 0;   // councils in progress; server.js activeRuns counts them
  // The last KEEP_DEBATES debates, by file name, for Swap and Hear one more seat: { idea, ids, answers, judges, notes,
  // replaced, busy }. Memory only: after a restart (or 10 newer debates) /more answers 410.
  const KEEP_DEBATES = 10, debates = new Map();
  const remember = (name, d) => { debates.set(name, d); while (debates.size > KEEP_DEBATES) debates.delete(debates.keys().next().value); };

  // Ids or aliases (array or "a,b") -> roster seats: known, no repeats, at most MAX.
  function normalize(list) {
    const out = [];
    for (const raw of Array.isArray(list) ? list : String(list || "").split(",")) {
      const k = String(raw || "").trim().toLowerCase(), id = BY[k] ? k : Object.prototype.hasOwnProperty.call(R.aliases || {}, k) ? R.aliases[k] : null;
      if (id && BY[id] && !out.includes(BY[id])) out.push(BY[id]);
      if (out.length >= MAX) break;
    }
    return out;
  }
  // The user's saved seat set (missing, corrupt or all-unknown = the default).
  function saved() {
    try { const s = normalize(JSON.parse(fs.readFileSync(CFG, "utf8")).seats); if (s.length >= MIN) return s; } catch {}
    return normalize(R.default);
  }
  const pub = (s) => ({ id: s.id, name: s.name, role: s.role, blurb: s.blurb, group: s.group, plate: s.plate, accent: s.accent,
    icon: s.icon, cheer: s.cheer, lookY: s.lookY !== false, tools: !!s.tools });

  const words = (n) => (R.words.find(([upTo]) => n <= upTo) || R.words[R.words.length - 1])[1];
  const seatPrompt = (s, n) => `You are the ${s.callsign} on an idea council. ${s.brief} Short headings and bullets, under ${words(n)} words. ` +
    (s.tools ? `You may use Read, Grep and Glob in the brain folder (${BRAIN}): at most 3 calls, then answer. Never edit anything.` : "Do not use tools.");
  // No tools for anyone but a "read" seat; full-edition runs skip MCP servers; Lite stays lean on Sonnet.
  const edition = () => (LITE ? { model: "sonnet", lean: true } : { mcp: false });
  const seatOpts = (s) => ({ cwd: BRAIN, mode: "read", maxTurns: s.tools ? (LITE ? 4 : 5) : (LITE ? 2 : 3), tools: s.tools ? "Read,Grep,Glob" : "", ...edition() });
  const judgeOpts = () => ({ cwd: BRAIN, mode: "read", maxTurns: LITE ? 1 : 3, tools: "", ...edition() });

  // For the classic three this is the old server.js judgePrompt, byte for byte (test/council-test.js checks it).
  // before: {change, line} when the Judge rules again after a seat joined or was swapped.
  function judgePrompt(idea, sat, a, before) {
    const n = sat.length;
    return `You are the JUDGE of an idea council. Weigh the ${n === 1 ? "view" : WORDS[n] + " views"} fairly and decide whether the user should pursue this idea.
First line exactly: VERDICT: PURSUE|PIVOT|PASS | SCORE: N/10
Then "## Why", "## What would change my mind", "## Next 3 steps". Under 300 words. Do not use tools. If the user pushes back later, re-judge honestly and restate the VERDICT line first.${sat.map((s) => s.id).join(",") === CLASSIC ? "" : `
Each seat argues from one angle: ${sat.map((s) => `${s.name} (${s.role})`).join(", ")}. An angle no seat covered counts neither for nor against the idea.`}${before ? `
Earlier, before ${before.change}, the council ruled: ${before.line}. Say under "## Why" whether that change moved your verdict.` : ""}

IDEA: ${idea}
${sat.map((s) => `\n## ${s.name}\n${a[s.id]}`).join("\n")}`;
  }
  const slugOf = (idea) => idea.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "") || "idea";
  function newDebateFile(idea) {   // never overwrites an earlier debate: -2, -3, ...
    fs.mkdirSync(DIR, { recursive: true });
    const base = `${new Date().toISOString().slice(0, 10)}_${slugOf(idea)}`;
    let f = path.join(DIR, base + ".md");
    for (let n = 2; fs.existsSync(f); n++) f = path.join(DIR, `${base}-${n}.md`);
    return f;
  }
  // A plain council writes exactly the old format; a re-judge keeps every note, replaced seat and earlier ruling.
  function writeDebate(file, d) {
    const sat = d.ids.map((id) => BY[id]).filter(Boolean), judges = d.judges.length ? d.judges : [""];
    const earlier = d.replaced.map((x) => `### ${x.name} (replaced)\n${x.text}\n\n`).join("") +
      judges.slice(0, -1).map((j, i) => `### Judge, ruling ${i + 1}\n${j}\n\n`).join("");
    fs.writeFileSync(file, `# Council: ${d.idea}\n\n` + (d.notes.length ? d.notes.join("\n") + "\n\n" : "") +
      sat.map((s) => `## ${s.name}\n${d.answers[s.id]}\n\n`).join("") + `## Judge\n${judges[judges.length - 1]}\n` +
      (earlier ? `\n## Earlier in this debate\n${earlier}` : ""));
  }

  // One council on one response: guarded writes, the runs it started, its activity-panel row, the busy count, and
  // stop-on-close (a council can't reattach after a reload, so runs nobody would see are stopped).
  function session(res, name) {
    const raw = sse(res);
    const S = { ended: false, aborted: false, runs: new Set(), job: trk("begin", { kind: "council", name, icon: "judge", started: Date.now() }),
      send: (o) => { if (!S.ended && !res.destroyed) { try { raw(o); } catch {} } },
      end: (e) => { if (S.ended) return; S.ended = true; active--; trk("end", S.job, e || { ok: false, code: 1, err: "The council stopped" }); try { res.end(); } catch {} } };
    active++;
    // 'close' also fires after a normal end; S.ended tells the two apart.
    res.on("close", () => { if (S.ended || S.aborted) return; S.aborted = true; trk("stopping", S.job, "user"); for (const id of S.runs) stopRun(id, "user"); });
    return S;
  }
  function runSeat(S, s, n, idea, answers, costs) {
    return new Promise((resolve) => {
      let acc = "", got = false, over = false, id = null;
      id = runClaude({ prompt: `${seatPrompt(s, n)}\n\nIDEA: ${idea}`, ...seatOpts(s),
        job: { parent: S.job, kind: "council-member", name: s.name, icon: s.id },
        onEvent: (ev) => { const x = simplify(ev); if (!x) return;
          if (x.t === "delta") { acc += x.text; S.send({ t: "delta", agent: s.id, text: x.text }); }
          if (x.t === "result" && !got) { got = true; answers[s.id] = x.text || acc; costs.push(x.cost || 0);
            S.send({ t: "done", agent: s.id, text: answers[s.id], error: x.error, cost: x.cost }); } },
        onEnd: () => { if (over) return; over = true; S.runs.delete(id);   // once, whatever runClaude does
          if (!got) { answers[s.id] = acc || "(no answer)"; S.send({ t: "done", agent: s.id, text: answers[s.id], error: true }); }
          resolve(); } });
      if (!over) S.runs.add(id);
    });
  }
  // after(judge, cost, got, error)
  function runJudge(S, prompt, after) {
    let judge = "", cost = 0, got = false, err = false, over = false, id = null;
    id = runClaude({ prompt, ...judgeOpts(), job: { parent: S.job, kind: "judge", name: "Judge", icon: "judge" },
      onEvent: (ev) => { const x = simplify(ev); if (!x) return;
        if (x.t === "session") S.send({ t: "judgeSession", id: x.id });
        if (x.t === "delta") { judge += x.text; S.send({ t: "delta", agent: "judge", text: x.text }); }
        if (x.t === "result" && !got) { got = true; judge = x.text || judge; cost = x.cost || 0; err = !!x.error; S.send({ t: "done", agent: "judge", text: judge, error: x.error }); } },
      onEnd: () => { if (over) return; over = true; S.runs.delete(id);
        if (!got) S.send({ t: "done", agent: "judge", text: judge || "The Judge didn't answer. Try again.", error: true });
        after(judge, cost, got, err); } });
    if (!over) S.runs.add(id);
  }
  const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
  const verdictEnd = (judge, ok) => ({ ok, code: ok ? 0 : 1, text: judge, err: judge || "The judge gave no verdict" });

  async function route(p, req, res) {
    if (p === "/api/council/seats" && req.method === "GET") {
      json(res, 200, { roster: R.seats.map(pub), groups: R.groups, seats: saved().map((s) => s.id), default: R.default, min: MIN, max: MAX, lite: !!LITE,
        ...(rosterError ? { error: rosterError } : {}) });
      return true;
    }
    if (p === "/api/council/seats" && req.method === "POST") {
      const s = normalize((await body(req)).seats);
      if (s.length < MIN) { json(res, 400, { error: "Pick at least one seat." }); return true; }
      writeFileAtomic(CFG, JSON.stringify({ seats: s.map((x) => x.id), updated: new Date().toISOString() }, null, 2) + "\n");
      json(res, 200, { seats: s.map((x) => x.id) });
      return true;
    }
    if (p === "/api/council" && req.method === "POST") {
      const o = await body(req), idea = String(o.idea || "").trim().slice(0, 4000);
      if (!idea) { json(res, 400, { error: "Pitch an idea first." }); return true; }
      let sat = o.seats === undefined ? saved() : normalize(o.seats);   // no seats (an old page): the saved default
      if (!sat.length) sat = saved();
      const S = session(res, "Council: " + idea.replace(/\s+/g, " ").slice(0, 80)), answers = {}, costs = [];
      const d = { idea, ids: sat.map((s) => s.id), answers, judges: [], notes: [], replaced: [], busy: false };
      const finish = (jc, end) => {
        let file = "";
        try { const f = newDebateFile(idea); writeDebate(f, d); file = f; if (!S.aborted) remember(path.basename(f), d); } catch (e) { console.error(new Date().toISOString(), "council save:", e); }
        S.send({ t: "saved", file }); S.send({ t: "end", cost: sum(costs) + jc }); S.end(end);
      };
      S.send({ t: "seats", seats: sat.map(pub) });
      Promise.all(sat.map((s) => runSeat(S, s, sat.length, idea, answers, costs))).then(() => {
        if (S.aborted) { d.judges.push(STOPPED); return finish(0); }   // the page closed: no Judge run, keep what was paid for
        runJudge(S, judgePrompt(idea, sat, answers), (judge, jc, got, err) => {
          d.judges.push(got ? judge : S.aborted ? (judge ? judge + "\n\n" : "") + STOPPED : judge || "(The Judge didn't answer.)");
          finish(jc, verdictEnd(judge, got && !err && !!judge));
        });
      }).catch((e) => { console.error(new Date().toISOString(), "council:", e); S.send({ t: "end" }); S.end(); });
      return true;
    }
    // On a recent debate, 2 runs (one seat, then the Judge again): Swap {file, seats:[new], swap:"old"} puts the new seat
    // in the old one's place (its answer leaves the Judge's input; works even at the maximum), Hear one more seat
    // {file, seats:[new]} adds a voice. The debate file is rewritten with its history kept. Refusals are plain JSON.
    if (p === "/api/council/more" && req.method === "POST") {
      const o = await body(req), name = String(o.file || "");
      const d = /^\d{4}-\d{2}-\d{2}_[a-z0-9-]{1,48}\.md$/.test(name) ? debates.get(name) : null;
      if (!d) { json(res, 410, { error: "That debate isn't in memory any more (The Wise Hive restarted, or 10 newer debates came after it). Convene the council again." }); return true; }
      if (d.busy) { json(res, 409, { error: "The council is already hearing a seat on this idea." }); return true; }
      const had = d.ids.map((id) => BY[id]).filter(Boolean);
      const out = o.swap === undefined ? null : had.find((s) => s.id === String(o.swap));
      if (o.swap !== undefined && !out) { json(res, 400, { error: "That seat isn't in this debate." }); return true; }
      const add = normalize(o.seats).filter((s) => !d.ids.includes(s.id)).slice(0, out ? 1 : Math.max(0, MAX - had.length));
      if (!add.length) { json(res, 400, { error: out ? "Pick a seat that isn't in this debate." : `The council is full (${MAX} seats). Swap a seat instead.` }); return true; }
      const sat = out ? had.map((s) => (s.id === out.id ? add[0] : s)) : had.concat(add);
      const change = out ? `${add[0].name} replaced ${out.name}` : `${add.map((s) => s.name).join(" and ")} joined`;
      const before = { change, line: (String(d.judges[d.judges.length - 1] || "").split("\n")[0] || "no verdict").slice(0, 120) };
      d.busy = true;
      const S = session(res, `Council: ${d.idea.replace(/\s+/g, " ").slice(0, 60)} (${change})`), costs = [], file = path.join(DIR, name);
      const finish = (jc, end) => { d.busy = false; S.send({ t: "saved", file }); S.send({ t: "end", cost: sum(costs) + jc }); S.end(end); };
      S.send({ t: "seats", seats: add.map(pub), ...(out ? { swap: out.id } : { add: true }) });
      Promise.all(add.map((s) => runSeat(S, s, sat.length, d.idea, d.answers, costs))).then(() => {
        if (S.aborted) { d.busy = false; return S.end(); }   // the page closed: the debate and its file stay as they were
        runJudge(S, judgePrompt(d.idea, sat, d.answers, before), (judge, jc, got, err) => {
          if (got || !S.aborted) {
            if (out) d.replaced.push({ name: out.name, text: d.answers[out.id] });
            d.ids = sat.map((s) => s.id);
            d.notes.push(`_Re-judged after ${change}. Before: ${before.line}_`);
            d.judges.push(got ? judge : judge || "(The Judge didn't answer.)");
            try { writeDebate(file, d); } catch (e) { console.error(new Date().toISOString(), "council save:", e); }
          }
          finish(jc, verdictEnd(judge, got && !err && !!judge));
        });
      }).catch((e) => { d.busy = false; console.error(new Date().toISOString(), "council more:", e); S.send({ t: "end" }); S.end(); });
      return true;
    }
    return false;
  }
  return { route, busy: () => active, _test: { normalize, saved, seatPrompt, seatOpts, judgeOpts, judgePrompt, words, MAX, MIN, roster: R, rosterError, debates } };
};
module.exports.loadRoster = loadRoster;
module.exports.FALLBACK = FALLBACK;
