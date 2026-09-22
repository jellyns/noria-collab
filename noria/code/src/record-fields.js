"use strict";
const {parseYaml,Menu,Notice,setIcon}=require("obsidian");
const {readProperty,writeProperty,validateValue}=require("./record-properties.js");
const {RecordManager}=require("./record-manager.js");
const {recordPopover}=require("./record-popover.js");
const {iconButton}=require("./card-controls.js");
const clone=value=>JSON.parse(JSON.stringify(value));
class RecordFields{
  constructor(plugin){this.plugin=plugin;this.app=plugin.app;}
  text(zh,en){return this.plugin.getNoriaLocale()==="zh"?zh:en;}
  definitions(){
    return this.plugin.settings.recordFields||[
      {id:"mood",property:"mood",name:this.text("心情","Mood"),type:"option",options:["很好","稳定","一般","偏低","很差"],icon:"smile",color:"",enabled:true,legacy:"mood"},
      {id:"energy",property:"energy",name:this.text("精力","Energy"),type:"level",min:1,max:5,icon:"battery-medium",color:"",enabled:true,legacy:"energy"},
      {id:"focus",property:"focus",name:this.text("专注","Focus"),type:"option",options:["很专注","基本专注","易分心","难进入状态"],icon:"focus",enabled:false,legacy:"focus"}
    ];
  }
  read(raw,field){return readProperty(raw,field,parseYaml);}
  display(field,value){if(value==null)return "—";if(field.type==="toggle")return value?this.text("是","Yes"):this.text("否","No");
    if(field.type==="option"&&field.options?.includes(value)){
      if(this.plugin.getNoriaLocale()==="zh"||!field.legacy)return String(value);
      if(field.legacy==="mood"&&value==="一般")return "Okay";
    }
    if(field.legacy&&typeof value==="string")return this.plugin.displayRuntimeLabel(field.legacy,value,value);
    return `${value}${field.type==="level"?"/"+field.max:field.unit?" "+field.unit:""}`;
  }
  color(field){
    if(/^#[\da-f]{6}$/i.test(field.color||""))return field.color;
    return ({mood:"var(--color-purple)",energy:"var(--color-orange)",focus:"var(--color-blue)",sleep_hours:"var(--color-blue)",reading_minutes:"var(--color-cyan)",exercise:"var(--color-green)"})[field.property]||"var(--interactive-accent)";
  }
  async save(date,field,value,{increment=false}={}){
    const p=this.plugin,spec=await p.resolveCalendarNoteSpecAsync("daily",date),file=this.app.vault.getAbstractFileByPath(spec.path),seed=file?"":await p.buildCalendarNoteContent(spec);
    if(date>p.getLocalYmd())throw Error(this.text("未来日期不能填写实际记录","Actual records cannot be entered for a future date"));
    const {readHabitDefinitions}=require("./habit-definition.js"),{habitRecords,writeHabitMarkdown}=require("./diary-habits.js");
    const bindings=readHabitDefinitions(await p.loadTextFromVault(p.getManagedPath("habitRegistry"))).filter(config=>config.recordField===field.property);
    let previousText,text;
    await p.processTextAtVaultPath(spec.path,current=>{previousText=current;const source=current||(file?"":seed);
      if(increment){const old=this.read(source,field);if(old!=null&&typeof old!=="number")throw Error(this.text("原值不是数值","The existing value is not a number"));value=(old??0)+value;}
      text=writeProperty(source,field,value,parseYaml);
      const existing=habitRecords(source,date,spec.path);
      for(const config of bindings){const record=existing.find(row=>(config.id&&row["habit-id"]===config.id)||row.name===config.name||String(config.aliases||"").split(";").includes(row.name));if(!record&&(config.stage!=="active"||date!==p.getLocalYmd()))continue;
        const target=Number(record?.target||config.target);text=writeHabitMarkdown(text,{config:{...config,target:String(target)},date,value:"",done:typeof value==="number"&&value>=target,heading:p.t("workbench.habits")});}
      return text;});
    p.requestNoriaRefresh("tasks","record-field:save");return {ok:true,path:spec.path,write:{path:spec.path,previousText,text}};
  }
  render({host,date,raw,beforeSave,onSaved,report,context={page:"home"}}){
    host.addClass("noria-record-fields");
    const save=async(field,value,options)=>{if(beforeSave&&await beforeSave()===false)return false;const result=await this.save(date,field,value,options);await onSaved?.(result);
      [...host.querySelectorAll("[data-record-field]")].find(e=>e.dataset.recordField===field.id)?.focus({preventScroll:true});return true;};
    for(const field of this.definitions().filter(f=>f.enabled!==false)){
      let value;try{value=this.read(raw,field);}catch(e){host.createSpan({cls:"noria-card-error",text:e.message});continue;}
      const b=host.createEl("button",{cls:"noria-record-value",attr:{type:"button","aria-haspopup":"dialog","data-record-field":field.id}});
      b.style.setProperty("--noria-record-color",this.color(field));b.dataset.recorded=String(value!=null);
      const icon=b.createSpan({cls:"noria-record-field-icon"});setIcon(icon,field.icon||"circle");
      b.createSpan({cls:"noria-record-label",text:field.name});b.createSpan({cls:"noria-record-current",text:value==null?this.text("记录","Record"):this.display(field,value)});
      b.disabled=date>this.plugin.getLocalYmd();
      b.onclick=()=>recordPopover(b,field.name,(popover,close)=>{
        popover.style.setProperty("--noria-record-color",this.color(field));
        const error=popover.createDiv({cls:"noria-card-error",attr:{role:"alert"}});
        const submit=async(next,options)=>{try{if(await save(field,next,options))close();}catch(e){error.setText(e.message);report?.(e);}};
        const choices=popover.createDiv({cls:"noria-record-options"});
        if(field.type==="option"||field.type==="toggle"||field.type==="level"){
          const values=field.type==="toggle"?[true,false]:field.type==="level"?Array.from({length:field.max-field.min+1},(_,i)=>field.min+i):field.options;
          choices.style.setProperty("--noria-options",String(Math.min(values.length,values.some(v=>this.display(field,v).length>8)?2:5)));
          for(const choice of values){const button=choices.createEl("button",{text:this.display(field,choice),attr:{type:"button","aria-pressed":String(value===choice)}});button.onclick=()=>submit(choice);}
        }else{
          const form=choices.createEl("form"),input=form.createEl("input",{attr:{type:"number",step:"any",required:"","aria-label":field.name}});input.value=value??"";
          if(field.unit)form.createSpan({cls:"noria-card-secondary",text:field.unit});
          const actions=form.createDiv({cls:"noria-record-actions"});actions.createEl("button",{text:this.text("保存","Save"),cls:"mod-cta",attr:{type:"submit"}});
          const add=actions.createEl("button",{text:this.text("累加","Add to total"),attr:{type:"button"}});add.onclick=()=>{if(input.reportValidity())submit(Number(input.value),{increment:true});};
          form.onsubmit=e=>{e.preventDefault();if(input.reportValidity())void submit(Number(input.value));};
        }
        const actions=popover.createDiv({cls:"noria-record-actions"});
        if(value!=null){const clear=actions.createEl("button",{text:this.text("清除","Clear")});clear.onclick=()=>submit(null);}
        iconButton(actions,"chart-no-axes-combined",this.text("添加统计卡","Add statistics card"),()=>{close();this.plugin.propertyStats.addForField(field,context);});
      });
    }
    iconButton(host,"ellipsis",this.text("设置记录项目","Configure records"),()=>this.manage(false,context));
  }
  manage(initial=false,context={page:"home"}){
    const presets={sleep:{name:this.text("睡眠时长","Sleep duration"),property:"sleep_hours",type:"number",unit:this.text("小时","hours"),icon:"moon"},reading:{name:this.text("阅读时长","Reading time"),property:"reading_minutes",type:"number",unit:this.text("分钟","minutes"),icon:"book-open"},exercise:{name:this.text("运动","Exercise"),property:"exercise",type:"toggle",unit:"",icon:"footprints"}};
    const typeOptions=[{value:"option",label:this.text("选项","Options")},{value:"level",label:this.text("等级","Scale")},{value:"number",label:this.text("数值","Number")},{value:"toggle",label:this.text("开关","Toggle")}];
    const save=async(draft,original)=>{
      const name=String(draft.name||"").trim(),property=String(draft.property||"").trim();if(!name||!property||/[\r\n]/.test(property)||["__proto__","constructor","prototype"].includes(property))throw Error(this.text("填写有效名称与属性","Enter a valid name and property"));
      const fields=clone(this.definitions());if(fields.some(f=>f.id!==original?.id&&f.property===property))throw Error(this.text("此属性已有记录项目","This property already has a record control"));
      if(original&&(original.property!==property||original.type!==draft.type||String(original.unit||"")!==String(draft.unit||"")))throw Error(this.text("属性、类型或单位不同，请新建记录项目以保留历史含义","Create a separate field for a different property, type or unit"));
      const options=String(draft.optionText||"").split(/[;；\n]/).map(x=>x.trim()).filter(Boolean);
      if(draft.type==="option"&&!options.length)throw Error(this.text("至少填写一个选项","Enter at least one option"));
      if(draft.type==="level"&&(!Number.isInteger(draft.min)||!Number.isInteger(draft.max)||draft.max<draft.min||draft.max-draft.min>10))throw Error(this.text("等级使用整数，最多 11 级","Use integers with at most 11 levels"));
      const next={...draft,id:original?.id||crypto.randomUUID(),name,property,options,enabled:draft.enabled!==false};delete next.optionText;delete next.preset;
      const i=fields.findIndex(f=>f.id===next.id);if(i>=0)fields[i]=next;else fields.push(next);
      const previous=this.plugin.settings.recordFields;this.plugin.settings.recordFields=fields;
      try{await this.plugin.saveSettings();}catch(e){this.plugin.settings.recordFields=previous;throw e;}
      this.plugin.cards.emit();this.plugin.requestNoriaRefresh("home","record-field:definitions");
    };
    const manager=new RecordManager(this.plugin,{title:this.text("记录项目","Record fields"),initial,
      list:async()=>this.definitions().map(f=>({...f,optionText:(f.options||[]).join("; ")})),summary:f=>`${f.property} · ${typeOptions.find(t=>t.value===f.type)?.label}${f.enabled===false?this.text(" · 已停用"," · Disabled"):""}`,
      defaults:()=>({name:"",property:"",type:"number",unit:"",min:1,max:5,optionText:"",icon:"circle",color:"#8b7cf6",enabled:true}),
      fields:d=>[...(!d.id?[{key:"preset",label:this.text("开始方式","Start with"),type:"select",refresh:true,options:[{value:"",label:this.text("已有属性或自定义","Existing property or custom")},...Object.entries(presets).map(([value,p])=>({value,label:p.name}))],onChange:d=>{if(presets[d.preset])Object.assign(d,presets[d.preset]);}}]:[]),{key:"name",label:this.text("显示名称","Display name"),required:true},
        {key:"property",label:this.text("笔记属性（可复用已有属性）","Note property (existing or new)"),type:"property",required:true,disabled:!!d.id,description:this.text("只改显示名称不会重命名笔记属性。","Changing the display name keeps the note property unchanged.")},
        {key:"type",label:this.text("记录方式","Input type"),type:"select",options:typeOptions,disabled:!!d.id,refresh:true},
        {key:"unit",label:this.text("单位","Unit"),disabled:!!d.id,when:d=>d.type==="number"},
        {key:"optionText",label:this.text("选项，用分号分隔","Options, separated by semicolons"),when:d=>d.type==="option"},
        {key:"min",label:this.text("最低等级","Lowest level"),type:"number",step:1,when:d=>d.type==="level"},
        {key:"max",label:this.text("最高等级","Highest level"),type:"number",step:1,when:d=>d.type==="level"},
        {key:"icon",label:this.text("图标","Icon"),type:"select",options:[["circle","圆点","Dot"],["smile","微笑","Smile"],["battery-medium","电池","Battery"],["moon","月亮","Moon"],["book-open","书本","Book"],["heart","心形","Heart"],["droplets","水滴","Droplet"],["footprints","足迹","Footprints"],["focus","聚焦","Focus"]].map(([value,zh,en])=>({value,label:this.text(zh,en)}))},
        {key:"color",label:this.text("颜色","Color"),type:"color"},{key:"enabled",label:this.text("显示此记录项目","Show this field"),type:"checkbox"}],
      save,actions:f=>[{label:this.text(f.enabled===false?"启用":"停用",f.enabled===false?"Enable":"Disable"),icon:f.enabled===false?"eye":"eye-off",run:()=>save({...f,enabled:f.enabled===false},f)},
        {label:this.text("添加统计卡","Add statistics card"),icon:"chart-no-axes-combined",run:()=>this.plugin.propertyStats.addForField(f,context)}]
    });manager.open();return manager;
  }
}
module.exports={RecordFields};
