(function(){
  const fileEl = document.getElementById("fileEl");
  const importBtn = document.getElementById("importBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const msgEl = document.getElementById("msg");

  cancelBtn.addEventListener("click", () => window.close());

  importBtn.addEventListener("click", async ()=>{
    const file = fileEl.files && fileEl.files[0];
    if (!file) { setMsg("Please choose a CSV file first."); return; }
    try {
      setMsg("Reading CSV…");
      const text = await file.text();
      const rows = parseCsvToRows(text);
      if (!rows.length) { setMsg("No rows found in CSV."); return; }
      const entries = normalizeRowsForImport(rows);

      setMsg(`Importing ${entries.length} records…`);
      chrome.runtime.sendMessage({ type:"importCsv", entries }, (resp)=>{
        if (chrome.runtime.lastError) {
          setMsg("Import failed: " + chrome.runtime.lastError.message);
          return;
        }
        setMsg("Import complete. You can close this tab and reopen the popup.");
      });
    } catch (e) {
      console.error(e);
      setMsg("Import failed. Check the CSV format.");
    }
  });

  function setMsg(s){ msgEl.textContent = s; }

  // --- CSV parse helpers (same logic as in popup.js) ---
  function parseCsvToRows(csv){
    const lines = csv.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");
    while (lines.length && !lines[lines.length-1].trim()) lines.pop();
    if (!lines.length) return [];
    const header = splitCsvLine(lines[0]);
    const out = [];
    for (let i=1;i<lines.length;i++){
      if (!lines[i].trim()) continue;
      const cols = splitCsvLine(lines[i]);
      const row = {};
      header.forEach((h,idx)=> row[h] = cols[idx] ?? "");
      out.push(row);
    }
    return out;
  }
  function splitCsvLine(line){
    const res = [];
    let cur = "", inQ = false;
    for (let i=0;i<line.length;i++){
      const ch = line[i];
      if (inQ){
        if (ch === '"'){
          if (line[i+1] === '"'){ cur += '"'; i++; }
          else { inQ = false; }
        } else cur += ch;
      } else {
        if (ch === ','){ res.push(cur); cur=""; }
        else if (ch === '"'){ inQ = true; }
        else cur += ch;
      }
    }
    res.push(cur);
    return res;
  }
  function normalizeRowsForImport(rows){
    return rows.map(r=>{
      const statusCounts = {};
      if (r.statusCounts){
        r.statusCounts.split("|").forEach(pair=>{
          const m = pair.match(/^(\d{1,3})x(\d+)$/);
          if (m) statusCounts[m[1]] = parseInt(m[2],10);
        });
      }
      const statuses = (r.statuses||"").split("|")
        .map(s=>parseInt(s,10))
        .filter(n=>Number.isFinite(n));

      const tested = String(r.tested).trim()==="1" || /^true$/i.test(String(r.tested));
      const lastSeen = Date.parse(r.lastSeen) || Date.now();
      const hits = parseInt(r.hits,10);

      return {
        origin: r.origin || "",
        method: (r.method||"GET").toUpperCase(),
        pathTemplate: r.path || "/",
        querySkeleton: r.query || "",
        statusCounts,
        statuses,
        hits: Number.isFinite(hits) ? hits : 0,
        firstSeen: lastSeen,
        lastSeen,
        tested,
        note: r.note || ""
      };
    }).filter(e=>e.origin && e.method && e.pathTemplate!=null);
  }
})();
