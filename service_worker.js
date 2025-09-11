let enabled = false;
let endpoints = new Map(); // Map<origin, Map<key, Rec>>

// Restore persisted state
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
        note: rec.note || ""
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
        note: r.note || ""
      };
    }
  }
  return out;
}
let saveTimer=null;
function saveSoon(){ clearTimeout(saveTimer); saveTimer=setTimeout(()=>chrome.storage.local.set({ sc_enabled:enabled, sc_data:dumpMap() }), 300); }
function updateBadge(){
  chrome.action.setBadgeBackgroundColor({ color: enabled ? "#10b981" : "#9ca3af" });
  chrome.action.setBadgeText({ text: enabled ? "●" : "" });
  chrome.action.setTitle({ title: enabled ? "SiteCrawler (ON)" : "SiteCrawler (OFF)" });
}

// Path templating
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
        note: ""
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

// Capture everything
chrome.webRequest.onCompleted.addListener(
  (d)=>{ if (enabled) upsert(d.url, d.method, d.statusCode, d.type); },
  { urls:["<all_urls>"] }
);

// Messaging
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
        note: v.note || ""
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
  } else if (msg?.type === "openPanel") {
    chrome.windows.create({
    url: chrome.runtime.getURL("panel.html"),
    type: "popup",
    width: 1280,
    height: 820
    }, () => sendResponse({ ok: true }));
    return true; // async response
 }
});

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup?.addListener?.(updateBadge);
