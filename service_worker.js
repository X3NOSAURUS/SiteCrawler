let enabled = false;
let endpoints = new Map(); // Map<origin, Map<key, Rec>>

// restore persisted state
chrome.storage.local.get(["sc_enabled","sc_data"]).then(({ sc_enabled, sc_data }) => {
  if (typeof sc_enabled === "boolean") enabled = sc_enabled;
  if (sc_data) endpoints = reviveMap(sc_data);
  updateBadge();
});

function reviveMap(obj){
  const m = new Map();
  for (const [origin, entries] of Object.entries(obj||{})){
    const inner = new Map();
    for (const [key, rec] of Object.entries(entries||{})){
      inner.set(key, {
        method: rec.method,
        pathTemplate: rec.pathTemplate,
        querySkeleton: rec.querySkeleton,
        types: new Set(rec.types||[]),
        statuses: new Set(rec.statuses||[]),
        statusCounts: rec.statusCounts || {},
        hits: rec.hits||0,
        firstSeen: rec.firstSeen||Date.now(),
        lastSeen: rec.lastSeen||0,
        tested: !!rec.tested,
        note: rec.note || "",
        formSummary: rec.formSummary || null,
        fieldsChecked: !!rec.fieldsChecked,
        fieldTests: rec.fieldTests && typeof rec.fieldTests === "object" ? rec.fieldTests : {}
      });
    }
    m.set(origin, inner);
  }
  return m;
}

function dumpMap(){
  const out = {};
  for (const [origin, inner] of endpoints){
    out[origin] = {};
    for (const [key, r] of inner){
      out[origin][key] = {
        method: r.method,
        pathTemplate: r.pathTemplate,
        querySkeleton: r.querySkeleton,
        types: [...r.types],
        statuses: [...r.statuses],
        statusCounts: r.statusCounts,
        hits: r.hits,
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        tested: !!r.tested,
        note: r.note || "",
        formSummary: r.formSummary || null,
        fieldsChecked: !!r.fieldsChecked,
        fieldTests: r.fieldTests || {}
      };
    }
  }
  return out;
}

let saveTimer=null;
function saveSoon(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>chrome.storage.local.set({ sc_enabled:enabled, sc_data:dumpMap() }), 300);
}

function updateBadge(){
  // Keep the dot. (If you later swap icons for eyes-open/eyes-closed, do it here.)
  chrome.action.setBadgeBackgroundColor({ color: enabled ? "#10b981" : "#9ca3af" });
  chrome.action.setBadgeText({ text: enabled ? "●" : "" });
  chrome.action.setTitle({ title: enabled ? "SiteCrawler (ON)" : "SiteCrawler (OFF)" });
}

// -------- Path templating helpers --------
const ID_SEG = /^(?:\d{1,19}|[0-9a-fA-F]{8,}-?[0-9a-fA-F-]{0,27})$/;
const STRIP_PARAMS = /^(?:utm_.+|gclid|fbclid|msclkid)$/i;

function templatePath(path){
  return (path||"/").split("/").map(seg=>{
    if (!seg) return "";
    try { const d=decodeURIComponent(seg); return ID_SEG.test(d)?":id":d; }
    catch { return ID_SEG.test(seg)?":id":seg; }
  }).join("/");
}
function querySkeleton(qs){
  if (!qs) return "";
  const p = new URLSearchParams(qs);
  const keys = [...new Set([...p.keys()].filter(k=>!STRIP_PARAMS.test(k)))].sort();
  return keys.length ? "?" + keys.map(k=>`${k}=:param`).join("&") : "";
}
function recKey(method, pt, qs){ return `${(method||"GET").toUpperCase()} ${pt}${qs}`; }

