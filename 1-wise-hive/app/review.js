// Review panel of the Working tab: what Working mode did that isn't on the user's own branch yet.
// Working commits each round on the git branch teamwright/autowork. Here the user sees every round's commits, files and diff,
// then Keeps it (cherry-picks onto the branch they work on) or Discards it (git revert on teamwright/autowork; history is
// never rewritten). Reviewed rounds are remembered in working\<slug>\review.json. Projects that aren't git repos
// (e.g. a game that lives in Roblox Studio) only get the round log, since nothing here can undo Studio changes.
const fs = require("fs");
const { writeFileAtomic } = require("./lib/fsx");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const BRANCH = "teamwright/autowork";
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const RID = /^(r\d{1,7}|c[0-9a-f]{40})$/;
const BRANCH_NAME = /^(?!-)(?!.*\.\.)[\w./-]{1,120}$/;
const GRACE = 10 * 60e3; // commits made just after a round "ended" (the worker's last commit can land after its summary)
const DIFF_MAX = 180000, FILE_LINES = 500, MAX_COMMITS = 400;
const slugOf = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "") || "project";
const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
const flat = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const ms = (v) => { const n = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };

module.exports = (ctx) => {
  const BRAIN = ctx.BRAIN, WORK = path.join(BRAIN, "working"), AP = path.join(BRAIN, "autopilot", "working.json");
  const busy = new Set(); // slugs with a Keep/Discard in progress

  /* ---------- git ---------- */
  // Argument arrays only; no shell. core.editor/GIT_EDITOR=true so cherry-pick/revert never wait on an editor.
  function git(cwd, args, extraEnv, timeout = 120000) {
    return new Promise((ok) => execFile("git", ["-c", "core.quotepath=off", "-c", "color.ui=never", "-c", "core.editor=true", ...args],
      { cwd, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_PAGER: "cat", LC_ALL: "C", ...extraEnv } },
      (e, out, err) => ok({ ok: !e, out: String(out || ""), err: String(err || (e && e.message) || ""), code: e ? e.code : 0 })));
  }
  const hasRef = async (dir, b) => (await git(dir, ["rev-parse", "--verify", "--quiet", "refs/heads/" + b])).ok;
  // Like autopilot's gitInfo: the folder has its own .git. A folder inside some other repo only counts if that repo has the
  // autowork branch (Working committed there), so a game folder that happens to sit inside an unrelated repo stays "not git".
  const isRepo = async (dir) => isDir(dir) && (fs.existsSync(path.join(dir, ".git"))
    || ((await git(dir, ["rev-parse", "--is-inside-work-tree"])).out.trim() === "true" && (await hasRef(dir, BRANCH))));
  async function branches(dir) {
    const r = await git(dir, ["for-each-ref", "refs/heads", "--format=%(refname:short)"]);
    return r.out.split(/\r?\n/).map((s) => s.trim()).filter((b) => b && b !== BRANCH);
  }
  // The branch autowork was made from: its own reflog ("Created from main"), else HEAD's ("moving from main to teamwright/autowork"),
  // else main/master, else the first other branch. The user can override it (saved in review.json).
  async function detectBase(dir, list) {
    const own = (await git(dir, ["reflog", "show", "--format=%gs", "refs/heads/" + BRANCH])).out.split(/\r?\n/).filter(Boolean);
    const created = /Created from (?:refs\/heads\/)?(\S+)/.exec(own[own.length - 1] || "");
    if (created && list.includes(created[1])) return created[1];
    const moves = (await git(dir, ["reflog", "show", "--format=%gs", "HEAD"])).out.split(/\r?\n/);
    for (const l of moves) { const m = /moving from (\S+) to teamwright\/autowork/.exec(l); if (m && list.includes(m[1])) return m[1]; }
    return ["main", "master"].find((b) => list.includes(b)) || list[0] || null;
  }
  // Where a branch is checked out (main folder or an extra worktree), or null.
  async function checkedOut(dir, b) {
    const r = await git(dir, ["worktree", "list", "--porcelain"]);
    for (const block of r.out.split(/\r?\n\r?\n/)) {
      const wt = /^worktree (.+)$/m.exec(block), br = /^branch refs\/heads\/(.+)$/m.exec(block);
      if (wt && br && br[1].trim() === b) return wt[1].trim();
    }
    return null;
  }
  async function opInProgress(wt) {
    for (const f of ["CHERRY_PICK_HEAD", "REVERT_HEAD", "MERGE_HEAD", "rebase-merge", "rebase-apply"]) {
      const p = (await git(wt, ["rev-parse", "--git-path", f])).out.trim();
      if (p && fs.existsSync(path.resolve(wt, p))) return f;
    }
    return null;
  }

  /* ---------- projects and rounds ---------- */
  const apState = () => { try { const s = JSON.parse(ctx.read(AP) || "null"); return s && typeof s === "object" ? s : null; } catch { return null; } };
  const reviewFile = (slug) => path.join(WORK, slug, "review.json");
  function loadReview(slug) {
    let o = null;
    try { o = JSON.parse(ctx.read(reviewFile(slug)) || "null"); } catch {}
    o = o && typeof o === "object" ? o : {};
    const plain = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
    return { base: typeof o.base === "string" ? o.base : null, commits: plain(o.commits), rounds: plain(o.rounds), reverts: Array.isArray(o.reverts) ? o.reverts.filter((h) => typeof h === "string") : [] };
  }
  function saveReview(slug, rv) {
    const f = reviewFile(slug);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    writeFileAtomic(f, JSON.stringify(rv, null, 1));
  }
  // Every working\<slug>\ with a log, plus the project Working is on now.
  function projects() {
    const out = new Map(), st = apState();
    const add = (slug, dir, name) => { if (SLUG.test(slug) && dir && !out.has(slug)) out.set(slug, { slug, dir: path.resolve(dir), name: name || path.basename(dir) }); };
    if (st && st.project && typeof st.project.dir === "string") add(slugOf(st.project.name), st.project.dir, st.project.name);
    let dirs = []; try { dirs = fs.readdirSync(WORK); } catch {}
    for (const slug of dirs) {
      if (!SLUG.test(slug) || out.has(slug)) continue;
      const head = (ctx.read(path.join(WORK, slug, "log.md")) || "").slice(0, 2000);
      const dir = (/^Project folder: (.+)$/m.exec(head) || [])[1], name = (/^# Working log: (.+)$/m.exec(head) || [])[1];
      if (dir && path.isAbsolute(dir.trim())) add(slug, dir.trim(), name && name.trim());
    }
    return [...out.values()];
  }
  // A round as roundsOf() gives it, from its card (rounds.js writes working\<slug>\rounds\<n>\card.json), plus the card's
  // project folder; null without a readable card. Cached by file time: old cards don't change, and /api/review runs often.
  const cardCache = new Map();
  const CARD_OUTCOME = { done: "done", failed: "failed", stopped: "stopped", capped: "stopped", skipped: "stopped", interrupted: "stopped" };
  function cardRound(slug, n) {
    const f = path.join(WORK, slug, "rounds", String(n), "card.json");
    let mt; try { mt = fs.statSync(f).mtimeMs; } catch { return null; }
    const hit = cardCache.get(f);
    if (hit && hit.mt === mt) return hit.r;
    let c = null; try { c = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    const p = c && typeof c === "object" && c.project && typeof c.project === "object" ? c.project : {};
    const r = c && typeof c === "object" && !Array.isArray(c) && typeof p.dir === "string" ? {
      dir: p.dir, n, title: flat(c.title, 140), focus: String(c.focus || "").slice(0, 30), why: String(c.why || "").slice(0, 600),
      // The log keeps a round's summary (700 chars) or its error; a card without a parsed report has only its outcome line.
      summary: String(c.summary || String(c.outcomeText || "").replace(/^completed: /, "")).slice(0, c.outcome === "done" ? 700 : 600),
      start: ms(c.startedAt), end: ms(c.endedAt), chatId: typeof c.chatId === "string" && c.chatId ? c.chatId : null, outcome: CARD_OUTCOME[c.outcome] || "" } : null;
    cardCache.set(f, { mt, r });
    return r;
  }
  const cardNums = (slug) => { try { return fs.readdirSync(path.join(WORK, slug, "rounds")).filter((x) => /^\d{1,7}$/.test(x)).map(Number); } catch { return []; } };
  // Rounds of one project from Working's log (working.json): "Started. ... Project: name (dir)" marks which project the
  // rounds after it belong to; plan/start/result/error/note entries carry the round number n. The log keeps only its
  // newest 2000 entries, so rounds it no longer has (or can't tell the project of) come from their cards in
  // working\<slug>\rounds\ when the card is for this folder. A round the log still has is taken from the log, as always.
  function roundsOf(dir, slug) {
    const st = apState(), log = st && Array.isArray(st.log) ? st.log : [], lc = dir.toLowerCase();
    const rounds = new Map();
    let mine = false;
    for (const e of log) {
      if (!e || typeof e !== "object") continue;
      if (e.type === "system" && /^Started\./.test(e.text || "")) {
        const line = (String(e.text).split(/\r?\n/).reverse().find((l) => /^Project: /.test(l)) || "").trim().toLowerCase();
        mine = line.endsWith(`(${lc})`);
        continue;
      }
      const n = Number(e.n);
      if (!Number.isInteger(n) || n < 1) continue;
      let r = rounds.get(n);
      if (!r) { if (!mine) continue; r = { n, title: "", focus: "", why: "", summary: "", start: null, end: null, chatId: null, outcome: "" }; rounds.set(n, r); }
      if (e.title && !r.title) r.title = flat(e.title, 140);
      if (e.focus && !r.focus) r.focus = String(e.focus).slice(0, 30);
      if (e.chatId) r.chatId = String(e.chatId);
      if (e.type === "plan") r.why = String(e.text || "").slice(0, 600);
      else if (e.type === "start") r.start = ms(e.at);
      else if (e.type === "result") { r.end = ms(e.at); r.summary = String(e.text || "").slice(0, 1500); r.outcome = "done"; }
      else if (e.type === "error") { r.end = r.end || ms(e.at); r.outcome = r.outcome || "failed"; r.summary = r.summary || String(e.text || "").slice(0, 600); }
      else if (e.type === "note" && /stopped|skipp|interrupted|ran over/i.test(e.text || "")) { r.end = r.end || ms(e.at); r.outcome = r.outcome || "stopped"; }
    }
    if (slug && SLUG.test(slug)) for (const n of cardNums(slug)) {
      if (n < 1 || (rounds.has(n) && rounds.get(n).start != null)) continue;
      const c = cardRound(slug, n);
      if (!c || c.start == null || path.resolve(c.dir).toLowerCase() !== path.resolve(dir).toLowerCase()) continue; // another folder with the same name
      const { dir: _d, ...r } = c;
      rounds.set(n, r);
    }
    const cur = st && st.active && st.current && Number(st.current.n);
    for (const r of rounds.values()) r.running = !r.end && (r.n === cur || (st && st.active && ["running", "reviewing"].includes(st.status) && r.n === Number(st.iteration)));
    return [...rounds.values()].filter((r) => r.start != null).sort((a, b) => a.start - b.start);
  }
  // The worker also writes its own dated notes to log.md (what changed, how to undo it). Blocks that name "round N" go with it.
  function logNotes(slug) {
    const text = ctx.read(path.join(WORK, slug, "log.md")) || "";
    const blocks = [];
    let cur = null;
    for (const line of text.split(/\r?\n/)) {
      if (/^(#{1,6} |- |\* )/.test(line)) { if (cur) blocks.push(cur); cur = [line]; } else if (cur) cur.push(line);
    }
    if (cur) blocks.push(cur);
    return blocks.map((b) => b.join("\n").trim()).filter((b) => b && !/^# Working log:/.test(b));
  }
  const notesFor = (notes, n) => { const re = new RegExp(`\\bround\\s*#?${n}\\b`, "i"); return notes.filter((b) => re.test(b)).join("\n\n").slice(0, 6000); };
  const workingBusy = (dir) => { const st = apState(); return !!(st && st.active && st.project && String(st.project.dir).toLowerCase() === dir.toLowerCase() && ["running", "reviewing"].includes(st.status)); };

  // Commits on autowork that aren't on the base (patch-equivalent ones already picked are skipped by --cherry-pick),
  // minus what was reviewed here and the revert commits Discard made.
  async function pendingCommits(dir, base, rv) {
    const r = await git(dir, ["log", "--cherry-pick", "--right-only", "--no-merges", "--reverse", "--numstat", `--max-count=${MAX_COMMITS}`,
      "--format=%x1e%H%x1f%ct%x1f%s%x1f%b%x1f", `refs/heads/${base}...refs/heads/${BRANCH}`]);
    if (!r.ok) throw new Error(flat(r.err, 300) || "git log failed");
    const skip = new Set([...Object.keys(rv.commits), ...rv.reverts]);
    const out = [];
    for (const chunk of r.out.split("\x1e")) {
      const f = chunk.split("\x1f");
      if (f.length < 5 || !/^[0-9a-f]{40}$/.test(f[0].trim())) continue;
      const hash = f[0].trim(), body = f[3];
      const reverted = (/This reverts commit ([0-9a-f]{40})/.exec(body) || [])[1];
      if (skip.has(hash) || (reverted && skip.has(reverted))) continue;
      const files = f[4].split(/\r?\n/).map((l) => /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l.trim())).filter(Boolean).map((m) => ({ path: m[3], add: m[1] === "-" ? null : +m[1], del: m[2] === "-" ? null : +m[2] }));
      const trailer = /^Teamwright-Round:\s*(\d+)\s*$/mi.exec(body);
      out.push({ hash, short: hash.slice(0, 8), at: Number(f[1]) * 1000, subject: f[2].slice(0, 200), body: body.trim().slice(0, 1500), files, round: trailer ? Number(trailer[1]) : null });
    }
    return out;
  }
  // Commit -> round: an explicit "Teamwright-Round: N" trailer wins; otherwise the round that was running when it was committed.
  function group(rounds, commits) {
    const byN = new Map(rounds.map((r) => [r.n, { ...r, id: "r" + r.n, commits: [] }]));
    const other = [];
    for (const c of commits) {
      let g = c.round != null ? byN.get(c.round) : null;
      if (!g) {
        const r = [...rounds].reverse().find((x) => x.start <= c.at + 60e3);
        if (r && (r.end == null || c.at <= r.end + GRACE)) g = byN.get(r.n);
      }
      if (g) g.commits.push(c); else other.push({ id: "c" + c.hash, n: null, title: c.subject, summary: c.body, start: c.at, end: c.at, outcome: "commit", commits: [c] });
    }
    return [...byN.values(), ...other].sort((a, b) => a.start - b.start);
  }
  const filesOf = (g) => {
    const m = new Map();
    for (const c of g.commits) for (const f of c.files) {
      const x = m.get(f.path) || { path: f.path, add: 0, del: 0, binary: false };
      if (f.add == null) x.binary = true; else { x.add += f.add; x.del += f.del; }
      m.set(f.path, x);
    }
    return [...m.values()];
  };

  // One project's review list. The heavy parts (git) only run for git repos.
  async function listProject(p) {
    const rv = loadReview(p.slug), rounds = roundsOf(p.dir, p.slug), notes = logNotes(p.slug);
    const base = { slug: p.slug, name: p.name, dir: p.dir, exists: isDir(p.dir), busy: workingBusy(p.dir) };
    const pub = (g, extra) => ({ id: g.id, n: g.n, title: g.title || (g.n ? `Round ${g.n}` : "Commit"), focus: g.focus || "", why: g.why || "", summary: g.summary || "", outcome: g.outcome || "",
      at: g.end || g.start, chatId: g.chatId || null, running: !!g.running, notes: g.n ? notesFor(notes, g.n) : "", ...extra });
    if (!base.exists || !(await isRepo(p.dir))) {
      const list = rounds.filter((r) => !rv.rounds["r" + r.n]).map((r) => pub({ ...r, id: "r" + r.n }, { commits: [], files: [] }));
      return { ...base, git: false, rounds: list, count: list.filter((r) => !r.running).length };
    }
    const all = await branches(p.dir);
    if (!(await hasRef(p.dir, BRANCH))) {
      // No branch yet: rounds that changed nothing in git (or haven't committed) still show as log entries.
      const list = rounds.filter((r) => !rv.rounds["r" + r.n] && r.outcome === "done").map((r) => pub({ ...r, id: "r" + r.n }, { commits: [], files: [] }));
      return { ...base, git: true, noBranch: true, branches: all, base: null, rounds: list, count: list.filter((r) => !r.running).length };
    }
    const b = rv.base && all.includes(rv.base) ? rv.base : await detectBase(p.dir, all);
    if (!b) return { ...base, git: true, branches: all, base: null, error: `Only ${BRANCH} exists in this repo, so there's no branch to keep rounds on.`, rounds: [], count: 0 };
    const commits = await pendingCommits(p.dir, b, rv);
    // Completed rounds that never committed anything (e.g. Studio-only changes) still need a look; rounds whose commits were
    // already kept, merged or discarded, and failed or stopped rounds without commits, don't.
    const times = (await git(p.dir, ["log", "--format=%ct", "--max-count=3000", "refs/heads/" + BRANCH])).out.split(/\r?\n/).map((t) => Number(t) * 1000).filter(Boolean);
    const committed = (g) => times.some((t) => t >= g.start - 60e3 && (g.end == null || t <= g.end + GRACE));
    const list = group(rounds, commits).filter((g) => g.commits.length ? true : g.outcome === "done" && !rv.rounds[g.id] && !committed(g))
      .map((g) => pub(g, { commits: g.commits.map(({ hash, short, at, subject }) => ({ hash, short, at, subject })), files: filesOf(g) }));
    return { ...base, git: true, branches: all, base: b, baseAuto: !rv.base, rounds: list, count: list.filter((r) => !r.running).length, cut: commits.length >= MAX_COMMITS };
  }
  const projectBySlug = (slug) => (SLUG.test(slug || "") ? projects().find((p) => p.slug === slug) || null : null);

  /* ---------- diff ---------- */
  async function diffOf(p, rid) {
    const d = await listProject(p), g = (d.rounds || []).find((r) => r.id === rid);
    if (!g) return { error: "That round isn't waiting for review any more." };
    if (!g.commits.length) return { diff: "", files: [] };
    const r = await git(p.dir, ["show", "--no-color", "-M", "--patch", "--format=%x1ecommit %h %s", ...g.commits.map((c) => c.hash)]);
    if (!r.ok) return { error: flat(r.err, 300) || "git show failed" };
    // Cap each file and the whole thing, so a huge generated file can't freeze the page.
    let out = "", cut = false;
    for (const part of r.out.split(/(?=^diff --git )|(?=^\x1ecommit )/m)) {
      const lines = part.replace(/^\x1e/, "").split("\n");
      let piece = lines.length > FILE_LINES ? lines.slice(0, FILE_LINES).join("\n") + `\n… ${lines.length - FILE_LINES} more lines in this file not shown\n` : lines.join("\n");
      if (lines.length > FILE_LINES) cut = true;
      if (out.length + piece.length > DIFF_MAX) { out += "\n… the rest of the diff is too big to show here; see it with git on the branch.\n"; cut = true; break; }
      out += piece;
    }
    return { diff: out, cut };
  }

  /* ---------- keep / discard ---------- */
  // Runs fn in the folder where `branch` is checked out (refusing if it has uncommitted changes or a half-done git operation),
  // or, when it isn't checked out anywhere, in a temporary worktree so the user's folder isn't touched at all.
  async function onBranch(p, branch, fn) {
    await git(p.dir, ["worktree", "prune"]); // a temp worktree left by a crash would still "have" the branch checked out
    const wt = await checkedOut(p.dir, branch);
    if (wt) {
      const op = await opInProgress(wt);
      if (op) return { error: `A git operation (${op}) is already in progress in ${wt}. Finish or abort it first.` };
      const st = await git(wt, ["status", "--porcelain", "--untracked-files=no"]);
      if (!st.ok) return { error: flat(st.err, 300) || "git status failed" };
      if (st.out.trim()) return { error: `${branch} has uncommitted changes in ${wt}. Commit or stash them first, then try again. Nothing was changed.` };
      return fn(wt, false);
    }
    const tmp = path.join(WORK, p.slug, ".review-" + crypto.randomUUID().slice(0, 8));
    const add = await git(p.dir, ["worktree", "add", "--quiet", tmp, branch], { GIT_LFS_SKIP_SMUDGE: "1" }, 600000);
    if (!add.ok) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} return { error: "Couldn't prepare a temporary copy of " + branch + ": " + flat(add.err, 300) }; }
    try { return await fn(tmp, true); }
    finally {
      await git(p.dir, ["worktree", "remove", "--force", tmp]);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      await git(p.dir, ["worktree", "prune"]);
    }
  }
  // cherry-pick or revert a list of commits; on any failure abort and make sure the branch is exactly where it was.
  async function apply(wt, verb, hashes, branch, tmp) {
    const before = (await git(wt, ["rev-parse", "HEAD"])).out.trim();
    const args = verb === "cherry-pick" ? ["cherry-pick", "-x", "--empty=drop", ...hashes] : ["revert", "--no-edit", ...hashes];
    const r = await git(wt, args, tmp ? { GIT_LFS_SKIP_SMUDGE: "1" } : {});
    if (r.ok) return { ok: true, before, after: (await git(wt, ["rev-parse", "HEAD"])).out.trim() };
    const conflicts = (await git(wt, ["diff", "--name-only", "--diff-filter=U"])).out.split(/\r?\n/).filter(Boolean);
    await git(wt, [verb, "--abort"]);
    let now = (await git(wt, ["rev-parse", "HEAD"])).out.trim();
    if (now !== before) { await git(wt, ["reset", "--hard", "--quiet", before]); now = (await git(wt, ["rev-parse", "HEAD"])).out.trim(); }
    const clean = now === before && !(await opInProgress(wt));
    const what = verb === "cherry-pick" ? `keep it on ${branch}` : `undo it on ${BRANCH}`;
    const untracked = /untracked working tree files would be overwritten[^\n]*\n((?:\s+\S.*\n?)+)/.exec(r.err);
    const why = conflicts.length ? `it conflicts in ${conflicts.slice(0, 6).join(", ")}${conflicts.length > 6 ? ` and ${conflicts.length - 6} more` : ""}`
      : untracked ? `files that aren't in git would be overwritten (${flat(untracked[1], 200)}); move or remove them first`
      : flat(r.err.split(/\r?\n/).filter((l) => l.trim() && !/^(hint:|Aborting|fatal: (cherry-pick|revert) failed)/.test(l)).join(" ").replace(/^(error|fatal): /, ""), 300) || "git refused";
    return { error: `Couldn't ${what}: ${why}. ${clean ? "Nothing was changed." : `Check ${wt}: git couldn't put it back exactly as it was.`}` };
  }
  async function act(p, kind, rid) {
    if (busy.has(p.slug)) return { error: "Already working on this project's review. Try again in a moment." };
    if (workingBusy(p.dir)) return { error: "A Working round is running on this project right now. Wait for it to finish (or press End in Working), then try again." };
    busy.add(p.slug);
    try {
      const d = await listProject(p);
      if (d.error) return { error: d.error };
      const rv = loadReview(p.slug), at = new Date().toISOString();
      const pick = kind === "keepall" ? d.rounds.filter((r) => !r.running) : d.rounds.filter((r) => r.id === rid);
      if (!pick.length) return { error: kind === "keepall" ? "Nothing is waiting for review." : "That round isn't waiting for review any more." };
      if (pick.some((r) => r.running)) return { error: "That round is still running." };
      const mark = (r, status, extra) => {
        rv.rounds[r.id] = { status, at, ...extra };
        for (const c of r.commits) rv.commits[c.hash] = { status, at, round: r.id };
      };
      const hashes = pick.flatMap((r) => r.commits.map((c) => c.hash)); // already oldest first
      if (kind === "mark" && d.git && hashes.length) return { error: "Use Keep or Discard for rounds with commits." };
      // Nothing git can do (not a repo, or rounds without commits): just remember they were looked at.
      if (kind === "mark" || !d.git || !hashes.length) {
        pick.forEach((r) => mark(r, kind === "keep" || kind === "keepall" ? "kept" : "seen"));
        saveReview(p.slug, rv);
        return { ok: true, message: pick.length > 1 ? `Marked ${pick.length} rounds as reviewed.` : "Marked as reviewed." };
      }
      const base = d.base;
      if (!base || !(await hasRef(p.dir, base))) return { error: "Pick the branch to keep rounds on first." };
      if (kind === "discard") {
        const res = await onBranch(p, BRANCH, (wt, tmp) => apply(wt, "revert", [...hashes].reverse(), base, tmp));
        if (res.error) return res;
        const made = (await git(p.dir, ["rev-list", `${res.before}..${res.after}`])).out.split(/\r?\n/).filter((h) => /^[0-9a-f]{40}$/.test(h));
        rv.reverts.push(...made);
        pick.forEach((r) => mark(r, "discarded"));
        saveReview(p.slug, rv);
        return { ok: true, message: `Undid ${pick[0].title} on ${BRANCH} with ${made.length} revert commit${made.length === 1 ? "" : "s"}.` };
      }
      const res = await onBranch(p, base, (wt, tmp) => apply(wt, "cherry-pick", hashes, base, tmp));
      if (res.error) return res;
      pick.forEach((r) => mark(r, "kept", { onto: base }));
      saveReview(p.slug, rv);
      return { ok: true, message: pick.length > 1 ? `Kept ${pick.length} rounds on ${base}.` : `Kept ${pick[0].title} on ${base}.` };
    } catch (e) {
      return { error: "Something went wrong: " + flat(e && e.message || e, 300) };
    } finally { busy.delete(p.slug); }
  }

  async function overview() {
    const list = [];
    for (const p of projects()) { try { list.push(await listProject(p)); } catch (e) { list.push({ slug: p.slug, name: p.name, dir: p.dir, error: flat(e && e.message || e, 300), rounds: [], count: 0 }); } }
    const st = apState(), cur = st && st.project ? slugOf(st.project.name) : null;
    // The project Working is on first, then the ones with the most waiting.
    list.sort((a, b) => (b.slug === cur) - (a.slug === cur) || b.count - a.count);
    return { projects: list, count: list.reduce((n, p) => n + (p.count || 0), 0), current: cur };
  }

  return {
    async route(p, req, res) {
      if (!p.startsWith("/api/review")) return false;
      if (p === "/api/review" && req.method === "GET") { ctx.json(res, 200, await overview()); return true; }
      if (p === "/api/review/count" && req.method === "GET") { const o = await overview(); ctx.json(res, 200, { count: o.count }); return true; }
      const m = /^\/api\/review\/([^/]+)(?:\/(diff|keep|discard|keepall|mark|base)(?:\/([^/]+))?)?$/.exec(p);
      if (!m) return false;
      const proj = projectBySlug(m[1]);
      if (!proj) { ctx.json(res, 404, { error: "Unknown project." }); return true; }
      if (!m[2] && req.method === "GET") { ctx.json(res, 200, await listProject(proj)); return true; }
      if (m[2] === "diff" && req.method === "GET") {
        if (!RID.test(m[3] || "")) { ctx.json(res, 400, { error: "bad round" }); return true; }
        ctx.json(res, 200, await diffOf(proj, m[3])); return true;
      }
      if (req.method !== "POST" || m[3]) { ctx.json(res, 405, { error: "use POST" }); return true; }
      const o = (await ctx.body(req)) || {};
      if (m[2] === "base") {
        const b = String(o.branch || "");
        if (b && (!BRANCH_NAME.test(b) || b === BRANCH || !(await branches(proj.dir)).includes(b))) { ctx.json(res, 400, { error: "That branch doesn't exist." }); return true; }
        const rv = loadReview(proj.slug); rv.base = b || null; saveReview(proj.slug, rv);
        ctx.json(res, 200, await listProject(proj)); return true;
      }
      if (m[2] !== "keepall" && !RID.test(String(o.round || ""))) { ctx.json(res, 400, { error: "bad round" }); return true; }
      const r = await act(proj, m[2], String(o.round || ""));
      if (r.ok) ctx.broadcast({ t: "review", slug: proj.slug });
      ctx.json(res, r.error ? 409 : 200, r.error ? { error: r.error } : { ...r, project: await listProject(proj) });
      return true;
    },
  };
};
