"use strict";
const {setIcon, setTooltip, Notice} = require("obsidian");
let activeMenu = null;

function iconButton(parent, icon, label, action) {
  const button=parent.createEl("button",{cls:"clickable-icon noria-card-icon",attr:{type:"button","aria-label":label}});
  setIcon(button,icon); setTooltip(button,label);
  if(action)button.addEventListener("click",action);
  return button;
}

// Shared, anchored card controls. Content actions stay separate from layout.
function openCardMenu({anchor, title, state, actions=[], move, size, collapse, hide, height, copy, getAnchor, t}) {
  activeMenu?.();
  const doc=anchor.ownerDocument, win=doc.defaultView;
  const root=doc.body.createDiv({cls:"noria-card-menu",attr:{role:"dialog","aria-label":title}});
  let closed=false, busy=false;
  const currentAnchor=()=>getAnchor?.() || anchor;
  const close=(focus=true)=>{
    if(closed)return;closed=true;
    doc.removeEventListener("pointerdown",outside,true);doc.removeEventListener("keydown",keys,true);
    win.removeEventListener("resize",position);doc.removeEventListener("scroll",position,true);root.remove();
    anchor.setAttribute("aria-expanded","false");currentAnchor()?.setAttribute("aria-expanded","false");
    if(focus)currentAnchor()?.focus({preventScroll:true});
    if(activeMenu===close)activeMenu=null;
  };
  const outside=event=>{if(!event.composedPath().includes(root)&&!event.composedPath().includes(currentAnchor()))close(false);};
  const keys=event=>{
    if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();return;}
    if(!["ArrowDown","ArrowUp","Tab"].includes(event.key))return;
    const nodes=[...root.querySelectorAll("button:not(:disabled)")];
    if(!nodes.length)return;const index=nodes.indexOf(doc.activeElement);
    const backward=event.key==="ArrowUp"||(event.key==="Tab"&&event.shiftKey);
    event.preventDefault();nodes[(index+(backward?nodes.length-1:1))%nodes.length].focus();
  };
  function position(){
    const a=currentAnchor();if(!a?.isConnected){close(false);return;}
    const r=a.getBoundingClientRect(), box=root.getBoundingClientRect();
    root.style.left=`${Math.max(8,Math.min(r.right-box.width,win.innerWidth-box.width-8))}px`;
    root.style.top=`${Math.max(8,r.bottom+box.height+6>win.innerHeight?r.top-box.height-6:r.bottom+6)}px`;
  }
  const error=root.createDiv({cls:"noria-card-menu-error",attr:{role:"alert"}});error.hidden=true;
  async function run(action, keep=false){
    if(busy)return;busy=true;error.hidden=true;root.setAttribute("aria-busy","true");
    try{await action();if(keep&&!closed){paintLayout();position();}else close(false);}
    catch(e){error.setText(e?.message||String(e));error.hidden=false;position();}
    finally{busy=false;root.removeAttribute("aria-busy");}
  }
  const contents=root.createDiv({cls:"noria-card-menu-content"});
  for(const action of actions){
    const button=contents.createEl("button",{cls:"noria-card-menu-action",attr:{type:"button"}});
    setIcon(button.createSpan(),action.icon||"settings-2");button.createSpan({text:action.label});
    button.addEventListener("click",()=>{close(false);Promise.resolve().then(action.run).catch(e=>new Notice(e.message||String(e)));});
  }
  const layout=root.createDiv({cls:"noria-card-menu-layout"});
  function paintLayout(){
    const value=state();layout.empty();
    const widths=layout.createDiv({cls:"noria-card-widths",attr:{role:"group","aria-label":t("width")}});
    [["small",3],["medium",4],["wide",6],["full",12]].forEach(([key,span])=>{
      const label=t(key), button=widths.createEl("button",{cls:"noria-card-width",attr:{type:"button","aria-label":label,"aria-pressed":String(value.size===key)}});
      const preview=button.createSpan({cls:"noria-card-width-preview",attr:{"aria-hidden":"true"}});
      preview.createSpan().style.width=`${span/12*100}%`;setTooltip(button,label);
      button.addEventListener("click",()=>run(()=>size(key),true));
    });
    const tools=layout.createDiv({cls:"noria-card-layout-actions"});
    const up=iconButton(tools,"arrow-up",t("up"),()=>run(()=>move("up"),true));up.disabled=value.first===true;
    const down=iconButton(tools,"arrow-down",t("down"),()=>run(()=>move("down"),true));down.disabled=value.last===true;
    iconButton(tools,value.collapsed?"chevrons-up-down":"chevrons-down-up",t(value.collapsed?"expand":"collapse"),()=>run(()=>collapse(!value.collapsed),true));
    if(height)iconButton(tools,"fold-vertical",t("autoHeight"),()=>run(()=>height(null),true));
    if(copy)iconButton(tools,"copy",t("copy"),()=>run(copy));
    iconButton(tools,value.enabled===false?"eye":"eye-off",t(value.enabled===false?"show":"hide"),()=>run(hide));
  }
  paintLayout();position();anchor.setAttribute("aria-expanded","true");
  doc.addEventListener("pointerdown",outside,true);doc.addEventListener("keydown",keys,true);win.addEventListener("resize",position);doc.addEventListener("scroll",position,true);
  activeMenu=close;root.querySelector("button")?.focus({preventScroll:true});return close;
}

function attachCardResize(host,getHeight,saveHeight,label){
  const handle=iconButton(host,"grip-horizontal",label);handle.addClass("noria-card-resize");
  let drag=null;
  const preview=value=>host.style.setProperty("--noria-card-height",`${Math.max(120,Math.min(1200,value))}px`);
  const cancel=()=>{if(!drag)return;host.style.setProperty("--noria-card-height",drag.saved?`${drag.saved}px`:"auto");drag=null;};
  handle.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();drag={y:event.clientY,height:host.getBoundingClientRect().height,saved:getHeight(),value:null};handle.setPointerCapture(event.pointerId);};
  handle.onpointermove=event=>{if(drag){drag.value=Math.max(120,Math.min(1200,Math.round(drag.height+event.clientY-drag.y)));preview(drag.value);}};
  handle.onpointerup=()=>{const value=drag?.value;drag=null;if(value!=null)Promise.resolve(saveHeight(value)).catch(e=>{host.style.setProperty("--noria-card-height",getHeight()?`${getHeight()}px`:"auto");new Notice(e.message);});};
  handle.onpointercancel=cancel;handle.onlostpointercapture=cancel;
  const key=event=>{if(event.key==="Escape"&&drag){event.preventDefault();event.stopPropagation();cancel();}};
  host.ownerDocument.addEventListener("keydown",key,true);
  handle.onkeydown=event=>{if(event.key==="Home"){event.preventDefault();Promise.resolve(saveHeight(null)).catch(e=>new Notice(e.message));return;}if(["ArrowUp","ArrowDown"].includes(event.key)){event.preventDefault();const value=Math.round(host.getBoundingClientRect().height)+(event.key==="ArrowUp"?-16:16);Promise.resolve(saveHeight(value)).catch(e=>new Notice(e.message));}};
  return()=>{cancel();host.ownerDocument.removeEventListener("keydown",key,true);handle.remove();};
}
module.exports={iconButton,openCardMenu,attachCardResize};
