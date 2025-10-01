// content_script_forms.js
(function(){
  let lastSent = "";
  const DEBOUNCE_MS = 600;

  function absoluteUrl(base, rel){
    try { return new URL(rel, base).href; } catch { return rel || ""; }
  }

  function scanForms(){
    const forms = [...document.forms].map((f, idx) => {
      const action = absoluteUrl(location.href, f.getAttribute("action") || location.href);
      const method = (f.getAttribute("method") || "GET").toUpperCase();
      const enctype = (f.getAttribute("enctype") || "").toLowerCase();

      const fields = [...f.querySelectorAll("input, select, textarea")].map(el => {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute("type") || (tag === "textarea" ? "textarea" : tag)).toLowerCase();
        const name = el.getAttribute("name") || "";
        const id = el.id || "";
        const required = el.required === true || el.getAttribute("required") !== null;
        const accept = el.getAttribute("accept") || "";
        const multiple = el.hasAttribute("multiple");
        const minlength = el.getAttribute("minlength");
        const maxlength = el.getAttribute("maxlength");
        const pattern = el.getAttribute("pattern") || "";
        const placeholder = el.getAttribute("placeholder") || "";
        const options = tag === "select" ? [...el.querySelectorAll("option")].map(o=>o.value) : undefined;

        return { tag, type, name, id, required, accept, multiple, minlength, maxlength, pattern, placeholder, options };
      });

      return { idx, action, method, enctype, fields };
    });

    // Inputs not inside a <form>
    const loose = [...document.querySelectorAll("input, select, textarea")].filter(el => !el.closest("form")).map(el=>{
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || (tag === "textarea" ? "textarea" : tag)).toLowerCase();
      const name = el.getAttribute("name") || "";
      const id = el.id || "";
      const required = el.required === true || el.getAttribute("required") !== null;
      const accept = el.getAttribute("accept") || "";
      const multiple = el.hasAttribute("multiple");
      const minlength = el.getAttribute("minlength");
      const maxlength = el.getAttribute("maxlength");
      const pattern = el.getAttribute("pattern") || "";
      const placeholder = el.getAttribute("placeholder") || "";
      const options = tag === "select" ? [...el.querySelectorAll("option")].map(o=>o.value) : undefined;
      return { tag, type, name, id, required, accept, multiple, minlength, maxlength, pattern, placeholder, options };
    });

    const payload = {
      url: location.href,
      title: document.title || "",
      forms,
      looseFields: loose
    };

    const key = JSON.stringify(payload);
    if (key !== lastSent) {
      lastSent = key;
      chrome.runtime?.sendMessage?.({ type:"reportForms", payload });
    }
  }

  // Debounced rescan
  const debouncedScan = (() => {
    let t; return ()=>{ clearTimeout(t); t=setTimeout(scanForms, DEBOUNCE_MS); };
  })();

  // Initial + DOM changes + SPA nav
  scanForms();

  const mo = new MutationObserver(debouncedScan);
  mo.observe(document.documentElement, { childList:true, subtree:true, attributes:true });

  const _ps = history.pushState; history.pushState = function(){ _ps.apply(this, arguments); debouncedScan(); };
  const _rs = history.replaceState; history.replaceState = function(){ _rs.apply(this, arguments); debouncedScan(); };
  window.addEventListener("popstate", debouncedScan);
})();
