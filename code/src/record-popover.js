"use strict";
let active;
// A short-lived editor anchored to the value being changed. It cannot outlive its row.
function recordPopover(anchor,title,build){
  active?.();
  const doc=anchor.ownerDocument,win=doc.defaultView,abort=new win.AbortController();
  const host=doc.body.createDiv({cls:"popover noria-record-popover",attr:{role:"dialog","aria-label":title}});
  host.createEl("strong",{text:title});
  let closed=false;
  const close=(focus=true)=>{if(closed)return;closed=true;abort.abort();observer.disconnect();host.remove();if(active===close)active=null;if(focus&&anchor.isConnected)anchor.focus({preventScroll:true});};
  const observer=new win.MutationObserver(()=>{if(!anchor.isConnected||!anchor.getClientRects().length)close(false);});observer.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:["hidden"]});
  const position=()=>{const r=anchor.getBoundingClientRect();host.style.left=Math.max(8,Math.min(win.innerWidth-host.offsetWidth-8,r.left))+"px";host.style.top=Math.max(8,Math.min(win.innerHeight-host.offsetHeight-8,r.bottom+6))+"px";};
  build(host,close);position();active=close;
  const opts={capture:true,signal:abort.signal};
  doc.addEventListener("pointerdown",e=>{if(!host.contains(e.target)&&!anchor.contains(e.target))close(false);},opts);
  doc.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close();}else if(e.key==="Tab"){
    const items=[...host.querySelectorAll("input,select,button,textarea")].filter(e=>!e.disabled&&!e.hidden);
    if(e.shiftKey&&doc.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus();}
    else if(!e.shiftKey&&doc.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}
  }},opts);
  win.addEventListener("resize",position,{signal:abort.signal});
  win.addEventListener("scroll",position,{capture:true,signal:abort.signal});
  host.querySelector("input,select,button,textarea")?.focus();return close;
}
module.exports={recordPopover};
