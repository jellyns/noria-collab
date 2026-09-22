"use strict";
const {Menu,Notice}=require("obsidian");
const {DiaryHabitStore}=require("./diary-habits.js");
const H=require("./runtime/views/dashboard/core/utils/habit-parsing.js");

// One dated record control is shared by Diary and older embedded note views.
// Its caller owns refresh and any in-progress document that must be preserved.
function renderDiaryHabitRow({parent,plugin,config,record,onSave,compact=false,date="",onSleep}) {
  config={...config};
  for(const key of ["type","target","unit"])if(record?.[key]!=null && record[key]!=="")config[key]=record[key];
  const t=key=>plugin.t("workbench."+key),text=(zh,en)=>plugin.getNoriaLocale()==="zh"?zh:en;
  const row=parent.createDiv({cls:"noria-diary-habit-row"+(compact?" is-compact":"")});row.dataset.habit=config.name;
  const save=async(done,value="")=>{row.inert=true;try {const ok=await onSave(done,value);if(ok!==false)record={done,value};return ok!==false;}finally{row.inert=false;}};
  const value=()=>String(record?.value??"");
  const typed=["number","sleep"].includes(config.type);
  const title=()=>`${config.name}${date?" · "+date:""}${value()!==""?" · "+value()+(config.unit||""):""}${typed&&config.target?" / "+config.target+(config.unit||""):""}`;
  const button=row.createEl("button",{cls:compact?"clickable-icon noria-habit-cell-button":"noria-habit-value-button",attr:{type:"button"}});
  const paint=()=>{button.title=title();button.setAttribute("aria-label",title());button.setAttribute("aria-pressed",String(!!record?.done));
    button.dataset.state=record?.done?"done":value()!==""?"partial":"empty";button.empty();
    button.createSpan({cls:"noria-habit-status",text:record?.done?"✓":""});
    if(!compact){button.createSpan({cls:"noria-habit-name",text:config.name});if(typed)button.createSpan({cls:"noria-diary-habit-value",text:value()!==""?`${value()}${config.unit||""}`:"—"});}
    if(compact&&parent.parentElement?.classList.contains("noria-habit-history-row")){
      const cells=[...parent.parentElement.children],done=cell=>!!cell?.querySelector('[data-state="done"]');
      cells.forEach((cell,index)=>{cell.dataset.connectedBefore=String(done(cell)&&done(cells[index-1]));cell.dataset.connectedAfter=String(done(cell)&&done(cells[index+1]));});
    }
  };paint();
  button.onclick=async()=>{
    if(!typed){if(await save(!record?.done))paint();return;}
    if(record?.source==="tl"&&record.task){await plugin.openTaskDetails(record.task,{anchor:button,onSaved:()=>plugin.requestNoriaRefresh("home","habit:sleep-source")});return;}
    if(config.type==="sleep"&&onSleep){onSleep(paint);return;}
    require("./record-popover.js").recordPopover(button,`${config.name}${date?" · "+date:""}`,(host,close)=>{
      const form=host.createEl("form",{cls:"noria-diary-habit-form"});
      const input=form.createEl("input",{attr:{type:config.type==="number"?"number":"time","aria-label":t("habitValue"),required:""}});
      if(config.type==="number"){input.min="0";input.step="any";}input.value=value();
      if(config.target)form.createDiv({cls:"noria-card-secondary",text:`${plugin.t("runtime.habits.target")}: ${config.target}${config.unit||""}`});
      const actions=form.createDiv({cls:"noria-record-actions"});
      const submit=actions.createEl("button",{text:t("save"),cls:"mod-cta",attr:{type:"submit"}});
      if(record){const clear=actions.createEl("button",{text:t("habitWithdraw"),attr:{type:"button"}});clear.onclick=async()=>{if(await save(false)){paint();close();}};}
      const error=form.createDiv({cls:"noria-card-error",attr:{role:"alert"}});
      form.onsubmit=async e=>{e.preventDefault();if(!input.reportValidity())return;submit.disabled=true;
        try{const actual=input.value,done=config.type==="sleep"?H.isSleepBeforeTarget(actual,config.target):Number(actual)>=(Number(config.target)||0);
          if(await save(done,actual)){paint();close();}else error.setText(text("未保存，请重试","Not saved. Try again."));
        }catch(e){error.setText(e.message);}finally{submit.disabled=false;}
      };
    });
  };
  return row;
}

async function renderEmbeddedDiaryHabits(plugin,{container,date,registryPath=""}) {
  container.empty();
  // A non-date note must never silently record against today's date.
  try{plugin.resolveReviewSelection({mode:"daily",anchorDate:date});if(!date)throw new Error("missing date");}
  catch(_){container.createSpan({text:plugin.t("workbench.habitChooseDate")});return;}
  if(date>plugin.getLocalYmd()){container.createSpan({text:plugin.t("workbench.habitFuture")});return;}
  const store=new DiaryHabitStore(plugin),data=await store.load(date,{registryPath});
  const records=new Map(data.records.map(r=>[r.name,r])),configs=new Map(data.active.map(c=>[c.name,c]));
  for(const record of data.records)configs.set(record.name,{...configs.get(record.name),...H.inferLegacyHabitConfig(record.text),name:record.name,id:record.id,aliases:record.aliases});
  const names=date===plugin.getLocalYmd()?[...configs.keys()]:[...records.keys()];
  const controls=container.createDiv({cls:"noria-diary-habit-list"});
  const render=config=>renderDiaryHabitRow({parent:controls,plugin,config,record:records.get(config.name),onSave:async(done,value)=>{
    try{await store.write({date,config,done,value});await renderEmbeddedDiaryHabits(plugin,{container,date,registryPath});return true;}
    catch(error){new Notice(String(error?.message||error));return false;}
  }});
  names.forEach(name=>render(configs.get(name)));
  if(!names.length)controls.createSpan({cls:"noria-diary-task-empty",text:plugin.t("runtime.habits.empty")});
  const add=container.createEl("button",{text:plugin.t("workbench.habitBackfill"),attr:{type:"button"}});
  add.addEventListener("click",()=>{
    const menu=new Menu();
    const missing=data.active.filter(c=>!names.includes(c.name));
    missing.forEach(config=>menu.addItem(item=>item.setTitle(config.name).onClick(()=>{names.push(config.name);controls.querySelector(".noria-diary-task-empty")?.remove();render(config);})));
    if(!missing.length)menu.addItem(item=>item.setTitle(plugin.t("runtime.habits.editParams")).onClick(()=>plugin.openCalendarNoteFile(data.registryPath,{newLeaf:true})));
    const rect=add.getBoundingClientRect();menu.showAtPosition({x:rect.left,y:rect.bottom});
  });
}
module.exports={renderDiaryHabitRow,renderEmbeddedDiaryHabits};
