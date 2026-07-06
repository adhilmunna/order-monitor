# (Amazon + Flipkart) Order Monitor — Chrome Extension

**All your active Amazon.in and Flipkart orders, live, in one popup.**

Order Monitor is a Manifest V3 browser extension for Chrome and Edge that pulls the live status of every active order across Amazon.in and Flipkart into a single popup — grouped by shipment bundle, with each bundle's real delivery progress read straight from the platform's own detailed tracking. No more bouncing between two "My Orders" pages to find out what's arriving when.

Current version: **v2.2.0**

---

## Features

- **Unified Amazon + Flipkart view** — both marketplaces side by side in one popup, no context switching.
- **Per-bundle grouping** — orders are grouped by shipment bundle, with every item in the bundle listed so you know exactly what's in each parcel.
- **3-stage progress bar** — an at-a-glance status for every bundle: **Yet to be shipped → Shipped → Out for delivery**.
- **Accurate, granular status** — pulled from each platform's *detailed* tracking view, not the coarse label on the order list: Amazon's **"See all updates"** modal and Flipkart's **"See All Updates"** timeline.
- **Local caching** — results are cached in the browser; the popup opens instantly and only re-fetches when you hit **Refresh**.
- **Sorted by soonest arrival** — bundles arriving first float to the top.
- **Source filter tabs** — filter the list to show All, Amazon only, or Flipkart only.

---

## How it works

The extension reads the pages you're already logged into and normalizes them into bundle cards.

- **Amazon** — the order-history page is server-rendered, so the content script scrapes the DOM directly for your active orders.
- **Flipkart** — the order list is lazy-loaded, so the content script auto-scrolls the page first and then scrapes the rendered DOM.
- **Per-bundle tracking** — to get the *granular* status for a bundle, the popup opens that bundle's tracking page in a background tab, reads the detailed timeline (Amazon "See all updates" / Flipkart "See All Updates"), maps it to the 3-stage progress, and closes the tab.

> **Why DOM scraping for Flipkart?** Flipkart exposes a JSON order API, but it returns **403** without signed request headers that the page generates internally. Scraping the rendered DOM is therefore intentional — it's the reliable path that doesn't depend on reverse-engineering signed headers.

---

## Install (unpacked)

1. Open your browser's extensions page:
   - Edge: `edge://extensions`
   - Chrome: `chrome://extensions`
2. Enable **Developer mode** (toggle, usually top-right / bottom-left).
3. Click **Load unpacked** and select this project folder.
4. Click the Order Monitor toolbar icon, then hit **Refresh** to do the first fetch.

Make sure you're logged into Amazon.in and Flipkart in the same browser — the extension only reads pages you already have access to.

---

## Permissions rationale

| Permission | Why it's needed |
|---|---|
| `tabs` | Open each bundle's tracking page in a background tab to read detailed status, then close it. |
| `scripting` | Inject the scraping logic into the order-history and tracking pages. |
| `storage` | Cache fetched order data locally so the popup opens instantly between refreshes. |
| `host_permissions` for `amazon.in` and `flipkart.com` | Read your order and tracking pages on exactly these two sites — nothing else. |

---

## Privacy

Everything runs **locally in your browser**. No data ever leaves your machine — there is no server, no account, and no analytics. The extension only reads pages you're already logged into and stores the results in your browser's local storage for caching. Nothing is transmitted anywhere.

---

## Limitations

- Reads the **current order-history page only** — no pagination yet, so very old orders below the first page aren't included.
- **Amazon per-item prices aren't shown** — Amazon doesn't expose them on the order list page.
- The first refresh takes a few seconds because bundles are fetched **sequentially** (one background tab at a time).

---

## Roadmap

- **Speedups** — parallelize the per-bundle tracking fetches and smarter caching to cut first-refresh time.
- **Pagination** — walk past the first order-history page to capture older active orders.
- **Toolbar badge** — show a live count of active orders (or out-for-delivery bundles) on the extension icon.
- **More marketplaces** — extend the same unified view to additional retailers.

---

## License

Released under the [MIT License](LICENSE).
