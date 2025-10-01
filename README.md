# SiteCrawler

SiteCrawler is a lightweight Chrome extension for building a live sitemap of endpoints while you browse. It captures network requests (paths, methods, status codes), groups them into a tree by path, and lets you mark endpoints as tested and add notes. It also detects forms/inputs on pages and helps you track field‐level testing (XSS/SQLi/etc).

> **Privacy note:** SiteCrawler stores data locally in the extension’s storage. It does **not** exfiltrate request/response bodies or any page content. MV3 APIs don’t allow reading bodies; only metadata (URL, method, status, resource type) is captured.

---

## Features

* **Live endpoint capture** via `chrome.webRequest`:

  * Tracks **method**, **path (templated)**, **query skeleton**, **status codes w/ counts**, **hits**, **last seen**.
  * Groups by **origin** and renders a **collapsible tree**.
  * **Hide static assets** option to filter images/fonts/CSS/JS/media noise.
* **Testing workflow**

  * Toggle “**Capturing**” ON/OFF from the popup.
  * Per-endpoint **Tested** checkbox (and **bulk mark visible**).
  * **Notes** per endpoint.
* **Form/field detection** (content script):

  * Flags pages with form inputs using an orange **FIELDS** pill.
  * When you’ve reviewed them, mark **Fields checked** to turn the pill green **FIELDS✓**.
  * Per-field test checklist for common web vulns: **XSS**, **SQLi**, **SSRF**, **File**, **Auth**.
* **Import/Export**

  * Export endpoints to **CSV** (includes notes, tested flag, fields state).
  * Import the CSV on another machine/session to **restore state**.
* **UI persistence**

  * Remembers your **selected origin** and **filters** between sessions.
* **Popup and Panel**

  * Use the standard popup (≤ 780×600).
  * Or open in a **separate window** (Panel) for more room; identical UI/behavior.

---

## Install (Unpacked)

1. Clone or download this repo.
2. Open **Chrome** → `chrome://extensions/`.
3. Toggle **Developer mode** (top-right).
4. Click **Load unpacked** and select the repository folder.
5. Confirm the extension appears as **SiteCrawler**.

If you change files:

* Click **Reload** on the extension’s card (or toggle it off/on).

---

## Usage

1. Click the **SiteCrawler** toolbar icon.
2. In the popup, toggle **Capturing** ON.
3. Browse your target site. Endpoints appear in the tree:

   * **Method badge** (GET/POST/PUT/PATCH/DELETE).
   * **Hits** and **status code pills** (2xx/3xx/4xx/5xx).
   * **FIELDS** pill (orange) if form inputs were detected.
     After you review and test fields, check **Fields checked** in Details → pill turns **green (FIELDS✓)**.
4. Click an endpoint to open **Details**:

   * **Hits / Status mix / Tested / Fields checked**
   * **Notes** textarea (persists)
   * **Form fields** (if any) with per-field test checkboxes (**XSS/SQLi/SSRF/File/Auth**)
   * **Copy** helpers: URL / Path / Regex / `curl`
5. Filters:

   * **Origin** selector (persistent)
   * **Search** (path/method text)
   * **Method** filter
   * **Status** filter
   * **Tested** filter (All/Untested/Tested)
   * **Hide static assets** (persistent)
6. **Bulk actions**:

   * **Mark visible ✓** → marks all currently filtered endpoints as Tested.
7. **Open ↗**:

   * Opens a **Panel** window with the same UI if you want a larger workspace.

> Tip: If you don’t see captures, verify Capturing is ON (green dot badge), and that the page is http(s) (Chrome blocks `chrome://` and `file://`).

---

## Form & Field Detection

SiteCrawler injects a **content script** (`content_script_forms.js`) on page load to collect:

* Each `<form>`:

  * Method, `enctype`, action path (templated), fields (`name`, `type`, `required`, `multiple`, `accept`)
* **Loose inputs** (outside forms)

This data is associated with the page’s **GET** endpoint record and shown in **Details**.
UI cues:

* **Orange FIELDS pill** → inputs detected, not yet checked.
* **Green FIELDS✓ pill** → you marked **Fields checked**.

Per-field testing:

* For each field, tick **XSS**, **SQLi**, **SSRF**, **File**, **Auth** as you test.
* Use **Mark all tests passed** to check all visible test boxes and set **Fields checked**.

All of this persists locally and round-trips via CSV.

---

## CSV: Export / Import

### Export

Click **CSV** in popup/panel to download `sitecrawler.csv`. Columns include:

* `origin`, `method`, `path`, `query`
* `hits`, `statusCounts` (e.g., `200x12|404x1`), `statuses` (e.g., `200|404`)
* `tested` (0/1), `note`
* `fieldsChecked` (0/1), `fieldTests` (JSON string)
* `lastSeen`

### Import

* **Popup**: click **Import CSV** → opens `import.html`.
* **Panel**: click **Import CSV** → choose a file inline.

Import **replaces** the current dataset and restores:

* endpoints, hits, status distribution
* `tested`, `note`
* `fieldsChecked`, `fieldTests`
* `formSummary` (if present in the CSV built by this version and later)

> If you experience “message port closed” errors during import, ensure the extension is reloaded and try again.

---

## Icons (Eyes ON/OFF)

The extension can indicate ON/OFF state via the toolbar icon:

* **Eyes OFF** when Capturing is disabled
* **Eyes ON (yellow)** when Capturing is enabled

The badge also shows a green dot when ON. If you swap icons dynamically, update that logic in the service worker.

---

## Files Overview

* `manifest.json` — MV3 manifest
* `service_worker.js` — background/service worker:

  * Captures requests (no bodies)
  * Holds all endpoint state
  * Handles messages: get/set state/data, notes, tested, forms, field tests, import
* `popup.html` / `popup.js` — main UI
* `panel.html` — same UI in a larger window
* `import.html` / `import.js` — CSV import flows (popup opens a tab; panel imports inline)
* `content_script_forms.js` — form & input detection (sends `reportForms`)
* `icon/` — extension icons

---

## Permissions

* `"permissions"`:

  * `webRequest` — required to capture request metadata
  * `storage` — persist state locally
  * `tabs`, `scripting` — open panel/import page, inject content script, etc.
* `"host_permissions"`:

  * `"<all_urls>"` — observe all sites you visit (you can scope this down)

---

## Limitations

* **No request/response bodies**: Chrome MV3 doesn’t allow reading bodies via `webRequest`. SiteCrawler focuses on URLs, methods, and status codes.
* Some protocols (e.g., `chrome://`, `file://`) and extension pages are not observable or allowed.
* Form detection runs in the page context and reports only safe metadata (no values).

---

## Troubleshooting

* “**Refused to execute inline script**”: MV3 CSP blocks inline scripts. Keep all JS in external files (`popup.js`, `panel.js`, etc.) and remove inline `<script>` tags.
* “**Cannot access a chrome:// URL**”: Open a regular `http(s)` tab. Chrome internal pages are blocked.
* Import fails: Reload the extension, reopen popup or panel, and retry.

---

## Development Tips

* Keep `popup.js` and the service worker message schema in sync.
* When adding fields to endpoint records (e.g., more test types), update:

  * **service_worker.js** (record shape, `dumpMap`/`reviveMap`, message handlers, CSV import),
  * **popup.js** (UI + export),
  * **import.js** (if parsing/validating CSV explicitly).

---

## License

MIT.
