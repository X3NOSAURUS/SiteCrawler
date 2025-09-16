# SiteCrawler

SiteCrawler is a Chrome extension that passively maps endpoints while you browse.  
It builds a structured tree of requests, similar to BurpSuite’s site map, and lets you filter, add notes, mark items tested, and export or import your progress.

## Features

- Captures requests in real time using the Chrome webRequest API
- Collapsible tree view grouped by host and path
- Filters by host, method, status code, text search, tested/untested, and static assets
- Displays hit counts and status breakdowns
- Mark endpoints as tested (individually or in bulk)
- Add notes to endpoints
- Export captured data to CSV
- Import from CSV to restore a previous session
- Option to open the UI as a popup or in a separate window

## Installation

1. Clone or download this repository.

   ```bash
   git clone https://github.com/X3NOSAURUS/SiteCrawler.git
   ```

2. Open Chrome and navigate to:

   ```
   chrome://extensions/
   ```

3. Enable **Developer mode** (toggle in the top-right).

4. Click **Load unpacked** and select the folder containing this repository.

5. The SiteCrawler icon will appear in your toolbar.  
   - Eyes dark = capturing off  
   - Eyes glowing = capturing on  

## Usage

1. Click the extension icon to open the popup.
2. Toggle **Capturing** to start or stop request logging.
3. Use filters to narrow results:
   - Host
   - Method
   - Status code
   - Tested/Untested
   - Hide static assets
   - Text search
4. Expand the tree to navigate endpoints.
5. Select an endpoint to:
   - View details
   - Copy URL, path, regex, or curl command
   - Mark as tested
   - Add notes
6. Use **Mark visible ✓** to bulk-mark all currently visible endpoints as tested.
7. Export to CSV with the **CSV** button.
8. Import a previously exported CSV with **Import CSV**.
9. Click **Reset** to clear all captured data.
10. Use **Open ↗** to launch the full panel view in a separate window.

## Limitations

- Only metadata is captured (method, path, status, type).  
- Request/response bodies are not stored.  
- Import replaces the current dataset.
