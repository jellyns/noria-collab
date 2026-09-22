"use strict";
const {parseYaml,Modal,setIcon}=require("obsidian");
const {frontmatter}=require("./record-properties.js");
const {filterNotes,summarize,alignDailyRecords}=require("./property-statistics.js");
const {iconButton}=require("./card-controls.js");
const {recordPopover}=require("./record-popover.js");
const {diaryRange}=require("./diary-tasks.js");
const {dayNumber}=require("./countdown-document.js");
class PropertyStatCards{
  constructor(plugin){this.plugin=plugin;this.app=plugin.app;}
  text(zh,en){return this.plugin.getNoriaLocale()==="zh"?zh:en;}
  fields(config={}){
    const t=(a,b)=>this.text(a,b),options=items=>items.map(([value,zh,en])=>({value,label:t(zh,en)}));
    return [
      {key:"source",label:t("数据来源","Source"),type:"select",default:"diary",refresh:true,options:options([["diary","日期笔记属性","Date note properties"],["notes","任意笔记 / 文件夹","Any notes / folder"],["tasks","任务完成","Task completion"],["habits","习惯打卡","Habit check-ins"]])},
      ...(["tasks","habits"].includes(config.source)?[]:[
        {key:"folder",label:t("文件夹（留空使用已配置资料范围）","Folder (empty for configured note scope)"),type:"folder"},
        {key:"recursive",label:t("包含子文件夹","Include subfolders"),type:"checkbox",default:true},
        {key:"tag",label:t("标签（可选）","Tag (optional)")},
        {key:"property",label:t("统计属性（留空统计笔记数量）","Property (empty to count notes)"),type:"property"},
        {key:"calculate",label:t("计算方式","Calculation"),type:"select",default:"count",refresh:true,options:options([["count","有记录的数量","Recorded count"],["sum","合计","Sum"],["mean","平均值","Mean"],["min","最小值","Minimum"],["max","最大值","Maximum"],["distribution","状态分布","Distribution"]])},
        {key:"group",label:t("分组","Group by"),type:"select",default:"",options:options([["","不额外分组","None"],["folder","文件夹","Folder"],["tag","标签","Tag"]])},
        {key:"filterProperty",label:t("筛选属性（可选）","Filter property (optional)"),type:"property"},{key:"filterValue",label:t("属性值（留空表示存在）","Filter value (empty means present)")},
        {key:"unitProperty",label:t("单位属性（不同单位不能合算）","Unit property (different units cannot be combined)"),type:"property"},
        ...(config.source==="notes"?[{key:"dateBasis",label:t("日期依据","Date basis"),type:"select",default:"",refresh:true,options:options([["","未指定","Not specified"],["property","事件日期属性","Event date property"],["created","文件创建时间","File creation date"],["modified","文件修改时间","File modification date"]])},
          ...(config.dateBasis==="property"?[{key:"dateProperty",label:t("事件日期属性","Event date property"),type:"property",required:true}]:[])]:[])]),
      {key:"display",label:t("表现","Display"),type:"select",default:"metric",options:options([["metric","数字","Number"],["trend","日期趋势","Date trend"],["bars","横向分布","Horizontal bars"]])},
      {key:"scope",label:t("时间范围","Time range"),type:"select",default:"follow",refresh:true,options:options([["follow","跟随当前页面","Follow page"],["all","不限时间","All dates"],["fixed","固定范围","Fixed range"]])},
      ...(config.scope==="fixed"?[{key:"start",label:t("开始","Start"),type:"date",required:true},{key:"end",label:t("结束","End"),type:"date",required:true}]:[])
    ];
  }
  register(system){system.register({id:"noria:statistics",title:this.text("统计","Statistics"),icon:"chart-no-axes-combined",supportsDate:true,
    description:this.text("记录、笔记属性、文件夹、任务和习惯的真实统计。","Statistics from records, note properties, folders, tasks and habits."),fields:config=>this.fields(config),validate:config=>this.validate(config),
    render:async({container,config,selection,component})=>{
      let generation=0,timer;const paint=async()=>{const serial=++generation;try{const result=await this.query(config,selection);if(serial!==generation)return;container.empty();this.draw(container,result,config);}catch(e){if(serial===generation){container.empty();container.createDiv({cls:"noria-card-empty",text:e.message});}}};
      await paint();const refresh=()=>{clearTimeout(timer);timer=setTimeout(paint,180);};
      component.registerEvent(this.app.metadataCache.on("changed",refresh));component.registerEvent(this.app.vault.on("delete",refresh));component.register(()=>{++generation;clearTimeout(timer);});
    }});}
  validate(config){
    if(config.scope==="fixed"&&(!Number.isFinite(dayNumber(config.start))||!Number.isFinite(dayNumber(config.end))||config.start>config.end))throw Error(this.text("选择有效的日期范围","Choose a valid date range"));
    if(config.source==="notes"&&(config.scope!=="all"||config.display==="trend")&&!config.dateBasis)throw Error(this.text("为这些笔记选择日期依据，或使用不限时间","Select a date basis, or use All dates"));
    if(["sum","mean","min","max","distribution"].includes(config.calculate)&&!config.property&&!['tasks','habits'].includes(config.source))throw Error(this.text("选择要统计的属性","Select a property"));
    if(config.folder&&!this.app.vault.getAbstractFileByPath(config.folder)?.children)throw Error(this.text("找不到所选文件夹","Folder not found"));
  }
  async range(config,selection){
    if(config.scope==="all")return null;
    if(config.scope==="fixed")return {start:config.start,end:config.end};
    if(selection?.mode)return diaryRange(selection);
    const service=await this.plugin.createDataService({});return service.resolveRange(this.plugin.settings.home?.trendsRange||{});
  }
  async query(input={},selection){
    const config={source:"diary",calculate:"count",display:"metric",scope:"follow",...input};this.validate(config);
    const range=await this.range(config,selection),source=config.source;
    if(["tasks","habits"].includes(source)){
      let rows=[];
      if(source==="tasks"){
        const {getTaskDate}=require("./runtime/views/dashboard/core/utils/task-display.js");
        rows=(await this.plugin.getRuntimeTaskRows("tasks")).filter(task=>task.completed&&!/(^|\s)#habit\b/.test(task.text||"")).map(task=>({path:task.path,date:getTaskDate(task,"done"),properties:{value:1},tags:[],title:task.text})).filter(row=>!range||row.date&&row.date>=range.start&&row.date<=range.end);
      }else{
        const service=await this.plugin.createDataService({});
        const dates=this.plugin.filesUnderRoots([this.plugin.buildRuntimeBridgeConfig().paths.diaryRoot],[".md"]).map(f=>f.basename).filter(n=>/^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
        const period=range||{start:dates[0]||this.plugin.getLocalYmd(),end:this.plugin.getLocalYmd()};
        const snapshot=await service.getSnapshot({range:{mode:"custom",...period},include:["habits"]});
        for(const row of snapshot.domains.habits?.heatmap?.series||[])if(row.checked){const date=row.date||row.key,spec=await this.plugin.resolveCalendarNoteSpecAsync("daily",date);rows.push({path:spec.path,date,properties:{value:row.checked},tags:[]});}
      }
      const result=summarize(rows,{property:"value",calculate:"sum",display:config.display});result.value??=0;return {...result,range,source};
    }
    const diaryRoot=this.plugin.buildRuntimeBridgeConfig().paths.diaryRoot;
    const roots=config.folder?[config.folder]:source==="diary"?[diaryRoot]:this.plugin.getScopeSpec("notes").roots;
    const files=this.plugin.filesUnderRoots(roots,[".md"]).filter(file=>source!=="diary"||/^\d{4}-\d{2}-\d{2}$/.test(file.basename));
    const candidates=filterNotes(files.map(file=>{const cache=this.app.metadataCache.getFileCache(file);return {file,path:file.path,properties:cache?.frontmatter||{},tags:[...(cache?.tags||[]).map(t=>t.tag),...[cache?.frontmatter?.tags||[]].flat()]};}),{...config,filterProperty:""});
    const rows=[],unreadable=[];
    // Bounded parallel reads. Cached metadata finds candidates; values come from current source text.
    for(let index=0;index<candidates.length;index+=24)await Promise.all(candidates.slice(index,index+24).map(async candidate=>{
      try{const raw=await this.app.vault.cachedRead(candidate.file),properties=frontmatter(raw,parseYaml).value;
        for(const field of this.plugin.records.definitions())if(field.legacy&&!Object.hasOwn(properties,field.property)){const value=this.plugin.records.read(raw,field);if(value!=null)properties[field.property]=value;}
        let date=source==="diary"?candidate.file.basename:config.dateBasis==="property"?(properties[config.dateProperty] instanceof Date?properties[config.dateProperty].toISOString().slice(0,10):String(properties[config.dateProperty]||"").slice(0,10)):config.dateBasis?this.plugin.getLocalYmd(new Date(config.dateBasis==="created"?candidate.file.stat.ctime:candidate.file.stat.mtime)):"";
        if((range||config.display==="trend")&&!Number.isFinite(dayNumber(date))){unreadable.push({path:candidate.path,error:this.text("缺少有效的日期依据","Missing a valid date")});return;}
        if(range&&(date<range.start||date>range.end))return;
        rows.push({...candidate,properties,date});
      }catch(e){unreadable.push({path:candidate.path,error:e.message});}
    }));
    const result=summarize(filterNotes(rows,config),config);return {...result,range,source,unreadable};
  }
  draw(host,result,config){
    host.addClass("noria-property-stat");
    const recordField=this.plugin.records.definitions().find(f=>f.property===config.property);
    if(recordField)host.style.setProperty("--noria-record-color",this.plugin.records.color(recordField));
    const range=result.range;host.createDiv({cls:"noria-stat-range",text:range?`${range.start} — ${range.end}`:this.text("不限时间","All dates")});
    const number=value=>value==null?"—":new Intl.NumberFormat(this.plugin.getNoriaLocale(),{maximumFractionDigits:2}).format(value);
    const main=host.createEl("button",{cls:"noria-stat-result",text:number(result.value)});main.onclick=()=>this.openRows(result.rows,result);
    const field=this.plugin.records.definitions().find(f=>f.property===config.property),label=({sum:this.text("合计","Sum"),mean:this.text("平均","Mean"),min:this.text("最小值","Minimum"),max:this.text("最大值","Maximum"),count:this.text("数量","Count"),distribution:this.text("有记录","Recorded")})[config.calculate||"count"];
    host.createDiv({cls:"noria-card-secondary",text:[label,field?.unit].filter(Boolean).join(" · ")});
    host.createDiv({cls:"noria-card-secondary",text:this.text(`${result.recorded} 份有效记录 · ${result.matched} 份匹配笔记`,`${result.recorded} recorded · ${result.matched} matched notes`)});
    if(config.display!=="metric"||config.calculate==="distribution"){
      const chart=host.createDiv({cls:config.display==="trend"?"noria-stat-trend":"noria-stat-bars"});
      const max=Math.max(1,...result.groups.map(g=>Math.abs(g.value||0))),signed=result.groups.some(g=>g.value<0);if(signed)chart.addClass("noria-stat-signed");
      for(const group of result.groups){const button=chart.createEl("button",{cls:"noria-stat-bar",attr:{title:`${group.key}: ${number(group.value)}`}});
        button.createSpan({cls:"noria-stat-bar-label",text:config.display==="trend"&&/^\d{4}-\d{2}-\d{2}$/.test(group.key)?group.key.slice(5):group.key});const track=button.createSpan({cls:"noria-stat-bar-track"}),fill=track.createSpan();const ratio=Math.abs(group.value||0)/max;fill.style.setProperty("--noria-stat-ratio",String(ratio));
        if(signed){fill.style.setProperty("--noria-stat-start",`${group.value<0?50:50-ratio*50}%`);fill.style.setProperty("--noria-stat-extent",`${ratio*50}%`);fill.style.setProperty("--noria-stat-horizontal-start",`${group.value<0?50-ratio*50:50}%`);fill.classList.toggle("is-negative",group.value<0);}
        button.createSpan({cls:"noria-stat-bar-value",text:number(group.value)});button.onclick=()=>this.openRows(group.rows,result,group.key);
      }
    }
    if(!result.recorded)host.createDiv({cls:"noria-card-empty",text:this.text("此范围还没有可计算的记录。","No usable records in this range yet.")});
    if(result.invalid.length||result.unreadable?.length){const b=host.createEl("button",{cls:"noria-review-text-action",text:this.text(`${result.invalid.length+(result.unreadable?.length||0)} 份记录无法计算`,`${result.invalid.length+(result.unreadable?.length||0)} records could not be calculated`)});b.onclick=()=>this.openRows([...result.invalid,...result.unreadable||[]],result);}
  }
  openRows(rows,result,title=""){
    const modal=new Modal(this.app);const untrack=this.plugin.cards.trackModal(modal);modal.onClose=untrack;modal.setTitle(title||this.text("参与统计的记录","Source records"));
    const list=modal.contentEl.createDiv({cls:"noria-record-list"});for(const row of rows){const b=list.createEl("button",{cls:"noria-record-open",text:row.path});b.onclick=()=>this.app.workspace.openLinkText(row.path,"",true);if(row.error)b.createSpan({cls:"noria-card-secondary",text:row.error});}modal.open();
  }
  addForField(field,context){
    const {CardCatalog}=require("./card-catalog.js"),modal=new CardCatalog(this.plugin.cards,context);
    modal.onOpen=()=>{modal.modalEl.addClass("noria-card-catalog");modal.edit({id:`card-${crypto.randomUUID()}`,type:"extension",source:"noria:statistics",title:field.name,size:"medium",enabled:true,order:Date.now(),props:{source:"diary",property:field.property,calculate:field.type==="number"||field.type==="level"?"mean":"distribution",display:field.type==="number"||field.type==="level"?"trend":"bars",scope:"follow"}});};modal.open();
  }
  async renderDailySummary(host,range){
    host.addClass("noria-daily-record-card");
    const {Component}=require("obsidian"),component=new Component();component.load();let generation=0,timer;
    const paint=async()=>{const serial=++generation,available=this.plugin.records.definitions().filter(f=>f.enabled!==false);
      const shell=host.closest(".dashboard-home-widget-shell"),widget=this.plugin.settings.home?.widgets?.find(w=>w.id===shell?.dataset.noriaWidgetId);
      const selected=widget?.props?.dailyRecordFields,chosen=Array.isArray(selected)?available.filter(f=>selected.includes(f.id)):available;
      const fields=(chosen.length?chosen:available).slice(0,3);
      const results=await Promise.all(fields.map(field=>this.query({source:"diary",property:field.property,calculate:["number","level"].includes(field.type)?"mean":"distribution",display:["number","level"].includes(field.type)?"trend":"bars",...(range?{scope:"fixed",start:range.start,end:range.end}:{scope:"follow"})})));
      if(serial!==generation)return;host.empty();
      const head=host.createDiv({cls:"noria-card-heading"});const title=head.createDiv({cls:"dashboard-panel-title"});setIcon(title.createSpan({cls:"dashboard-card-heading-icon"}),"chart-no-axes-combined");title.createSpan({text:this.text("日常记录","Daily records")});
      const picker=iconButton(head,"sliders-horizontal",this.text("选择显示项目","Choose displayed fields"),()=>recordPopover(picker,this.text("显示项目 · 最多三项","Display up to three fields"),(pop,close)=>{
        const ids=new Set(fields.map(f=>f.id)),choices=[];
        for(const field of available){const label=pop.createEl("label",{cls:"noria-record-field-choice"}),input=label.createEl("input",{attr:{type:"checkbox"}});input.checked=ids.has(field.id);label.createSpan({text:field.name});choices.push(input);input.onchange=()=>{if(input.checked)ids.add(field.id);else ids.delete(field.id);choices.forEach(c=>c.disabled=!c.checked&&ids.size>=3);};}
        choices.forEach(c=>c.disabled=!c.checked&&ids.size>=3);
        const error=pop.createDiv({cls:"noria-card-error",attr:{role:"alert"}}),save=pop.createEl("button",{cls:"mod-cta",text:this.text("应用","Apply")});
        save.onclick=async()=>{if(!ids.size){error.setText(this.text("至少选择一项","Select at least one field"));return;}save.disabled=true;
          try{if(widget){await this.plugin.cards.saveHome({...widget,props:{...widget.props,dailyRecordFields:[...ids]}});close();}else close();}catch(e){error.setText(e.message);save.disabled=false;}};
      }));
      if(fields.length){const period=range||results[0].range;this.drawDailySeries(host,fields,results,period);}
      if(!fields.length)host.createDiv({cls:"noria-card-empty",text:this.text("选择想记录和回看的项目。","Choose the fields you want to record and review.")});
      if(shell)shell._noriaConfigureWidget=()=>this.plugin.records.manage();
    };const safePaint=()=>paint().catch(e=>{host.empty();host.createDiv({cls:"noria-card-empty",text:e.message});});await safePaint();const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>void safePaint(),180);};
    component.registerEvent(this.app.metadataCache.on("changed",refresh));component.registerEvent(this.app.vault.on("delete",refresh));component.register(()=>{++generation;clearTimeout(timer);});return ()=>component.unload();
  }
  drawDailySeries(host,fields,results,range){
    const {dates,series}=alignDailyRecords(results,range),count=dates.length;
    if(!count)return;
    const grid=host.createDiv({cls:"noria-daily-record-summary"}),previews=[];
    const number=value=>new Intl.NumberFormat(this.plugin.getNoriaLocale(),{maximumFractionDigits:2}).format(value);
    const open=()=>this.plugin.openDiaryInHome({selection:{mode:"daily",anchorDate:dates[selected]},intent:"record"});
    let selected=count-1;
    const footer=host.createDiv({cls:"noria-daily-record-footer"}),dateButton=footer.createEl("button",{cls:"noria-review-text-action"});dateButton.onclick=open;
    const select=index=>{selected=Math.max(0,Math.min(count-1,index));grid.style.setProperty("--noria-record-cursor",`${(selected+.5)/count*100}%`);dateButton.setText(dates[selected]);previews.forEach(({field,el},i)=>{const point=series[i][selected];el.setText(point.ambiguous?this.text("多份记录","Multiple records"):this.plugin.records.display(field,point.value));});};
    fields.forEach((field,index)=>{
      const points=series[index],numeric=["number","level"].includes(field.type),row=grid.createDiv({cls:"noria-daily-series"});
      row.style.setProperty("--noria-record-color",this.plugin.records.color(field));
      const label=row.createDiv({cls:"noria-daily-series-label"});setIcon(label.createSpan({cls:"noria-record-field-icon"}),field.icon||"circle");label.createSpan({text:field.name});
      const preview=label.createSpan({cls:"noria-daily-series-value"});previews.push({field,el:preview});
      const chart=row.createEl("button",{cls:"noria-daily-series-chart"+(numeric?" is-numeric":""),attr:{type:"button","aria-label":`${field.name} · ${this.text("左右键选择日期，回车打开日记","Arrow keys select a date; Enter opens its diary")}`}});
      const pointDate=event=>{const r=chart.getBoundingClientRect();select(Math.floor((event.clientX-r.left)/r.width*count));};
      chart.onpointermove=pointDate;chart.onpointerdown=pointDate;chart.onclick=open;
      chart.onkeydown=event=>{if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();select(selected+(event.key==="ArrowLeft"?-1:1));}else if(event.key==="Home"||event.key==="End"){event.preventDefault();select(event.key==="Home"?0:count-1);}};
      chart.onfocus=()=>select(selected);
      const svg=chart.ownerDocument.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox",`0 0 1000 ${numeric?68:32}`);svg.setAttribute("preserveAspectRatio","none");svg.setAttribute("aria-hidden","true");chart.append(svg);
      const draw=(tag,attrs)=>{const node=svg.ownerDocument.createElementNS(svg.namespaceURI,tag);for(const [name,value] of Object.entries(attrs))node.setAttribute(name,String(value));svg.append(node);return node;};
      if(numeric){
        const values=points.filter(p=>typeof p.value==="number").map(p=>p.value);
        const low=field.type==="level"?Number(field.min):Math.min(...values),high=field.type==="level"?Number(field.max):Math.max(...values);
        const y=value=>high===low?34:58-(value-low)/(high-low)*48;
        draw("line",{x1:0,x2:1000,y1:58,y2:58,class:"noria-series-baseline"});
        let previous=null;
        points.forEach((point,i)=>{if(typeof point.value!=="number"){previous=null;return;}const x=(i+.5)/count*1000,cy=y(point.value);
          if(previous)draw("line",{x1:previous.x,y1:previous.y,x2:x,y2:cy,class:"noria-series-line"});
          draw("circle",{cx:x,cy,r:3,class:"noria-series-point"});previous={x,y:cy};
        });
        if(values.length)chart.createSpan({cls:"noria-series-scale",text:(low===high?number(low):`${number(low)}–${number(high)}`)+(field.unit?` ${field.unit}`:"")});
      }else{
        const options=field.type==="toggle"?[false,true]:[...(field.options||[])];
        for(const point of points)if(point.value!=null&&!options.includes(point.value))options.push(point.value);
        points.forEach((point,i)=>{const rect=draw("rect",{x:i/count*1000+.8,y:7,width:Math.max(.4,1000/count-1.6),height:18,rx:2,class:point.value==null?"noria-series-missing":"noria-series-state"});
          if(point.value!=null)rect.style.setProperty("--noria-state-opacity",String(.3+(options.indexOf(point.value)+1)/Math.max(1,options.length)*.65));
        });
      }
      if(!results[index].recorded)chart.createSpan({cls:"noria-series-empty",text:this.text("尚未记录","No records yet")});
    });
    const axis=grid.createDiv({cls:"noria-daily-series-axis"});axis.createSpan();const ticks=axis.createDiv();
    for(const i of [...new Set([0,Math.floor((count-1)/2),count-1])]){const tick=ticks.createSpan({text:dates[i].slice(5),attr:{title:dates[i]}});tick.style.left=`${(i+.5)/count*100}%`;}
    const details=host.createEl("details",{cls:"noria-daily-record-details"});details.createEl("summary",{text:this.text("汇总与来源","Summary & sources")});
    fields.forEach((field,i)=>{const result=results[i],line=details.createDiv({cls:"noria-daily-record-detail"});line.createSpan({text:field.name});
      const numeric=["number","level"].includes(field.type),value=numeric?(result.value==null?"—":this.text("平均 ","Mean ")+number(result.value)+(field.unit?` ${field.unit}`:"")):result.groups.map(g=>`${this.plugin.records.display(field,field.type==="toggle"?g.key==="true":g.key)} ${g.value}`).join(" · ");
      line.createSpan({cls:"noria-card-secondary",text:value});const b=line.createEl("button",{cls:"noria-review-text-action",text:this.text(`${result.recorded} 份记录`,`${result.recorded} records`)});b.onclick=()=>this.openRows(result.rows,result);
      if(result.invalid.length||result.unreadable?.length){const invalid=line.createEl("button",{cls:"noria-review-text-action",text:this.text("查看未纳入的记录","Excluded records")});invalid.onclick=()=>this.openRows([...result.invalid,...result.unreadable||[]],result);}
    });
    select(selected);
  }
}
module.exports={PropertyStatCards};
