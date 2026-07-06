// Unified Order Monitor — popup (bundle-card layout + local cache)
// Renders instantly from chrome.storage.local; only the Refresh button refetches.

const SOURCES = [
  { name: "Amazon",  url: "https://www.amazon.in/gp/css/order-history?ref_=nav_orders_first", re: /^https:\/\/www\.amazon\.in\/(gp\/css\/order-history|your-orders\/orders)/ },
  { name: "Flipkart", url: "https://www.flipkart.com/account/orders?link=home_orders",         re: /^https:\/\/www\.flipkart\.com\/account\/orders/ },
];
const STAGES = ["Ordered", "Shipped", "Out for delivery"];
const STATUS_LABEL = ["Yet to be shipped", "Shipped", "Out for delivery"];
const CACHE_KEY = "om_cache_v2";

const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const footerEl = document.getElementById("footer");
const refreshBtn = document.getElementById("refresh");
const tabsEl = document.getElementById("tabs");

let BUNDLES = [];
let filter = "all";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const showState = (h) => { listEl.innerHTML = `<div class="state">${h}</div>`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- injected: Flipkart detail ---------- */
// Returns { stage, detailText, detailMeta }. Stage is derived from Flipkart's
// section HEADERS (Order Confirmed / Shipped / Out for delivery), and the detail
// is the last real event before the first "yet to" future line.
async function scrapeFlipkart() {
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  let trg = null;
  for (let i = 0; i < 12 && !trg; i++) {
    trg = [...document.querySelectorAll("span,div,button,a")].filter((n) => /See All Updates/i.test(n.textContent) && n.children.length <= 1).sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (!trg) await nap(400);
  }
  if (trg) { trg.click(); await nap(900); }
  let host = null;
  for (let i = 0; i < 8 && !host; i++) {
    host = [...document.querySelectorAll("div,section")].filter((n) => /Order Confirmed/i.test(n.textContent) && /yet to/i.test(n.textContent)).sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (!host) await nap(300);
  }
  if (!host) return { stage: 0, detailText: "", detailMeta: "" };
  const rawL = [...host.querySelectorAll("div,span,p")].filter((n) => !n.children.length && n.textContent.trim()).map((n) => n.textContent.trim());
  const seq = [];
  for (const t of rawL) if (seq[seq.length - 1] !== t) seq.push(t);

  const isHeader = (t) => /^(Order Confirmed|Shipped|Out for delivery|Delivery)$/i.test(t.trim());
  const headerStage = (t) => { t = t.toLowerCase(); if (t.startsWith("out for delivery")) return 2; if (t.startsWith("shipped")) return 1; if (t.startsWith("delivery")) return 2; return 0; };
  const isPending = (t) => /\byet to\b/i.test(t);
  const isExpected = (t) => /^Expected by/i.test(t);
  const isTime = (t) => /\d{1,2}:\d{2}\s*(am|pm)/i.test(t);
  const isDate = (t) => /^\w{3},?\s*\d{1,2}(st|nd|rd|th)\b/i.test(t) && !isTime(t);
  const isLoc = (t) => /^-\s*[A-Za-z]/.test(t);
  const isCourier = (t) => /Logistics|Ekart|Tracking|FM[A-Z0-9]{6,}/i.test(t);
  const isClose = (t) => t === "\u2715" || t === "\u00d7" || t.length < 3;
  const isEvent = (t) => /[a-z]/.test(t) && t.length > 12 && !isPending(t) && !isExpected(t) && !isTime(t) && !isDate(t) && !isHeader(t) && !isLoc(t) && !isCourier(t) && !isClose(t);

  let step = 0, evIdx = -1, evStep = 0;
  for (let i = 0; i < seq.length; i++) {
    const t = seq[i];
    if (isHeader(t)) { step = headerStage(t); continue; }
    if (isPending(t)) break;
    if (isEvent(t)) { evIdx = i; evStep = step; }
  }
  const detailText = evIdx >= 0 ? seq[evIdx] : "";
  const nxt = seq[evIdx + 1] || "";
  let detailMeta = "";
  if (isLoc(nxt)) detailMeta = nxt.replace(/^-\s*/, "");
  else if (isTime(nxt) || isDate(nxt)) detailMeta = nxt;
  return { stage: evStep, detailText, detailMeta };
}

/* ---------- injected: Amazon detail (See all updates modal) ---------- */
// Returns { stage, detailText, detailMeta }. "See all updates" only exists once a
// package has shipped, so its absence => "Yet to be shipped".
async function scrapeAmazon() {
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const seeAll = [...document.querySelectorAll("a,span,button,div")].some((n) => /See all updates/i.test(n.textContent || "") && n.textContent.trim().length < 25);
  if (!seeAll) return { stage: 0, detailText: "Yet to be shipped", detailMeta: "" };
  const btn = [...document.querySelectorAll("a,span,button,div")].filter((n) => /See all updates/i.test(n.textContent) && n.children.length <= 1).sort((a, b) => a.textContent.length - b.textContent.length)[0];
  if (btn) { btn.click(); await nap(1000); }
  const anchor = [...document.querySelectorAll("*")].find((n) => n.children.length === 0 && /(Package|Out for delivery|Delivered|arrived at|left the|left an|facility)/i.test(n.textContent));
  let host = anchor;
  for (let i = 0; i < 12 && host && host.parentElement; i++) { host = host.parentElement; if (/Tracking ID/i.test(host.textContent)) break; }
  if (!host) return { stage: 1, detailText: "Shipped", detailMeta: "" };
  const rawL = [...host.querySelectorAll("*")].filter((n) => !n.children.length && n.textContent.trim()).map((n) => n.textContent.trim());
  const seq = [];
  for (const t of rawL) if (seq[seq.length - 1] !== t) seq.push(t);
  const isDate = (t) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s/i.test(t);
  const isTime = (t) => /^\d{1,2}:\d{2}\s*(am|pm)$/i.test(t);
  let time = "", text = "", location = "";
  for (let i = 0; i < seq.length; i++) {
    if (isTime(seq[i])) { time = seq[i]; text = seq[i + 1] || ""; const l = seq[i + 2] || ""; if (l && !isTime(l) && !isDate(l) && /[A-Z]{2,}/.test(l)) location = l; break; }
  }
  if (!text) text = seq.find((t) => /Package|Out for delivery|Delivered|shipped|facility/i.test(t)) || "Shipped";
  const d = text.toLowerCase();
  const stage = /out for delivery/.test(d) ? 2 : 1;
  const detailMeta = [location, time].filter(Boolean).join(" \u00b7 ");
  return { stage, detailText: text, detailMeta };
}

/* ---------- apply detail ---------- */
function applyDetail(b, r) {
  b.stage = (r && typeof r.stage === "number") ? r.stage : 0;
  b.detailText = (r && r.detailText) || b.statusLine || "";
  b.detailMeta = (r && r.detailMeta) || "";
}

/* ---------- tab helpers ---------- */
function waitForComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(handler); reject(new Error("load timeout")); }, timeoutMs);
    function handler(id, info) { if (id === tabId && info.status === "complete") { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(handler); resolve(); } }
    chrome.tabs.onUpdated.addListener(handler);
  });
}
async function requestBundles(tabId, tries = 14) {
  for (let i = 0; i < tries; i++) {
    try { const res = await chrome.tabs.sendMessage(tabId, { type: "GET_BUNDLES" }); if (res && res.ok) return res; if (res && res.error) throw new Error(res.error); } catch (_) {}
    await sleep(600);
  }
  throw new Error("no content-script response");
}
async function scrapeSource(src, currentTab) {
  let tabId, temp = null;
  if (currentTab && src.re.test(currentTab.url || "")) tabId = currentTab.id;
  else { const t = await chrome.tabs.create({ url: src.url, active: false }); tabId = t.id; temp = t.id; await waitForComplete(tabId); await sleep(400); }
  try { const res = await requestBundles(tabId); return res.bundles || []; }
  catch (_) { return []; }
  finally { if (temp != null) { try { await chrome.tabs.remove(temp); } catch (_) {} } }
}
async function fetchDetailRaw(source, url) {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    await waitForComplete(tabId);
    await sleep(source === "Flipkart" ? 1200 : 800);
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: source === "Flipkart" ? scrapeFlipkart : scrapeAmazon });
    return (res && res.result) || {};
  } catch (_) { return {}; }
  finally { if (tabId != null) { try { await chrome.tabs.remove(tabId); } catch (_) {} } }
}

