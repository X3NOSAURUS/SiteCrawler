document.addEventListener("DOMContentLoaded", () => {
  const toggleEl = document.getElementById("toggleEl");
  const hostEl = document.getElementById("hostEl");
  const searchEl = document.getElementById("searchEl");
  const methodEl = document.getElementById("methodEl");
  const statusCodeEl = document.getElementById("statusCodeEl");
  const testedFilterEl = document.getElementById("testedFilterEl");
  const hideAssetsEl = document.getElementById("hideAssetsEl");
  const exportEl = document.getElementById("exportEl");
  const resetEl = document.getElementById("resetEl");
  const markVisibleTestedEl = document.getElementById("markVisibleTestedEl");
  const importBtnEl = document.getElementById("importBtnEl");
  const importEl = document.getElementById("importEl"); // only present in panel
  const treeEl = document.getElementById("treeEl");
  const detailEl = document.getElementById("detailEl");
  const openWindowEl = document.getElementById("openWindowEl");

  if (openWindowEl) {
    openWindowEl.addEventListener("click", () => {
      try {
        chrome.windows.create(
          { url: chrome.runtime.getURL("panel.html"), type: "popup", width: 1280, height: 820 },
          () => { if (chrome.runtime.lastError) console.warn("Open panel failed:", chrome.runtime.lastError.message); }
        );
      } catch (e) { console.warn("Open panel threw:", e); }
    });
  }

  const expandedMap = new Map();
  let pollTimer = null;
  let snapshot = {};
  let selectedKey = null;
  let savedHostElValue = "";
  let savedFilters = { search:"", method:"", statusCode:"", tested:"", hideAssets:false };

  exportEl.onclick = exportCSV;
  resetEl.onclick = () => {
    chrome.runtime.sendMessage({ type:"resetData" }, () => {
      snapshot = {};
      selectedKey = null;
      treeEl.replaceChildren();
      detailEl.replaceChildren();
    });
  };
  markVisibleTestedEl.onclick = markVisibleVisible;

  if (importBtnEl) {
    if (importEl) {
      importBtnEl.onclick = () => importEl.click();
      importEl.onchange = handleImportInline;
    } else {
      importBtnEl.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("import.html") });
    }
  }

  init();

  function init(){
    chrome.storage.local.get(["sc_ui_host","sc_ui_filters"], ({ sc_ui_host, sc_ui_filters }) => {
      savedHostElValue = sc_ui_host || "";
      if (sc_ui_filters && typeof sc_ui_filters === "object") {
        savedFilters = {
          search:     sc_ui_filters.search ?? "",
          method:     sc_ui_filters.method ?? "",
          statusCode: sc_ui_filters.statusCode ?? "",
          tested:     sc_ui_filters.tested ?? "",
          hideAssets: !!sc_ui_filters.hideAssets
        };
      }
      if (searchEl)       searchEl.value = savedFilters.search;
      if (methodEl)       methodEl.value = savedFilters.method;
      if (testedFilterEl) testedFilterEl.value = savedFilters.tested;
      if (hideAssetsEl)   hideAssetsEl.checked = !!savedFilters.hideAssets;

      saveFilters();

      chrome.runtime.sendMessage({ type:"getState" }, (resp)=>{
        toggleEl.checked = !!resp?.enabled;
        startPolling();
      });
    });

    toggleEl.addEventListener("change", ()=>{
      chrome.runtime.sendMessage({ type:"setEnabled", enabled: toggleEl.checked });
    });

    [searchEl, methodEl, statusCodeEl, testedFilterEl].forEach(el => {
      if (!el) return;
      el.addEventListener("input", () => { saveFilters(); renderTree(); });
    });
    if (hideAssetsEl) hideAssetsEl.addEventListener("input", () => { saveFilters(); renderTree(); });

    hostEl.addEventListener("input", () => {
      chrome.storage.local.set({ sc_ui_host: hostEl.value });
      savedHostElValue = hostEl.value;
      renderTree();
    });
  }

  function saveFilters(){
    const toSave = {
      search:     (searchEl && searchEl.value) || "",
      method:     (methodEl && methodEl.value) || "",
      statusCode: (statusCodeEl && statusCodeEl.value) || "",
      tested:     (testedFilterEl && testedFilterEl.value) || "",
      hideAssets: !!(hideAssetsEl && hideAssetsEl.checked)
    };
    chrome.storage.local.set({ sc_ui_filters: toSave });
  }

  function startPolling(){
    clearInterval(pollTimer);
    pollTimer = setInterval(()=>{
      chrome.runtime.sendMessage({ type:"getData" }, (resp)=>{
        snapshot = resp?.data || {};
        hydrateHostDropdown();
        hydrateStatusDropdown();
        renderTree();
        if (selectedKey && !document.activeElement.matches("#detailNoteEl, #detailNoteEl *")) {
          renderDetailsByKey(selectedKey);
        }
      });
    }, 1000);
  }

  function hydrateHostDropdown(){
    const hosts = Object.keys(snapshot).sort();
    const preferred = hostEl.value || savedHostElValue;

    hostEl.innerHTML = `<option value="">All hosts (${hosts.length})</option>` +
      hosts.map(h=>`<option>${h}</option>`).join("");

    if (preferred && hosts.includes(preferred)) {
      hostEl.value = preferred;
      savedHostElValue = preferred;
    } else {
      if (!hostEl.value) hostEl.value = "";
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
    const prev = statusCodeEl.value || savedFilters.statusCode;
    statusCodeEl.innerHTML = `<option value="">Any Status</option>` +
      sorted.map(c => `<option>${c}</option>`).join("");
    if (prev && sorted.includes(prev)) { statusCodeEl.value = prev; }
    else if (prev && !sorted.includes(prev)) { statusCodeEl.value = ""; }
  }

  function safeHasForms(rec){
    const fs = rec && rec.formSummary;
    const hasFormsArr = fs && Array.isArray(fs.forms) && fs.forms.length > 0;
    const hasLooseArr = fs && Array.isArray(fs.looseFields) && fs.looseFields.length > 0;
    return !!(hasFormsArr || hasLooseArr);
  }

  function renderTree(){
    const hostFilter = hostEl.value;
    const q = (searchEl.value||"").toLowerCase();
    const methodFilter = (methodEl.value||"").toUpperCase();
    const codeFilter = statusCodeEl.value;
    const testedFilter = testedFilterEl.value;
    const hideAssets = !!(hideAssetsEl && hideAssetsEl.checked);

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
        if (hideAssets && isStaticAsset(r)) return false;
        return true;
      });
      if (!recs.length) continue;

      const hostHdr = document.createElement("div");
      hostHdr.className = "host";
      hostHdr.textContent = origin;
      container.appendChild(hostHdr);

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

          // Pill: FIELDS (orange) if forms exist and not checked; FIELDS✓ (green) if checked; none if no forms
          const hasForms = safeHasForms(r);
          const isFieldsChecked = !!r.fieldsChecked;
          const formsIndicator = hasForms
            ? (isFieldsChecked
                ? `<span class="pill ok" title="Fields checked">FIELDS✓</span>`
                : `<span class="pill warn" title="Form fields detected — review fields">FIELDS</span>`)
            : "";

          line.innerHTML = `
            <input type="checkbox" class="chk-tested" ${r.tested ? "checked" : ""} title="Mark tested" style="vertical-align:middle; margin-right:6px;" />
            <span class="method ${r.method}">${r.method}</span>
            <span>${escapeHtml(pathFull || "/")}</span>
            <span class="muted" style="margin-left:6px;">(${r.hits} hits)</span>
            ${formsIndicator}
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

  function isStaticAsset(r){
    const p = (r.pathTemplate || "").toLowerCase();
    const exts = [
      ".png",".jpg",".jpeg",".gif",".webp",".svg",".ico",".bmp",".avif",
      ".css",".js",".mjs",".map",
      ".woff",".woff2",".ttf",".otf",".eot",
      ".mp3",".wav",".ogg",".mp4",".webm",".mov",".avi",
      ".pdf",".txt",".xml",".json.map"
    ];
    if (exts.some(ext => p.endsWith(ext))) return true;

    const ASSET_TYPES = new Set(["image","stylesheet","font","script","media","other"]);
    const types = new Set(r.types || []);
    if (types.size && [...types].every(t => ASSET_TYPES.has(t))) return true;

    if (r.method === "GET" && !r.querySkeleton) {
      if (/(?:^|\/)(?:assets?|static|images?|img|fonts?|icons?|media|scripts?|styles?)(?:\/|$)/.test(p)) {
        return true;
      }
    }
    return false;
  }

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

  const statusLines = rec.statusCounts
    ? Object.entries(rec.statusCounts)
        .sort(([a],[b]) => parseInt(a)-parseInt(b))
        .map(([c,n]) => `${c} ×${n}`)
        .join(", ")
    : "";

  const TESTS = ["xss","sqli","ssrf","file","auth"]; // test set
  const formSummary = rec.formSummary || { forms: [], looseFields: [] };

  const renderFieldRow = (field, formIndex) => {
    const fieldName = field.name || "(unnamed)";
    const fieldKey  = `${formIndex}|${fieldName}`; // unique within record
    const current   = (rec.fieldTests && rec.fieldTests[fieldKey]) || {};
    const testBoxes = TESTS.map(t => {
      const checked = !!current[t];
      return `
        <label style="margin-right:8px;">
          <input type="checkbox"
                 class="field-test"
                 data-field-key="${escapeAttr(fieldKey)}"
                 data-test="${t}"
                 ${checked ? "checked" : ""} />
          ${t.toUpperCase()}
        </label>`;
    }).join("");

    return `
      <div style="padding:8px; border:1px solid var(--border); border-radius:8px; margin-bottom:6px;">
        <div style="font-weight:600; margin-bottom:4px;">
          ${escapeHtml(fieldName)} <span class="muted">(${escapeHtml(field.type||"input")}${field.required?" • required":""})</span>
        </div>
        <div>${testBoxes}</div>
      </div>`;
  };

  const formsHtml = (formSummary.forms||[]).map((f, idx) => {
    const fieldsHtml = (f.fields||[]).map(field => renderFieldRow(field, `form:${idx}`)).join("");
    return `
      <div style="margin:10px 0; padding:10px; border:1px solid var(--border); border-radius:10px;">
        <div class="muted" style="margin-bottom:6px;">
          FORM • ${escapeHtml((f.method||"GET").toUpperCase())} → ${escapeHtml(f.actionPathTemplate||"/")} ${f.enctype?`• ${escapeHtml(f.enctype)}`:""}
        </div>
        ${fieldsHtml || `<div class="muted">No fields detected in this form.</div>`}
      </div>`;
  }).join("");

  const looseHtml = (formSummary.looseFields||[]).length
    ? `
      <div style="margin:10px 0; padding:10px; border:1px solid var(--border); border-radius:10px;">
        <div class="muted" style="margin-bottom:6px;">LOOSE FIELDS (outside forms)</div>
        ${(formSummary.looseFields||[]).map(field => renderFieldRow(field, "loose")).join("")}
      </div>`
    : "";

  const hasAnyFields = ((formSummary.forms||[]).some(f => (f.fields||[]).length) || (formSummary.looseFields||[]).length);

  detailEl.innerHTML = `
    <div>
      <h3 style="margin-top:0">${escapeHtml(rec.method)} ${escapeHtml(url)}</h3>

      <div class="kv" style="display:grid; grid-template-columns: 120px 1fr; gap:6px; margin-bottom:8px;">
        <div>Hits</div><div>${rec.hits}</div>
        <div>Status mix</div><div>${escapeHtml(statusLines || "—")}</div>

        <div>Tested</div>
        <div><input id="detailTestedEl" type="checkbox" ${rec.tested ? "checked" : ""}></div>

        <div>Fields checked</div>
        <div>
          <input id="detailFieldsCheckedEl" type="checkbox" ${rec.fieldsChecked ? "checked" : ""} />
          <span class="muted" id="detailFieldsNoteEl" style="margin-left:6px;"></span>
        </div>

        <div>Note</div>
        <div><textarea id="detailNoteEl" rows="3" style="width:100%;"></textarea></div>
      </div>

      ${hasAnyFields ? `
        <div style="margin:10px 0 6px; font-weight:600;">Field tests</div>
        ${formsHtml}
        ${looseHtml}
        <div class="row-actions" style="display:flex; gap:6px; flex-wrap:wrap;">
          <button id="btnMarkAllTests" type="button">Mark all tests passed</button>
        </div>
      ` : `<div class="muted">No form fields detected on this endpoint.</div>`}

      <div class="row-actions" style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;">
        <button data-copy="${escapeAttr(url)}">Copy URL</button>
        <button data-copy="${escapeAttr(rec.pathTemplate + (rec.querySkeleton||""))}">Copy Path</button>
        <button data-copy="${escapeAttr(pathToRegex(rec.pathTemplate))}">Copy Regex</button>
        <button data-copy="${escapeAttr(`curl -i -X ${rec.method} '${url}'`)}">Copy curl</button>
      </div>
    </div>
  `;

  // Copy handlers
  detailEl.querySelectorAll("[data-copy]").forEach(b=>{
    b.addEventListener("click", ()=> navigator.clipboard.writeText(b.dataset.copy));
  });

  // Note + Tested
  const noteEl      = detailEl.querySelector("#detailNoteEl");
  const testedBox   = detailEl.querySelector("#detailTestedEl");
  const fieldsBox   = detailEl.querySelector("#detailFieldsCheckedEl");
  const fieldsNote  = detailEl.querySelector("#detailFieldsNoteEl");

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

  // Wire field test checkboxes
  bindFieldTestHandlers(rec, origin, recKey, () => {
    const allDone = areAllFieldTestsComplete(rec);
    if (!allDone) {
      if (fieldsBox) {
        fieldsBox.checked = false;
        fieldsBox.disabled = true;
      }
      rec.fieldsChecked = false;
      fieldsNote.textContent = "Complete all field test boxes to enable.";
      renderTree();
    } else {
      if (fieldsBox) {
        fieldsBox.disabled = false;
      }
      fieldsNote.textContent = "All per-field tests complete.";
    }
  });

  const allDoneNow = areAllFieldTestsComplete(rec);
  if (fieldsBox) {
    fieldsBox.disabled = !allDoneNow;
    if (rec.fieldsChecked && !allDoneNow) {
      fieldsBox.checked = false;
      rec.fieldsChecked = false;
    } else {
      fieldsBox.checked = !!rec.fieldsChecked && allDoneNow;
    }

    fieldsNote.textContent = allDoneNow
      ? "All per-field tests complete."
      : "Complete all field test boxes to enable.";

    fieldsBox.addEventListener("change", ()=>{
      const val = !!fieldsBox.checked && areAllFieldTestsComplete(rec);
      fieldsBox.checked = val; // enforce
      chrome.runtime.sendMessage({ type:"setFieldsChecked", origin, recKey, checked: val });
      rec.fieldsChecked = val;
      renderTree(); 
    });
  }

  const btnAll = detailEl.querySelector("#btnMarkAllTests");
  if (btnAll) {
    btnAll.addEventListener("click", ()=>{
      detailEl.querySelectorAll('input.field-test').forEach(cb => {
        if (!cb.checked) {
          cb.checked = true;
          const fieldKey = cb.dataset.fieldKey;
          const test     = cb.dataset.test;
          chrome.runtime.sendMessage({ type:"setFieldTest", origin, recKey, fieldKey, test, value: true });
          rec.fieldTests = rec.fieldTests || {};
          rec.fieldTests[fieldKey] = rec.fieldTests[fieldKey] || {};
          rec.fieldTests[fieldKey][test] = true;
        }
      });

      if (fieldsBox) {
        fieldsBox.disabled = false;
        fieldsBox.checked  = true;
      }
      chrome.runtime.sendMessage({ type:"setFieldsChecked", origin, recKey, checked: true });
      rec.fieldsChecked = true;
      renderTree();
    });
  }
}

function bindFieldTestHandlers(rec, origin, recKey, onChange){
  const boxes = detailEl.querySelectorAll('input.field-test');
  boxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const fieldKey = cb.dataset.fieldKey;
      const test     = cb.dataset.test;
      const value    = cb.checked;

      chrome.runtime.sendMessage({ type:"setFieldTest", origin, recKey, fieldKey, test, value });

      rec.fieldTests = rec.fieldTests || {};
      rec.fieldTests[fieldKey] = rec.fieldTests[fieldKey] || {};
      rec.fieldTests[fieldKey][test] = value;

      if (!value) {
        rec.fieldsChecked = false;
      }

      if (typeof onChange === "function") onChange();
    });
  });
}

function areAllFieldTestsComplete(rec){
  const TESTS = ["xss","sqli","ssrf","file","auth"];
  const fs = rec.formSummary || { forms: [], looseFields: [] };

  const wantedKeys = [];
  (fs.forms||[]).forEach((f, idx) => (f.fields||[]).forEach(field => {
    const name = field.name || "(unnamed)";
    wantedKeys.push(`form:${idx}|${name}`);
  }));
  (fs.looseFields||[]).forEach(field => {
    const name = field.name || "(unnamed)";
    wantedKeys.push(`loose|${name}`);
  });
  if (!wantedKeys.length) return false; 

  const ft = rec.fieldTests || {};
  return wantedKeys.every(k =>
    TESTS.every(t => !!(ft[k] && ft[k][t] === true))
  );
}


  function renderFieldRow(ff, formIndex, testsList, testsLabel, rec, origin, recKey){
    const name = ff.name || "(unnamed)";
    const type = (ff.type || "text").toLowerCase();
    const key = fieldKeyFor(ff, formIndex);
    rec.fieldTests = rec.fieldTests || {};
    const state = rec.fieldTests[key] || {};

    const cells = testsList.map(t => {
      const checked = state[t] ? "checked" : "";
      return `<td style="text-align:center; padding:4px 6px; border-bottom:1px solid var(--border);">
        <input type="checkbox" data-fieldkey="${escapeAttr(key)}" data-test="${escapeAttr(t)}" ${checked} />
      </td>`;
    }).join("");

    const badges = [];
    if (ff.required) badges.push("required");
    if (ff.multiple) badges.push("multiple");
    if (ff.accept)   badges.push(`accept=${ff.accept}`);

    return `<tr>
      <td style="padding:4px 6px; border-bottom:1px solid var(--border);">
        <code>${escapeHtml(name)}</code> <span class="muted">(${escapeHtml(type)})</span>
        ${badges.length ? `<span class="muted">— ${escapeHtml(badges.join(", "))}</span>` : ""}
      </td>
      ${cells}
    </tr>`;
  }

  function fieldKeyFor(ff, formIndex){
    const name = (ff.name || "").trim() || "(unnamed)";
    const type = (ff.type || "text").toLowerCase();
    return `form${String(formIndex)}:${name}:${type}`;
  }

  function renderDetailsByKey(key){
    const [origin, rest] = key.split("|||");
    const rec = (snapshot[origin]||[]).find(r => (r.method+" "+r.pathTemplate+(r.querySkeleton||"")) === rest);
    if (rec) renderDetails(rec, origin);
  }

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
      for (const {origin, recKey} of items){
        const arr = snapshot[origin] || [];
        const rec = arr.find(r => (r.method+" "+r.pathTemplate+(r.querySkeleton||"")) === recKey);
        if (rec) rec.tested = true;
      }
      renderTree();
      if (selectedKey) renderDetailsByKey(selectedKey);
    });
  }

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
          fieldsChecked: r.fieldsChecked ? 1 : 0,
          fieldTests: r.fieldTests ? JSON.stringify(r.fieldTests) : "",
          note: r.note || "",
          lastSeen: new Date(r.lastSeen).toISOString()
        });
      }
    }
    const header = Object.keys(rows[0]||{
      origin:"",method:"",path:"",query:"",hits:0,statusCounts:"",statuses:"",
      tested:0, fieldsChecked:0, fieldTests:"", note:"", lastSeen:""
    });
    const csv = [header.join(",")]
      .concat(rows.map(r=>header.map(h=>csvEscape(r[h])).join(",")))
      .join("\n");
    download("sitecrawler.csv", new Blob([csv], {type:"text/csv"}));
  }

  // ===== Inline import (panel) =====
  function handleImportInline(){
    const file = importEl.files && importEl.files[0];
    if (!file) return;
    file.text().then(text=>{
      const rows = parseCsvToRows(text);
      const entries = normalizeRowsForImport(rows);
      chrome.runtime.sendMessage({ type:"importCsv", entries }, (resp)=>{
        if (chrome.runtime.lastError) {
          alert("Import failed: " + chrome.runtime.lastError.message);
          return;
        }
        if (!resp?.ok) {
          alert("Import failed: " + (resp?.error || "Unknown error"));
          return;
        }
        alert(`Imported ${resp.imported||entries.length} records.`);
      });
    }).catch(err=>{
      console.error(err);
      alert("Failed to read CSV.");
    }).finally(()=>{
      importEl.value = ""; // reset file input
    });
  }

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
      const fieldsChecked = String(r.fieldsChecked).trim()==="1" || /^true$/i.test(String(r.fieldsChecked));
      const lastSeen = Date.parse(r.lastSeen) || Date.now();
      const hits = parseInt(r.hits,10);

      let fieldTests = {};
      if (r.fieldTests) {
        try {
          const parsed = JSON.parse(r.fieldTests);
          if (parsed && typeof parsed === "object") fieldTests = parsed;
        } catch {}
      }

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
        fieldsChecked,
        fieldTests,
        note: r.note || ""
      };
    }).filter(e=>e.origin && e.method && e.pathTemplate!=null);
  }

  // --- helpers ---
  function pathToRegex(pathTmpl){
    const esc = pathTmpl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return "^" + esc.replace(/:id/g,"[^/]+") + "$";
  }
  function escapeHtml(s){
    return (s==null?"":String(s)).replace(/[&<>"']/g, c=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }
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
