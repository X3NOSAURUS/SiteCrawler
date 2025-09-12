document.addEventListener("DOMContentLoaded", () => {
  const toggleEl = document.getElementById("toggleEl");
  const hostEl = document.getElementById("hostEl");
  const searchEl = document.getElementById("searchEl");
  const methodEl = document.getElementById("methodEl");
  const statusCodeEl = document.getElementById("statusCodeEl");
  const testedFilterEl = document.getElementById("testedFilterEl");
  const exportEl = document.getElementById("exportEl");
  const resetEl = document.getElementById("resetEl");
  const markVisibleTestedEl = document.getElementById("markVisibleTestedEl");
  const treeEl = document.getElementById("treeEl");
  const detailEl = document.getElementById("detailEl");
  const hideAssetsEl = document.getElementById("hideAssetsEl");
  const openWindowEl = document.getElementById("openWindowEl");

  const expandedMap = new Map(); // "<origin> /a/b" -> expanded? (default true)
  let pollTimer = null;
  let snapshot = {};       // { origin: [records] }
  let selectedKey = null;  // `${origin}|||${method} ${path}${qs}`
  let savedHostElValue = "";

  exportEl.onclick = exportCSV;
  resetEl.onclick = () => chrome.runtime.sendMessage({ type:"resetData" });
  markVisibleTestedEl.onclick = markVisibleVisible;

  init();

  function init(){
    // Load saved host selection first
    chrome.storage.local.get(["sc_ui_host"], ({ sc_ui_host }) => {
    savedHostElValue = sc_ui_host || "";

    // Then load extension state and start polling
    chrome.runtime.sendMessage({ type:"getState" }, (resp)=>{
      toggleEl.checked = !!resp?.enabled;
      startPolling();
    });
  });

  toggleEl.addEventListener("change", ()=>{
    chrome.runtime.sendMessage({ type:"setEnabled", enabled: toggleEl.checked });
  });

  [hostEl, searchEl, methodEl, statusCodeEl, testedFilterEl].forEach(el =>
    el.addEventListener("input", renderTree)
  );

  // Persist host selection on change
  hostEl.addEventListener("input", () => {
    chrome.storage.local.set({ sc_ui_host: hostEl.value });
  });

  openWindowEl.onclick = () => {
  chrome.windows.create({
    url: chrome.runtime.getURL("panel.html"), // new standalone page
    type: "popup",
    width: 1280,
    height: 820
    });
  };

}


  function startPolling(){
    clearInterval(pollTimer);
    pollTimer = setInterval(()=>{
      chrome.runtime.sendMessage({ type:"getData" }, (resp)=>{
        snapshot = resp?.data || {};
        hydrateHostDropdown();
        hydrateStatusDropdown();
        renderTree();
        // only re-render details if we don't already have focus
        if (selectedKey && !document.activeElement.matches("#detailNoteEl, #detailNoteEl *")) {
          renderDetailsByKey(selectedKey);
        }
      });
    }, 1000);
  }

  function hydrateHostDropdown(){
    const hosts = Object.keys(snapshot).sort();
    // Prefer current selection, else the saved one (only if still present)
    const prev = hostEl.value || savedHostElValue;
    hostEl.innerHTML = `<option value="">All hosts (${hosts.length})</option>` +
    hosts.map(h=>`<option>${h}</option>`).join("");

    if (hosts.includes(prev)) {
      hostEl.value = prev;
    } else if (savedHostElValue && !hosts.includes(savedHostElValue)) {
      // Saved host vanished (e.g., not visited this session) → reset
      hostEl.value = "";
      }
  }    

  function hydrateStatusDropdown() {
    const hostFilter = hostEl.value;
    const set = new Set();
    for (const [origin, recs] of Object.entries(snapshot)) {
      if (hostFilter && origin !== hostFilter) continue;
      for (const r of recs) {
        if (!r.statusCounts) continue;
        for (const code of Object.keys(r.statusCounts)) set.add(code);
      }
    }
    const sorted = [...set].map(Number).sort((a,b)=>a-b).map(String);
    const prev = statusCodeEl.value;
    statusCodeEl.innerHTML = `<option value="">Any Status</option>` +
      sorted.map(c => `<option>${c}</option>`).join("");
    if (sorted.includes(prev)) statusCodeEl.value = prev;
  }

  function renderTree(){
    const hostFilter = hostEl.value;
    const q = (searchEl.value||"").toLowerCase();
    const methodFilter = (methodEl.value||"").toUpperCase();
    const codeFilter = statusCodeEl.value;
    const testedFilter = testedFilterEl.value; // "", "untested", "tested"
    const hideAssets = !!(hideAssetsEl && hideAssetsEl.checked); // NEW

    const container = document.createElement("div");

    for (const origin of Object.keys(snapshot).sort()){
      if (hostFilter && origin !== hostFilter) continue;
      const recs = (snapshot[origin] || []).filter(r=>{
        const pathFull = r.pathTemplate + (r.querySkeleton||"");
        if (q && !(`${origin} ${r.method} ${pathFull}`.toLowerCase().includes(q))) return false;
        if (methodFilter && r.method !== methodFilter) return false;
        if (codeFilter) {
          const c = (r.statusCounts && r.statusCounts[codeFilter]) || 0;
          if (!c) return false;
        }
        if (testedFilter==="tested" && !r.tested) return false;
        if (testedFilter==="untested" && r.tested) return false;
        if (hideAssets && isStaticAsset(r)) return false; // NEW
        return true;
      });
      if (!recs.length) continue;

      const hostHdr = document.createElement("div");
      hostHdr.className = "host";
      hostHdr.textContent = origin;
      container.appendChild(hostHdr);

      // Build a path tree from filtered records
      const root = { children:new Map(), leaves:[] };
      for (const r of recs){
        const full = r.pathTemplate.replace(/^\//,"");
        const segs = full ? full.split("/") : [];
        let node = root;
        for (const s of segs){
          if (!node.children.has(s)) node.children.set(s, { children:new Map(), leaves:[] });
          node = node.children.get(s);
        }
        node.leaves.push(r);
      }

      const ul = document.createElement("ul");
      ul.className = "tree";
      container.appendChild(ul);

      const renderNode = (node, parentEl, prefix=[]) => {
        // Folders
        for (const [name, child] of [...node.children.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
          const li = document.createElement("li");
          const pathKey = `${origin} /${prefix.concat(name).join("/")}`;
          const open = expandedMap.get(pathKey) !== false;

          const row = document.createElement("div");
          row.className = "node";
          row.innerHTML = `
            <span style="display:inline-block; width:1em; text-align:center; margin-right:4px;">${open ? "▾" : "▸"}</span>
            <span class="seg">/${escapeHtml(name)}</span>
          `;
          row.onclick = () => { expandedMap.set(pathKey, !open); renderTree(); };

          li.appendChild(row);

          const childUl = document.createElement("ul");
          childUl.className = "tree";
          childUl.style.display = open ? "block" : "none";
          li.appendChild(childUl);
          parentEl.appendChild(li);

          if (open) renderNode(child, childUl, prefix.concat(name));
        }

        // Leaves (endpoints)
        for (const r of node.leaves.sort((a,b)=>a.method.localeCompare(b.method))){
          const leaf = document.createElement("li");
          const line = document.createElement("div");
          line.className = "node";
          const pathFull = "/" + prefix.join("/") + (r.querySkeleton||"");
          const recKey = `${r.method} ${r.pathTemplate}${r.querySkeleton||""}`;
          const key = `${origin}|||${recKey}`;
          line.dataset.key = key;
          line.innerHTML = `
            <input type="checkbox" class="chk-tested" ${r.tested ? "checked" : ""} title="Mark tested" style="vertical-align:middle; margin-right:6px;" />
            <span class="method ${r.method}">${r.method}</span>
            <span>${escapeHtml(pathFull || "/")}</span>
            <span class="muted" style="margin-left:6px;">(${r.hits} hits)</span>
            ${renderStatusPills(r)}
          `;
          if (selectedKey === key) line.classList.add("active");

          line.onclick = (ev) => {
            if (!(ev.target && ev.target.classList.contains("chk-tested"))) {
              selectedKey = key;
              renderDetails(r, origin);
            }
          };

          leaf.appendChild(line);
          parentEl.appendChild(leaf);

          // checkbox handler
          const chk = line.querySelector(".chk-tested");
          chk.addEventListener("click", (ev)=>{
            ev.stopPropagation();
            chrome.runtime.sendMessage({ type:"setTested", origin, recKey, tested: chk.checked });
            r.tested = chk.checked; // optimistic
          });
        }
      };

      renderNode(root, ul);
    }

    treeEl.replaceChildren(container);
  }

  // -------- NEW: static asset detection ----------
  function isStaticAsset(r){
    // By path extension
    const p = (r.pathTemplate || "").toLowerCase();
    const exts = [
      ".png",".jpg",".jpeg",".gif",".webp",".svg",".ico",".bmp",".avif",
      ".css",".js",".mjs",".map",
      ".woff",".woff2",".ttf",".otf",".eot",
      ".mp3",".wav",".ogg",".mp4",".webm",".mov",".avi",
      ".pdf",".txt",".xml",".json.map"
    ];
    if (exts.some(ext => p.endsWith(ext))) return true;

    // By request types collected via webRequest
    // Treat these as static/noisy:
    const ASSET_TYPES = new Set(["image","stylesheet","font","script","media","other"]);
    // NOTE: we exclude "xmlhttprequest" (XHR/fetch) from assets.
    const types = new Set(r.types || []);
    if (types.size && [...types].every(t => ASSET_TYPES.has(t))) return true;

    // Heuristic: GET + no query params + typical asset folder
    if (r.method === "GET" && !r.querySkeleton) {
      if (/(?:^|\/)(?:assets?|static|images?|img|fonts?|icons?|media|scripts?|styles?)(?:\/|$)/.test(p)) {
        return true;
      }
    }

    return false;
  }
  // -----------------------------------------------

  function renderStatusPills(r) {
    if (!r.statusCounts) return "";
    return " " + Object.entries(r.statusCounts)
      .sort(([a],[b]) => parseInt(a)-parseInt(b))
      .map(([code,count])=>{
        const cls = code[0]==="2"?"ok":code[0]==="3"?"redir":code[0]==="4"?"warn":"err";
        return `<span class="pill ${cls}">${code} ×${count}</span>`;
      }).join(" ");
  }

  function renderDetails(rec, origin){
    const url = origin + rec.pathTemplate + (rec.querySkeleton||"");
    const recKey = `${rec.method} ${rec.pathTemplate}${rec.querySkeleton||""}`;

    // Build status-counts pretty block
    const statusLines = rec.statusCounts
      ? Object.entries(rec.statusCounts)
          .sort(([a],[b]) => parseInt(a)-parseInt(b))
          .map(([c,n]) => `${c} ×${n}`)
          .join(", ")
      : "";

    detailEl.innerHTML = `
      <div>
        <h3 style="margin-top:0">${escapeHtml(rec.method)} ${escapeHtml(url)}</h3>

        <div class="kv" style="display:grid; grid-template-columns: 120px 1fr; gap:6px; margin-bottom:8px;">
          <div>Hits</div><div>${rec.hits}</div>
          <div>Status mix</div><div>${escapeHtml(statusLines || "—")}</div>
          <div>Tested</div>
          <div><input id="detailTestedEl" type="checkbox" ${rec.tested ? "checked" : ""}></div>
          <div>Note</div>
          <div><textarea id="detailNoteEl" rows="3" style="width:100%;"></textarea></div>
        </div>

        <div class="row-actions" style="display:flex; gap:6px; flex-wrap:wrap;">
          <button data-copy="${escapeAttr(url)}">Copy URL</button>
          <button data-copy="${escapeAttr(rec.pathTemplate + (rec.querySkeleton||""))}">Copy Path</button>
          <button data-copy="${escapeAttr(pathToRegex(rec.pathTemplate))}">Copy Regex</button>
          <button data-copy="${escapeAttr(`curl -i -X ${rec.method} '${url}'`)}">Copy curl</button>
        </div>
      </div>
    `;

    // wire copy buttons
    detailEl.querySelectorAll("[data-copy]").forEach(b=>{
      b.addEventListener("click", ()=> navigator.clipboard.writeText(b.dataset.copy));
    });

    // wire tested + note
    const noteEl = detailEl.querySelector("#detailNoteEl");
    const testedBox = detailEl.querySelector("#detailTestedEl");
    if (noteEl) {
      noteEl.value = rec.note || "";
      noteEl.addEventListener("change", ()=>{
        chrome.runtime.sendMessage({ type:"setNote", origin, recKey, note: noteEl.value || "" });
        rec.note = noteEl.value || "";
      });
    }
    if (testedBox) {
      testedBox.addEventListener("change", ()=>{
        chrome.runtime.sendMessage({ type:"setTested", origin, recKey, tested: testedBox.checked });
        rec.tested = testedBox.checked;
        renderTree(); // reflect in tree checkbox
      });
    }
  }

  function renderDetailsByKey(key){
    const [origin, rest] = key.split("|||");
    const rec = (snapshot[origin]||[]).find(r => (r.method+" "+r.pathTemplate+(r.querySkeleton||"")) === rest);
    if (rec) renderDetails(rec, origin);
  }

  // --- Bulk mark visible ---
  function collectVisibleKeys(){
    const hostFilter = hostEl.value;
    const q = (searchEl.value||"").toLowerCase();
    const methodFilter = (methodEl.value||"").toUpperCase();
    const codeFilter = statusCodeEl.value;
    const testedFilter = testedFilterEl.value;
    const hideAssets = !!(hideAssetsEl && hideAssetsEl.checked);

    const items = [];
    for (const [origin, recs] of Object.entries(snapshot)){
      if (hostFilter && origin !== hostFilter) continue;
      for (const r of recs){
        const pathFull = r.pathTemplate + (r.querySkeleton||"");
        if (q && !(`${origin} ${r.method} ${pathFull}`.toLowerCase().includes(q))) continue;
        if (methodFilter && r.method !== methodFilter) continue;
        if (codeFilter){
          const c = (r.statusCounts && r.statusCounts[codeFilter]) || 0;
          if (!c) continue;
        }
        if (testedFilter==="tested" && !r.tested) continue;
        if (testedFilter==="untested" && r.tested) continue;
        if (hideAssets && isStaticAsset(r)) continue;

        const recKey = `${r.method} ${r.pathTemplate}${r.querySkeleton||""}`;
        items.push({ origin, recKey });
      }
    }
    return items;
  }

  function markVisibleVisible(){
    const items = collectVisibleKeys();
    if (!items.length) return;
    chrome.runtime.sendMessage({ type:"setManyTested", items, tested: true }, ()=>{
      // Optimistic update in local snapshot
      for (const {origin, recKey} of items){
        const arr = snapshot[origin] || [];
        const rec = arr.find(r => (r.method+" "+r.pathTemplate+(r.querySkeleton||"")) === recKey);
        if (rec) rec.tested = true;
      }
      renderTree();
      if (selectedKey) renderDetailsByKey(selectedKey);
    });
  }

  // --- Export CSV ---
  function exportCSV(){
    const rows = [];
    for (const [origin, recs] of Object.entries(snapshot)){
      for (const r of recs){
        const statusCounts = r.statusCounts
          ? Object.entries(r.statusCounts).sort(([a],[b])=>parseInt(a)-parseInt(b)).map(([c,n])=>`${c}x${n}`).join("|")
          : "";
        rows.push({
          origin,
          method: r.method,
          path: r.pathTemplate,
          query: r.querySkeleton,
          hits: r.hits,
          statusCounts,
          statuses: (r.statuses||[]).join("|"),
          tested: r.tested ? 1 : 0,
          note: r.note || "",
          lastSeen: new Date(r.lastSeen).toISOString()
        });
      }
    }
    const header = Object.keys(rows[0]||{
      origin:"",method:"",path:"",query:"",hits:0,statusCounts:"",statuses:"",tested:0,note:"",lastSeen:""
    });
    const csv = [header.join(",")]
      .concat(rows.map(r=>header.map(h=>csvEscape(r[h])).join(",")))
      .join("\n");
    download("sitecrawler.csv", new Blob([csv], {type:"text/csv"}));
  }

  // --- helpers ---
  function pathToRegex(pathTmpl){
    const esc = pathTmpl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return "^" + esc.replace(/:id/g,"[^/]+") + "$";
  }
  function escapeHtml(s){ return (s==null?"":String(s)).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;","&gt;":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
  function escapeAttr(s){ return (s==null?"":String(s)).replace(/"/g,"&quot;"); }
  function csvEscape(v){
    const s = (v==null?"":String(v));
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }
  function download(name, blob){
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
});