/* ---------- arrival date parsing (for sort) ---------- */
// Converts varied arrival strings into a timestamp for sorting (soonest first).
// Handles: "Arriving today/tomorrow", "Arriving Thursday", "Arriving 14 July",
// "Thu Jul 09", "Jul 16". Unknown/unparseable -> Infinity (sink to bottom).
function parseArrivalTs(str) {
  if (!str) return Infinity;
  const s = String(str).toLowerCase();
  const now = new Date();
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86400000;
  if (/\btoday\b/.test(s)) return sod;
  if (/\btomorrow\b/.test(s)) return sod + DAY;

  const MON = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
  const monIdx = (w) => { w = w.slice(0, 3); return w in MON ? MON[w] : null; };

  // day-month ("14 july") or month-day ("jul 09")
  let day = null, mon = null;
  let m = s.match(/\b(\d{1,2})\s+([a-z]{3,})\b/);
  if (m && monIdx(m[2]) !== null) { day = +m[1]; mon = monIdx(m[2]); }
  else { m = s.match(/\b([a-z]{3,})\s+(\d{1,2})\b/); if (m && monIdx(m[1]) !== null) { mon = monIdx(m[1]); day = +m[2]; } }
  if (mon !== null && day !== null) {
    let d = new Date(now.getFullYear(), mon, day).getTime();
    if (d < sod - 2 * DAY) d = new Date(now.getFullYear() + 1, mon, day).getTime(); // wrapped year
    return d;
  }

  // weekday name only ("thursday" / "thu")
  const WD = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  let wi = WD.findIndex((w) => s.includes(w));
  if (wi < 0) wi = ["sun","mon","tue","wed","thu","fri","sat"].findIndex((w) => new RegExp("\\b" + w + "\\b").test(s));
  if (wi >= 0) { const diff = (wi - now.getDay() + 7) % 7; return sod + diff * DAY; }

  return Infinity;
}

