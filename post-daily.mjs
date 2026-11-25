// Daily Chimeloop ad poster: schedules the next unposted video from this
// repo's posts/<folder>/ (video.mp4 + caption.md, optional cover.jpg) to Instagram (Reel), TikTok
// and YouTube Shorts through Buffer. The queue lives in git so any machine
// (Windows or Mac) can add videos by pushing; each run starts with `git pull`.
//
//   node post-daily.mjs            pull, import, keep the next DAYS_AHEAD days scheduled (one video/day at POST_HOUR)
//   node post-daily.mjs --import [dir]   only copy new rendered posts from a NeonPulse
//                                  marketing/posts dir (default ../NeonPulse/marketing/posts) into posts/ and push
//   node post-daily.mjs --now      share the next video immediately
//   node post-daily.mjs --status   only refresh and print the status of everything posted so far
//   node post-daily.mjs --dry      show what would be scheduled, change nothing
//
// Needs BUFFER_API_KEY (env var). Videos are served from GitHub Pages
// (this repo), because Buffer only accepts public media URLs.
import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const POSTS = join(HERE, "posts");
const NEONPULSE_POSTS = join(HERE, "..", "NeonPulse", "marketing", "posts");
const PAGES = "https://ozgunmutlu0.github.io/chimeloop-ads/posts/";
const ORG = "6b05f6e75cc49a33a446e40c";
// Per-service post settings. Channels are read from Buffer on each run, so a
// newly connected supported account (e.g. YouTube) starts receiving posts automatically.
const METADATA = {
  instagram: () => ({ instagram: { type: "reel", shouldShareToFeed: true } }),
  tiktok: () => undefined,
  youtube: (folder) => ({
    youtube: { title: `${hook(folder)} | Chimeloop #Shorts`.slice(0, 100), categoryId: "20", type: "short", privacy: "public", madeForKids: false },
  }),
};
let CHANNELS = [];
const POST_HOUR = 19; // local time (Turkey)
const DAYS_AHEAD = 3; // keep this many days scheduled so a day with the PC off still posts
const STATE = join(HERE, "state.json");
const LOG = join(HERE, "posting.log");
const FILES = ["video.mp4", "caption.md", "cover.jpg"]; // cover.jpg is optional
const COVER_OFFSET_MS = 100; // the cover is baked into the first 0.3 s of each video (TikTok picks its cover by offset)

const args = new Set(process.argv.slice(2));
const key = process.env.BUFFER_API_KEY;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
}

