SiteCrawler

SiteCrawler is a lightweight Chrome extension that passively crawls websites while you browse, building a structured sitemap of all endpoints it encounters.
It’s designed to support manual testing workflows - you can explore endpoints, filter, add notes, and mark endpoints as tested.

Features

- Captures requests made by the browser in real time

- Displays a collapsible tree view of paths grouped by host

- Filters by host, method, status code, text search, tested/untested, and static assets

- Shows hit counts and status code breakdowns for each endpoint

- Mark endpoints as tested (individually or in bulk)

- Add notes to endpoints for tracking test progress

- Export sitemap to CSV

- Import from CSV to restore a previous state (hits, tested flags, notes)

- Open the interface as either a popup or a separate window


Installation (Developer Mode)

1. Clone or download this repository.
     git clone https://github.com/X3NOSAURUS/SiteCrawler.git

2. Open Chrome and go to:
     chrome://extensions/

3. Enable Developer mode (toggle in the top-right).

4. Click Load unpacked and select the folder where this repo is located.

5. You should now see the SiteCrawler icon in your toolbar.


Usage

1. Click the extension icon to open the popup UI.

  - Toggle Capturing to start/stop recording requests.

  - Use filters to narrow down endpoints.

  - Expand/collapse folders in the sitemap tree.

  - Click an endpoint to view details, copy URL/path/cURL/regex, and add notes.

2. Use the Open ↗ button to open the full interface in a larger, resizable window.

3. Mark endpoints as tested:

  - Tick the box next to each endpoint, or

  - Use Mark visible ✓ to mark everything in the current view.

4. Export your progress:

  - Click CSV to export all endpoints with their notes and tested flags.

5. Import a previous CSV:

  - In the popup or panel, click Import CSV and choose a file previously exported from SiteCrawler.

  - This will restore hits, notes, and tested flags.

6. Reset clears all captured data.


Notes

SiteCrawler captures requests using Chrome’s webRequest API.

Request/response bodies are not captured (only metadata like method, path, status, type, etc).

CSV import will replace the current dataset.