// -------- Upsert / capture --------
function upsert(urlStr, method, statusCode, type){
  if (!enabled) return;
  try{
    const u = new URL(urlStr);
    const origin = u.origin;
    const pt = templatePath(u.pathname || "/");
    const qs = querySkeleton(u.search.slice(1));
    const key = recKey(method, pt, qs);

    if (!endpoints.has(origin)) endpoints.set(origin, new Map());
    const map = endpoints.get(origin);
    if (!map.has(key)){
      map.set(key, {
        method: (method||"GET").toUpperCase(),
        pathTemplate: pt,
        querySkeleton: qs,
        types: new Set(),
        statuses: new Set(),
        statusCounts: {},
        hits: 0,
        firstSeen: Date.now(),
        lastSeen: 0,
        tested: false,
        note: "",
        formSummary: null,
        fieldsChecked: false,
        fieldTests: {}
      });
    }
    const rec = map.get(key);
    if (type) rec.types.add(type);
    if (typeof statusCode==="number"){
      rec.statuses.add(statusCode);
      rec.statusCounts[statusCode] = (rec.statusCounts[statusCode] || 0) + 1;
    }
    rec.hits += 1;
    rec.lastSeen = Date.now();
    saveSoon();
  }catch{}
}

chrome.webRequest.onCompleted.addListener(
  (d)=>{ if (enabled) upsert(d.url, d.method, d.statusCode, d.type); },
  { urls:["<all_urls>"] }
);

