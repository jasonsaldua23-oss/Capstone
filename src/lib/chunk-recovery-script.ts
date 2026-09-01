/**
 * Inline recovery for cross-instance chunk mismatches.
 *
 * Production serves this app from several instances that each ran their own
 * `next build`. Chunk filenames are content-hashed per build, so the instance that
 * serves the HTML can reference a chunk that the instance answering the next
 * request never produced. The browser then gets a 404 for a script it was told to
 * load and dies with ChunkLoadError on a blank white page.
 *
 * A reload re-rolls which instance answers, and most pairings are consistent, so
 * retrying recovers the session instead of stranding the user. This is damage
 * control, not a cure: the real fix is building once and shipping the identical
 * artifact to every instance.
 *
 * This ships as an inline script rather than a React component on purpose. When the
 * initial chunks 404 there is no hydration, so no component ever mounts and no error
 * boundary ever runs. Only code already inside the HTML document can react.
 */
export const CHUNK_RECOVERY_SCRIPT = `(function(){
  var KEY="aab:chunk-reload", MAX=2;
  function read(){ try { return Number(sessionStorage.getItem(KEY)||"0")||0; } catch(e){ return MAX; } }
  function give_up(){
    try {
      if (document.body && !document.getElementById("aab-chunk-error")) {
        var d=document.createElement("div");
        d.id="aab-chunk-error";
        d.setAttribute("style","position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;font:14px system-ui,-apple-system,Segoe UI,sans-serif;color:#1f2937;background:#fff;text-align:center;z-index:2147483647");
        d.innerHTML="<div><p style=\\"margin:0 0 8px;font-weight:600\\">This page could not finish loading.</p><p style=\\"margin:0 0 16px;color:#6b7280\\">A required file was unavailable. Please try again in a moment.</p><button id=\\"aab-chunk-retry\\" style=\\"padding:8px 16px;border:1px solid #d1d5db;border-radius:6px;background:#f9fafb;cursor:pointer;font:inherit\\">Retry</button></div>";
        document.body.appendChild(d);
        var b=document.getElementById("aab-chunk-retry");
        if(b) b.addEventListener("click",function(){ try{ sessionStorage.removeItem(KEY); }catch(e){} location.reload(); });
      }
    } catch(e){}
  }
  function recover(){
    var n=read();
    if(n>=MAX){ give_up(); return; }
    try { sessionStorage.setItem(KEY,String(n+1)); } catch(e){ return; }
    location.reload();
  }
  var PATTERN=/ChunkLoadError|Loading chunk|Failed to load chunk|dynamically imported module/;
  addEventListener("error",function(e){
    var t=e&&e.target;
    if(t&&t.tagName==="SCRIPT"&&typeof t.src==="string"&&t.src.indexOf("/_next/static/")!==-1){ recover(); return; }
    if(e&&typeof e.message==="string"&&PATTERN.test(e.message)) recover();
  },true);
  addEventListener("unhandledrejection",function(e){
    var r=e&&e.reason, m=r&&(r.message||r.name)||(r?String(r):"");
    if(typeof m==="string"&&PATTERN.test(m)) recover();
  });
  addEventListener("load",function(){
    // Next's chunk scripts are async, so their error events land after this inline
    // script has run and the handlers above catch them. That ordering is not
    // guaranteed though, and a missed event leaves Next's own error boundary
    // rendered on an otherwise empty page. Watch for exactly that text as a
    // backstop, then clear the counter once the page has stayed up.
    setTimeout(function(){
      try {
        var t=(document.body&&document.body.innerText)||"";
        if(t.indexOf("Application error")!==-1&&t.indexOf("client-side exception")!==-1){ recover(); return; }
      } catch(e){}
      try{ sessionStorage.removeItem(KEY); }catch(e){}
    },5000);
  });
})();`;