async function gql(query, variables) {
  const r = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

function caption(folder) {
  const md = readFileSync(join(POSTS, folder, "caption.md"), "utf8");
  const get = (label) => (md.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`)) || [])[1]?.trim() || "";
  return [get("Caption \\(EN\\)"), get("Hashtags")].filter(Boolean).join("\n\n");
}

// On-screen hook, used as the YouTube title. Some files list several quoted variants; take the first.
function hook(folder) {
  const md = readFileSync(join(POSTS, folder, "caption.md"), "utf8");
  const raw = (md.match(/\*\*On-screen hook:\*\*\s*(.+)/) || [])[1]?.trim() || folder;
  return (raw.match(/^"([^"]+)"/) || [])[1] || raw;
}

async function loadChannels() {
  const d = await gql(`query($org: OrganizationId!) { channels(input: { organizationId: $org }) { id service isQueuePaused } }`, { org: ORG });
  CHANNELS = d.channels.filter((c) => METADATA[c.service] && !c.isQueuePaused);
}

const git = (cmd) => execSync(`git ${cmd}`, { cwd: HERE, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

function pull() {
  try {
    git("pull -q --ff-only");
  } catch (e) {
    log("WARNING git pull failed, using local copy: " + String(e.stderr || e).trim());
  }
}

const sameFile = (a, b) => existsSync(b) && readFileSync(a).equals(readFileSync(b));
const fileHash = (p) => createHash("sha1").update(readFileSync(p)).digest("hex").slice(0, 10);
const notSentYet = (folder) => !state[folder] || new Date(state[folder].dueAt) - Date.now() > 15 * 60 * 1000;

// Copy rendered posts (video.mp4 + caption.md + cover.jpg) from a NeonPulse marketing/posts dir
// into posts/: new folders, and re-renders of posts that have not gone out yet. Re-rendered posts
// already scheduled in Buffer are deleted there and rescheduled at the same time by the main run.
async function importFrom(dir) {
  if (!existsSync(dir)) return [];
  const added = [];
  const updated = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const src = join(dir, d.name);
    if (!d.isDirectory()) continue;
    if (!existsSync(join(src, "video.mp4")) || !existsSync(join(src, "caption.md"))) continue;
    const exists = existsSync(join(POSTS, d.name));
    if (exists && !notSentYet(d.name)) continue;
    const changed = FILES.filter((f) => existsSync(join(src, f)) && !sameFile(join(src, f), join(POSTS, d.name, f)));
    if (!changed.length) continue;
    mkdirSync(join(POSTS, d.name), { recursive: true });
    for (const f of changed) copyFileSync(join(src, f), join(POSTS, d.name, f));
    (exists ? updated : added).push(d.name);
  }
  for (const folder of updated) await unschedule(folder);
  const all = [...added, ...updated];
  if (all.length) {
    git(`add ${all.map((n) => `"posts/${n}"`).join(" ")}`);
    git(`commit -q -m "${added.length ? "Queue " + added.join(", ") : ""}${added.length && updated.length ? "; " : ""}${updated.length ? "Update " + updated.join(", ") : ""}"`);
    git("push -q");
    if (added.length) log(`imported ${added.length} new video(s): ${added.join(", ")}`);
    if (updated.length) log(`updated ${updated.length} re-rendered video(s): ${updated.join(", ")}`);
  }
  return all;
}

// Drop a post's scheduled Buffer posts but keep its slot, so it gets rescheduled with the new files.
async function unschedule(folder) {
  const entry = state[folder];
  if (!entry) return;
  for (const [svc, p] of Object.entries(entry.posts || {})) {
    if (p.id && p.status !== "sent") {
      const d = await gql(
        `mutation($input: DeletePostInput!) { deletePost(input: $input) { __typename ... on MutationError { message } } }`,
        { input: { id: p.id } },
      );
      if (d.deletePost?.message) log(`${folder} ${svc}: could not delete post ${p.id} - ${d.deletePost.message}`);
      else log(`${folder} ${svc}: deleted scheduled post ${p.id} (re-rendered)`);
    }
    delete entry.posts[svc];
  }
  save();
}

// Make sure the file is pushed and GitHub Pages serves the current version before Buffer fetches
// it. The ?v= hash keeps Buffer and the CDN from using an older copy of a re-rendered file.
async function ensureHosted(folder, file = "video.mp4") {
  const local = join(POSTS, folder, file);
  const url = `${PAGES}${folder}/${file}?v=${fileHash(local)}`;
  const size = String(readFileSync(local).length);
  const urlOk = async (u) => {
    try {
      const r = await fetch(u, { method: "HEAD", cache: "no-store" });
      return r.ok && (!r.headers.get("content-length") || r.headers.get("content-length") === size);
    } catch {
      return false;
    }
  };
  if (await urlOk(url)) return url;
  if (git(`status --porcelain "posts/${folder}"`)) {
    git(`add "posts/${folder}"`);
    git(`commit -q -m "Queue ${folder}"`);
  }
  if (git("rev-list --count @{u}..HEAD") !== "0") git("push -q");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    if (await urlOk(url)) return url;
  }
  throw new Error(`${file} not reachable after push: ${url}`);
}

async function refreshStatus() {
  const ids = new Set(Object.values(state).flatMap((s) => Object.values(s.posts || {}).map((p) => p.id)));
  if (!ids.size) return;
  const d = await gql(
    `query($org: OrganizationId!) { posts(first: 100, input: { organizationId: $org, sort: [{ field: dueAt, direction: desc }] }) {
      edges { node { id status dueAt sentAt channelService externalLink error { message } } } } }`,
    { org: ORG },
  );
  const byId = Object.fromEntries(d.posts.edges.map((e) => [e.node.id, e.node]));
  for (const [folder, s] of Object.entries(state)) {
    for (const [svc, p] of Object.entries(s.posts || {})) {
      const n = byId[p.id];
      if (!n) continue;
      const prev = p.status;
      Object.assign(p, { status: n.status, sentAt: n.sentAt, link: n.externalLink, error: n.error?.message || null });
      if (prev !== n.status) log(`${folder} ${svc}: ${prev} -> ${n.status}${n.error ? " (" + n.error.message + ")" : ""}${n.externalLink ? " " + n.externalLink : ""}`);
    }
  }
  save();
}

function nextSlots() {
  const now = new Date();
  const first = new Date(now);
  first.setHours(POST_HOUR, 0, 0, 0);
  if (first - now < 15 * 60 * 1000) first.setDate(first.getDate() + 1);
  const last = Object.values(state).map((s) => new Date(s.dueAt)).sort((a, b) => b - a)[0];
  const slots = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const t = new Date(first);
    t.setDate(t.getDate() + i);
    if (!last || t.toDateString() !== last.toDateString() && t > last) slots.push(t);
  }
  return slots;
}

async function schedule(folder, due) {
  const url = await ensureHosted(folder);
  const text = caption(folder);
  const entry = (state[folder] ??= { dueAt: due ? due.toISOString() : new Date().toISOString(), posts: {} });
  for (const ch of CHANNELS) {
    if (entry.posts[ch.service]?.id) continue; // already scheduled on this channel
    const metadata = METADATA[ch.service](folder);
    const input = {
      text,
      channelId: ch.id,
      schedulingType: "automatic",
      needsApproval: false,
      mode: due ? "customScheduled" : "shareNow",
      ...(due ? { dueAt: due.toISOString() } : {}),
      // Buffer rejects custom thumbnail images; the cover is the frame at COVER_OFFSET_MS (Instagram, TikTok).
      assets: [{ video: { url, metadata: { thumbnailOffset: existsSync(join(POSTS, folder, "cover.jpg")) ? COVER_OFFSET_MS : 1500 } } }],
      ...(metadata ? { metadata } : {}),
    };
    const d = await gql(
      `mutation($input: CreatePostInput!) { createPost(input: $input) {
        ... on PostActionSuccess { post { id status dueAt } }
        ... on MutationError { message } } }`,
      { input },
    );
    const res = d.createPost;
    if (res.post) {
      entry.posts[ch.service] = { id: res.post.id, status: res.post.status };
      log(`${folder} ${ch.service}: ${due ? "scheduled for " + due.toLocaleString("tr-TR") : "shared now"} (post ${res.post.id})`);
    } else {
      entry.posts[ch.service] = { id: null, status: "error", error: res.message };
      log(`${folder} ${ch.service}: FAILED - ${res.message}`);
    }
    save();
  }
}

if (!key) {
  log("BUFFER_API_KEY is not set");
  process.exit(1);
}

try {
  if (args.has("--import")) {
    const i = process.argv.indexOf("--import");
    const dir = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? resolve(process.argv[i + 1]) : NEONPULSE_POSTS;
    pull();
    const added = await importFrom(dir);
    if (!added.length) console.log("nothing new to import from", dir);
    process.exit(0);
  }
  if (!args.has("--status") && !args.has("--dry")) {
    pull();
    await importFrom(NEONPULSE_POSTS);
  }
  await loadChannels();
  await refreshStatus();
  if (!args.has("--status") && !args.has("--dry")) {
    // Videos already scheduled for later get added to any channel connected since (e.g. YouTube).
    for (const [folder, s] of Object.entries(state)) {
      if (new Date(s.dueAt) - Date.now() > 15 * 60 * 1000 && CHANNELS.some((c) => !s.posts[c.service]?.id))
        await schedule(folder, new Date(s.dueAt));
    }
  }
  if (args.has("--status")) {
    console.log("channels:", CHANNELS.map((c) => c.service).join(", "));
    for (const [f, s] of Object.entries(state))
      console.log(f, new Date(s.dueAt).toLocaleString("tr-TR"), Object.entries(s.posts).map(([k, p]) => `${k}=${p.status}${p.error ? "(" + p.error + ")" : ""}`).join(" "));
    process.exit(0);
  }
  const pending = readdirSync(POSTS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(POSTS, d.name, "video.mp4")) && !state[d.name])
    .map((d) => d.name)
    .sort();
  if (args.has("--now")) {
    if (pending[0]) await schedule(pending[0], null);
  } else {
    const slots = nextSlots();
    for (const slot of slots) {
      const folder = pending.shift();
      if (!folder) break;
      if (args.has("--dry")) console.log("would schedule", folder, slot.toLocaleString("tr-TR"));
      else await schedule(folder, slot);
    }
  }
  if (pending.length < 3) log(`WARNING: only ${pending.length} unposted videos left in stock`);
} catch (e) {
  log("ERROR " + (e.stack || e));
  process.exit(1);
}
