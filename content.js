// Unified Order Monitor — content script
// Returns ACTIVE bundles for the current site. A "bundle" = one shipment with a
// shared status and one or more product items grouped under it.

const SOURCE = location.hostname.includes("flipkart") ? "Flipkart" : "Amazon";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= FLIPKART ================= */
// Capture any status-ish line; classify by EXCLUSION so only terminal states
// (delivered / cancelled / returned / refunded / failed payment) are dropped.
const FK_STATUS_RE = /(Your Order has been placed|Delivery expected by|Delivery between|Arriving|out for delivery|has been shipped|Shipped|Dispatched|Packed|Delivered on|has been delivered|Order Not Placed|Payment not successful|Refund)/i;
const FK_TERMINAL_RE = /(Delivered on|has been delivered|Order Not Placed|Payment not successful|Refund Completed|Refund completed|Returned|Cancelled)/i;
function fkActive(t) { return !!t && !FK_TERMINAL_RE.test(t); }
async function fkLoadAll({ maxRounds = 25, settleMs = 900 } = {}) {
  let last = 0, stable = 0;
  for (let i = 0; i < maxRounds; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(settleMs);
    const h = document.body.scrollHeight;
    if (h === last) { if (++stable >= 2) break; } else { stable = 0; last = h; }
  }
  window.scrollTo(0, 0);
}
function fkOrderId(href) { const m = String(href).match(/order_id=([^&]+)/); return m ? m[1] : ""; }
function fkArrival(line) {
  let m = line.match(/\bArriving\s+([^•]+?)(?:\s*•|$)/i); if (m) return m[1].trim();
  m = line.match(/expected by\s+([^•]+?)(?:\s*•|$)/i); if (m) return m[1].trim();
  m = line.match(/between\s+.*?\bon\s+([^•]+?)(?:\s*•|$)/i); if (m) return m[1].trim();
  m = line.match(/\bon\s+([A-Za-z]{3,}\.?,?\s*\d{1,2}[^•]*)/i); if (m) return m[1].trim();
  return "";
}
function fkScrape() {
  const cards = [...document.querySelectorAll('a[href^="/order_details"]')]
    .filter((a) => a.textContent.trim() && !/Rate & Review/i.test(a.textContent));
  const bundles = [];
  cards.forEach((a) => {
    const leaves = [...a.querySelectorAll("div,span")].filter((n) => !n.children.length && n.textContent.trim());
    const statusTxts = [...new Set(leaves.filter((n) => FK_STATUS_RE.test(n.textContent)).map((n) => n.textContent.trim()))];
    const statusLine = statusTxts.join(" • ");
    if (!fkActive(statusLine)) return;
    const titleLeaf = leaves.find((n) => {
      const t = n.textContent.trim();
      return t.length > 8 && !/^₹|^Color:|^Size:|Delivery|Order has been|Delivered|Pickup charge|Any dead/i.test(t);
    });
    const priceLeaf = leaves.find((n) => /^₹[\d,]+$/.test(n.textContent.trim()));
    const imgEl = a.querySelector("img");
    bundles.push({
      source: "Flipkart",
      orderId: fkOrderId(a.href),
      arrival: fkArrival(statusLine),
      detailUrl: a.href,
      statusLine,
      items: [{ title: titleLeaf ? titleLeaf.textContent.trim() : "(item)", image: imgEl ? imgEl.src : "", amount: priceLeaf ? priceLeaf.textContent.trim() : "" }],
    });
  });
  return bundles;
}

/* ================= AMAZON ================= */
// Classify by EXCLUSION, mirroring Flipkart: capture any status-ish line and
// keep the bundle unless it is a terminal state (delivered / cancelled /
// returned / refunded). This keeps in-progress states like "Delivery on hold",
// "Package delayed", or "Delivery attempt failed" visible instead of dropping
// anything not on a narrow allowlist.
const AMZ_STATUS_RE = /^(Arriving|Now arriving|Arrives|Out for delivery|Preparing for dispatch|Dispatched|Shipped|Not yet dispatched|Delivery on hold|On hold|Package delayed|Delayed|Arriving late|Delivery attempt|Delivered|Cancelled|Canceled|Returned|Refunded|Return)/i;
const AMZ_TERMINAL_RE = /(Delivered|Cancelled|Canceled|Returned|Refunded)/i;
function amzActive(t) { return !!t && !AMZ_TERMINAL_RE.test(t); }
function amzScrape() {
  const bundles = [];
  [...document.querySelectorAll(".order-card")].forEach((card) => {
    const orderId = (card.textContent.match(/\d{3}-\d{7}-\d{7}/) || [])[0] || "";
    const boxes = [...card.querySelectorAll(".delivery-box")];
    (boxes.length ? boxes : [card]).forEach((box) => {
      const statusLeaf = [...box.querySelectorAll("*")].find(
        (n) => n.children.length === 0 &&
          AMZ_STATUS_RE.test(n.textContent.trim()) &&
          n.textContent.trim().length < 60
      );
      const status = statusLeaf ? statusLeaf.textContent.trim() : "";
      if (!amzActive(status)) return;
      const trackA = [...box.querySelectorAll("a")].find((a) => /ship-track/i.test(a.getAttribute("href") || ""));
      const anchors = [...box.querySelectorAll("a")].filter(
        (a) => /\/dp\/|\/gp\/product/i.test(a.getAttribute("href") || "") && a.textContent.trim().length > 15
      );
      const items = anchors.map((a) => {
        let row = a;
        for (let i = 0; i < 5 && row.parentElement; i++) { row = row.parentElement; if (row.querySelector("img")) break; }
        const img = row.querySelector("img");
        return { title: a.textContent.trim(), image: img ? img.src : "", amount: "" };
      });
      if (!items.length) return;
      bundles.push({ source: "Amazon", orderId, arrival: status, detailUrl: trackA ? trackA.href : "", statusLine: status, items });
    });
  });
  return bundles;
}

/* ================= dispatch ================= */
async function getBundles() {
  let bundles;
  if (SOURCE === "Flipkart") { await fkLoadAll(); bundles = fkScrape(); }
  else bundles = amzScrape();
  return { source: SOURCE, bundles };
}
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg && msg.type === "GET_BUNDLES") {
    getBundles().then((d) => sendResponse({ ok: true, ...d })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});