/* ---------- render ---------- */
function pbarHtml(stage) {
  let h = "";
  for (let i = 0; i < STAGES.length; i++) {
    h += `<span class="node ${i <= stage ? "done" : ""}"></span>`;
    if (i < STAGES.length - 1) h += `<span class="seg ${i < stage ? "done" : ""}"></span>`;
  }
  return `<div class="pbar">${h}</div>`;
}
function bundleHtml(b) {
  const stage = b.stage ?? 0;
  const items = b.items.map((it) => `
    <div class="item">
      <img src="${esc(it.image || "")}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
      <div class="ib">
        <div class="it">${esc(it.title)}</div>
        ${it.amount ? `<div class="amt">${esc(it.amount)}</div>` : ""}
      </div>
    </div>`).join("");
  const meta = b.detailMeta ? `<div class="detailmeta">${esc(b.detailMeta)}</div>` : "";
  return `
  <div class="bundle ${b.source}">
    <div class="bhead">
      <div class="bhead-l"><span class="src ${b.source}">${b.source}</span><span class="oid">${esc(b.orderId)}</span></div>
      <div class="arrival">${esc(b.arrival || "")}</div>
    </div>
    <div class="statusrow s${stage}">${esc(STATUS_LABEL[stage])}</div>
    ${pbarHtml(stage)}
    <div class="detail">${esc(b.detailText || "")}</div>
    ${meta}
    <div class="items">${items}</div>
  </div>`;
}
function render() {
  let shown = filter === "all" ? BUNDLES.slice() : BUNDLES.filter((b) => b.source === filter);
  shown.sort((a, b) => parseArrivalTs(a.arrival) - parseArrivalTs(b.arrival));
  const itemCount = BUNDLES.reduce((n, b) => n + b.items.length, 0);
  countEl.textContent = itemCount;
  if (!shown.length) { showState(filter === "all" ? "No active orders.<br>Hit Refresh to check." : `No active ${filter} orders.`); return; }
  listEl.innerHTML = shown.map(bundleHtml).join("");
}

tabsEl.addEventListener("click", (e) => {
  const t = e.target.closest(".tab"); if (!t) return;
  [...tabsEl.children].forEach((c) => c.classList.remove("active"));
  t.classList.add("active"); filter = t.dataset.f; render();
});

/* ---------- cache ---------- */
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
async function loadCache() {
  return new Promise((resolve) => chrome.storage.local.get(CACHE_KEY, (o) => resolve(o[CACHE_KEY] || null)));
}
async function saveCache(bundles) {
  return new Promise((resolve) => chrome.storage.local.set({ [CACHE_KEY]: { bundles, ts: Date.now() } }, resolve));
}

/* ---------- refresh (only manual) ---------- */
async function refresh() {
  refreshBtn.disabled = true;
  countEl.textContent = "…";
  BUNDLES = [];
  showState("Gathering orders…<br><small>checking Amazon &amp; Flipkart</small>");
  try {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    for (const src of SOURCES) {
      showState(`Scanning ${src.name}…`);
      BUNDLES.push(...(await scrapeSource(src, currentTab)));
    }
    if (!BUNDLES.length) { render(); footerEl.textContent = "0 active orders"; await saveCache(BUNDLES); return; }

    const urls = [...new Set(BUNDLES.filter((b) => b.detailUrl).map((b) => b.detailUrl))];
    const cache = {};
    for (let i = 0; i < urls.length; i++) {
      const sample = BUNDLES.find((b) => b.detailUrl === urls[i]);
      showState(`Reading live status…<br><small>bundle ${i + 1} of ${urls.length} · ${esc(sample.source)}</small>`);
      cache[urls[i]] = await fetchDetailRaw(sample.source, urls[i]);
    }
    BUNDLES.forEach((b) => applyDetail(b, b.detailUrl ? cache[b.detailUrl] : null));

    await saveCache(BUNDLES);
    render();
    footerEl.textContent = `Updated just now · ${BUNDLES.length} bundles`;
  } catch (err) {
    countEl.textContent = "–";
    showState(`Something went wrong.<br><small>${esc(err.message)}</small><br><br>Sign in to both, then Refresh.`);
  } finally {
    refreshBtn.disabled = false;
  }
}

/* ---------- init: render from cache, do NOT auto-fetch ---------- */
async function init() {
  const cached = await loadCache();
  if (cached && cached.bundles && cached.bundles.length) {
    BUNDLES = cached.bundles;
    render();
    footerEl.textContent = `Cached · updated ${timeAgo(cached.ts)} · tap Refresh to update`;
  } else {
    showState("No data yet.<br>Tap <b>Refresh</b> to fetch your active orders.");
    countEl.textContent = "0";
  }
}

refreshBtn.addEventListener("click", refresh);
document.addEventListener("DOMContentLoaded", init);