// -------- Messaging --------
chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
  if (msg?.type==="getState") {
    sendResponse({ enabled });

  } else if (msg?.type==="setEnabled") {
    enabled=!!msg.enabled; updateBadge(); saveSoon(); sendResponse({ok:true,enabled});

  } else if (msg?.type==="getData") {
    const out = {};
    for (const [origin, map] of endpoints){
      out[origin] = [...map.values()].map(v=>({
        method: v.method,
        pathTemplate: v.pathTemplate,
        querySkeleton: v.querySkeleton,
        types: [...v.types],
        statuses: [...v.statuses].sort((a,b)=>a-b),
        statusCounts: v.statusCounts,
        hits: v.hits,
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen,
        tested: !!v.tested,
        note: v.note || "",
        formSummary: v.formSummary || null,
        fieldsChecked: !!v.fieldsChecked,
        fieldTests: v.fieldTests || {}
      }));
    }
    sendResponse({ data: out });

  } else if (msg?.type==="resetData") {
    endpoints.clear(); saveSoon(); sendResponse({ ok:true });

  } else if (msg?.type==="setTested") {
    const { origin, recKey, tested } = msg;
    const map = endpoints.get(origin);
    if (map && map.has(recKey)) {
      const rec = map.get(recKey);
      rec.tested = !!tested;
      saveSoon();
    }
    sendResponse({ok:true});

  } else if (msg?.type==="setManyTested") {
    const { items = [], tested } = msg;
    for (const it of items) {
      const map = endpoints.get(it.origin);
      if (map && map.has(it.recKey)) {
        map.get(it.recKey).tested = !!tested;
      }
    }
    saveSoon();
    sendResponse({ok:true});

  } else if (msg?.type==="setNote") {
    const { origin, recKey, note } = msg;
    const map = endpoints.get(origin);
    if (map && map.has(recKey)) {
      map.get(recKey).note = String(note||"").slice(0,2000);
      saveSoon();
    }
    sendResponse({ok:true});

  } else if (msg?.type === "reportForms") {
    const { url, title, forms = [], looseFields = [] } = msg.payload || {};
    try {
      upsert(url, "GET", undefined, "document");

      const u = new URL(url);
      const origin = u.origin;
      const pt = templatePath(u.pathname || "/");
      const qs = querySkeleton(u.search.slice(1));
      const key = recKey("GET", pt, qs);

      const map = endpoints.get(origin);
      if (map && map.has(key)) {
        const rec = map.get(key);

        const safeActionPath = (action) => {
          try {
            // absolute URL
            const au = new URL(action, origin);
            return templatePath(au.pathname || "/");
          } catch {
            return templatePath((action || "/"));
          }
        };

        const formSummary = (forms||[]).map(f => ({
          method: f.method,
          enctype: f.enctype,
          actionPathTemplate: safeActionPath(f.action),
          fields: (f.fields||[]).map(x => ({
            name: x.name || x.id || "",
            type: x.type,
            required: !!x.required,
            multiple: !!x.multiple,
            accept: x.accept || ""
          }))
        }));

        const looseSummary = (looseFields||[]).map(x => ({
          name: x.name || x.id || "",
          type: x.type,
          required: !!x.required,
          multiple: !!x.multiple,
          accept: x.accept || ""
        }));

        rec.formSummary = {
          title: title || rec.formSummary?.title || "",
          detectedAt: Date.now(),
          forms: formSummary,
          looseFields: looseSummary
        };

        rec.fieldTests = rec.fieldTests || {};

        if (!rec.note && (formSummary.length || looseSummary.length)) {
          const names = [
            ...formSummary.flatMap(f => f.fields.map(ff => ff.name).filter(Boolean)),
            ...looseSummary.map(ff => ff.name).filter(Boolean)
          ];
          const uniq = [...new Set(names)].slice(0, 12);
          rec.note = uniq.length
            ? `Detected form fields: ${uniq.join(", ")}`
            : "Form elements detected on this page.";
        }

        saveSoon();
      }
    } catch {}
    sendResponse && sendResponse({ ok:true });
    return true;

  } else if (msg?.type === "setFieldsChecked") {
    const { origin, recKey, checked } = msg;
    const map = endpoints.get(origin);
    if (map && map.has(recKey)) {
      map.get(recKey).fieldsChecked = !!checked;
      saveSoon();
    }
    sendResponse({ ok:true });

  } else if (msg?.type === "setFieldTest") {
    const { origin, recKey, fieldKey, test, value } = msg;
    const map = endpoints.get(origin);
    if (map && map.has(recKey)) {
      const rec = map.get(recKey);
      rec.fieldTests = rec.fieldTests || {};
      rec.fieldTests[fieldKey] = rec.fieldTests[fieldKey] || {};
      rec.fieldTests[fieldKey][test] = !!value;
      saveSoon();
    }
    sendResponse({ ok:true });

  } else if (msg?.type === "openPanel") {
    chrome.windows.create({
      url: chrome.runtime.getURL("panel.html"),
      type: "popup",
      width: 1280,
      height: 820
    }, () => sendResponse({ ok: true }));
    return true; 

  } else if (msg?.type === "importCsv") {
    try {
      const { entries = [] } = msg;

      // rebuild the in-memory map from CSV entries
      const next = new Map();

      for (const e of entries) {
        if (!e || !e.origin) continue;

        const origin = e.origin;
        if (!next.has(origin)) next.set(origin, new Map());

        const method = (e.method || "GET").toUpperCase();
        const pt = e.pathTemplate || "/";
        const qs = e.querySkeleton || "";
        const key = `${method} ${pt}${qs}`;

        const statusCounts = e.statusCounts && typeof e.statusCounts === "object" ? e.statusCounts : {};
        const statuses = new Set(Array.isArray(e.statuses) ? e.statuses.filter(n => Number.isFinite(n)) : []);

        const record = {
          method,
          pathTemplate: pt,
          querySkeleton: qs,
          types: new Set(),
          statuses,
          statusCounts,
          hits: Number.isFinite(e.hits) ? e.hits : 0,
          firstSeen: e.firstSeen || e.lastSeen || Date.now(),
          lastSeen:  e.lastSeen  || e.firstSeen || Date.now(),
          tested: !!e.tested,
          note: e.note || "",
          formSummary: e.formSummary && typeof e.formSummary === "object" ? e.formSummary : null,
          fieldsChecked: !!e.fieldsChecked,
          fieldTests: e.fieldTests && typeof e.fieldTests === "object" ? e.fieldTests : {}
        };

        next.get(origin).set(key, record);
      }

      // replace current dataset and persist
      endpoints = next;
      saveSoon();
      updateBadge();

      sendResponse({ ok: true, imported: entries.length });
    } catch (err) {
      console.error("[SiteCrawler] importCsv failed:", err);
      sendResponse({ ok: false, error: String(err) });
    }
    return true; // keep the message channel open for async sendResponse
  }
});

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup?.addListener?.(updateBadge);
