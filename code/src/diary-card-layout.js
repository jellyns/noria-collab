"use strict";
const {setIcon} = require("obsidian");
const {normalizeDiaryCards,changeDiaryCardLayout} = require("./card-layout-model.js");
const {iconButton,openCardMenu,attachCardResize} = require("./card-controls.js");

class DiaryCardLayout {
  constructor(workbench,host){
    this.workbench=workbench;this.plugin=workbench.plugin;this.system=this.plugin.cards;this.host=host;this.cards=new Map();
    this.mode=workbench.selection.mode;this.layout=this.system.layout(this.mode,workbench.diaryCards);this.generation=0;
    this.unsubscribe=this.system.subscribe(()=>{this.layout=this.system.layout(this.mode,workbench.diaryCards);this.apply();void this.renderExtras();this.workbench.diary?.renderDailyState();});
  }
  add(id,className=""){
    const host=this.host.createDiv({cls:`dashboard-guide-card dashboard-workbench-panel noria-diary-card ${className}`});
    host.dataset.diaryCard=id;host.hidden=true;this.cards.set(id,{host,available:false});return host;
  }
  setAvailable(id,value){const card=this.cards.get(id);if(card)card.available=value;this.apply();}
  section(id,title,count){
    const card=this.cards.get(id);card.resizeCleanup?.();card.host.empty();card.title=title;
    const head=card.host.createDiv({cls:"dashboard-guide-card__head noria-diary-card-head"});
    const label=head.createDiv({cls:"dashboard-guide-card__title"});
    setIcon(label.createSpan({cls:"noria-card-heading-icon"}),({focus:"star",tasks:"list-todo",habits:"circle-check"})[id]||"blocks");
    label.createSpan({text:title});if(count!=null)label.createSpan({cls:"noria-diary-card-count",text:String(count)});
    const tools=head.createDiv({cls:"dashboard-guide-card__tools noria-diary-card-tools"});
    const menu=iconButton(tools,"ellipsis",this.plugin.t("workbench.cardLayout"),()=>this.openMenu(id,menu));
    menu.addClass("noria-diary-card-menu");menu.setAttribute("aria-haspopup","dialog");card.button=menu;
    card.body=card.host.createDiv({cls:"noria-diary-card-body"});
    card.resizeCleanup=attachCardResize(card.host,()=>this.layout.cards[id]?.height,value=>this.change(id,"height",value),this.system.text("调整卡片高度","Resize card height"));
    this.apply();return {body:card.body,tools};
  }
  visibleIds(){return this.layout.order.filter(id=>this.cards.get(id)?.available&&!this.layout.cards[id].hidden);}
  openMenu(id,anchor){
    const widget=this.layout.widgets.find(item=>item.id===id),actions=[];
    if(id==="habits")actions.push({label:this.system.text("管理习惯","Manage habits"),icon:"list",run:()=>this.workbench.diary.habitStore.manage()});
    if(widget)actions.push({label:this.system.text("卡片设置","Card settings"),run:()=>this.system.catalog({page:"diary",mode:this.mode,selection:this.selection},id)});
    const state=()=>{const visible=this.visibleIds();return {...this.layout.cards[id],first:visible.indexOf(id)===0,last:visible.indexOf(id)===visible.length-1};};
    this.closeMenu=openCardMenu({anchor,title:this.cards.get(id).title,getAnchor:()=>this.cards.get(id)?.button,t:key=>this.system.t(key),state,actions,
      size:value=>this.change(id,"size",value),move:value=>this.change(id,"move",value),collapse:value=>this.change(id,"collapsed",value),
      height:value=>this.change(id,"height",value),hide:()=>this.change(id,"hidden",true),copy:widget?async()=>{
        await this.system.updateLayout(this.mode,layout=>{const copy=JSON.parse(JSON.stringify(widget));copy.id=`card-${crypto.randomUUID()}`;copy.title=this.system.title(widget)+this.system.text(" 副本"," copy");layout.widgets.push(copy);return layout;});
      }:null});
  }
  async change(id,action,value){
    const visible=this.visibleIds();await this.system.updateLayout(this.mode,layout=>changeDiaryCardLayout(layout,id,action,value,visible));
    this.cards.get(id)?.button?.focus({preventScroll:true});
  }
  restore(value){this.layout=this.system.layout(this.mode,value);this.apply();}
  async setSelection(selection){this.selection={...selection};this.mode=selection.mode;this.layout=this.system.layout(this.mode,this.workbench.diaryCards);this.apply();await this.renderExtras();}
  async renderExtras(){
    const serial=++this.generation;
    for(const [id,card] of this.cards)if(!["focus","tasks","habits"].includes(id)){card.cleanup?.();card.resizeCleanup?.();card.host.remove();this.cards.delete(id);}
    for(const widget of this.layout.widgets){
      this.add(widget.id);const card=this.cards.get(widget.id);card.available=true;
      const {body}=this.section(widget.id,this.system.title(widget));
      if(this.layout.cards[widget.id].hidden||this.layout.cards[widget.id].collapsed)continue;
      const cleanup=await this.system.render(widget,body,this.selection);
      if(serial!==this.generation){cleanup();return;}card.cleanup=cleanup;
    }this.apply();
  }
  apply(){
    const count=this.visibleIds().length;
    this.layout.order.forEach((id,index)=>{
      const card=this.cards.get(id);if(!card)return;
      if(this.host.children[index]!==card.host)this.host.insertBefore(card.host,this.host.children[index]||null);
      const state=this.layout.cards[id],size=this.plugin.getHomeWidgetSizeLayout(state.size);
      card.host.hidden=!card.available||state.hidden;
      card.host.dataset.noriaWidgetSpan=String(state.size==="medium"&&count?Math.max(size.span,12/Math.min(count,3)):size.span);
      card.host.dataset.noriaWidgetSize=state.size;card.host.dataset.collapsed=String(state.collapsed);
      card.host.style.setProperty("--noria-card-height",state.height&&!state.collapsed?`${state.height}px`:"auto");
      if(card.body)card.body.hidden=state.collapsed;
    });
  }
  state(){return normalizeDiaryCards(this.layout);}
  dispose(){++this.generation;this.unsubscribe();this.closeMenu?.(false);for(const card of this.cards.values()){card.cleanup?.();card.resizeCleanup?.();}}
}
module.exports={DiaryCardLayout,normalizeDiaryCards,changeDiaryCardLayout};
