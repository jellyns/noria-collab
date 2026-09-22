"use strict";
const {Modal, setIcon} = require("obsidian");
const {normalizeDiaryCards} = require("./card-layout-model.js");
const {iconButton} = require("./card-controls.js");
const clone=value=>JSON.parse(JSON.stringify(value));

class CardCatalog extends Modal {
  constructor(system,context,id){super(system.app);this.system=system;this.plugin=system.plugin;this.context=context;this.id=id;this.generation=0;this.untrack=system.trackModal(this);}
  text(zh,en){return this.system.text(zh,en);}
  get widgets(){return this.context.page==="home"?this.plugin.settings.home.widgets:this.system.layout(this.context.mode).widgets;}
  onOpen(){this.modalEl.addClass("noria-card-catalog");const widget=this.widgets.find(item=>item.id===this.id);widget?this.edit(widget):this.list();}
  clean(){++this.generation;clearTimeout(this.timer);this.cleanupPreview?.();this.cleanupPreview=null;this.contentEl.empty();this.dirty=false;}
  list(){
    this.clean();this.setTitle(this.text("添加卡片","Add a card"));
    const search=this.contentEl.createEl("input",{cls:"noria-card-search",attr:{type:"search",placeholder:this.text("搜索用途或卡片名称","Search cards")}});
    const list=this.contentEl.createDiv({cls:"noria-card-catalog-list"});
    const entries=[];
    if(this.context.page==="home")for(const template of this.plugin.buildRuntimeBridgeConfig().homeWidgetDefaults||[]){
      if(!["builtin","stat"].includes(template.type)||["identity","today-actions","trends-range","review-focus"].includes(template.id))continue;
      entries.push({name:this.system.title(template),description:this.text("Noria 内置卡片","Built-in Noria card"),icon:"layout-panel-top",run:()=>this.edit({...clone(template),id:`card-${crypto.randomUUID()}`,builtinId:template.id,title:this.system.title(template),enabled:true,order:Date.now()})});
    }
    for(const provider of this.system.providers.values()){
      if(this.context.page==="home"&&provider.id==="noria:countdown")continue;
      entries.push({name:provider.title,description:provider.description,icon:provider.icon||"blocks",provider,
        run:()=>this.edit({id:`card-${crypto.randomUUID()}`,type:"extension",source:provider.id,title:provider.title,size:"medium",enabled:true,order:Date.now(),props:{}})});
    }
    const hidden=this.context.page==="home"?this.widgets.filter(w=>w.enabled===false):this.system.layout(this.context.mode).order.filter(id=>this.system.layout(this.context.mode).cards[id].hidden).map(id=>({id,title:this.diaryTitle(id)}));
    for(const item of hidden)entries.push({name:this.text("恢复 · ","Restore · ")+this.system.title(item),description:this.text("保留原内容和配置","Keeps the original contents and settings"),icon:"eye",run:async()=>{
      if(this.context.page==="home")await this.system.saveHome({...item,enabled:true});
      else await this.system.updateLayout(this.context.mode,layout=>{layout.cards[item.id].hidden=false;return layout;});this.close(true);
    }});
    const paint=()=>{list.empty();for(const item of entries.filter(e=>(e.name+" "+e.description).toLowerCase().includes(search.value.toLowerCase()))){
      const button=list.createEl("button",{cls:"noria-card-choice"});setIcon(button.createSpan({cls:"noria-card-choice-icon"}),item.icon);
      const info=button.createDiv();info.createEl("strong",{text:item.name});if(item.description)info.createDiv({cls:"noria-card-secondary",text:item.description});
      if(item.provider?.pluginId!=="noria"&&item.provider){const manifest=this.app.plugins.manifests[item.provider.pluginId];
        info.createDiv({cls:"noria-card-secondary",text:manifest?`${manifest.author || ""} · ${manifest.version} · ${this.app.plugins.plugins[manifest.id]?this.text("已启用","Enabled"):this.text("未启用","Disabled")}`:this.text("需要安装插件","Requires plugin installation")});}
      button.onclick=()=>{Promise.resolve(item.run()).catch(e=>this.showError(e));};
    }};search.oninput=paint;paint();search.focus();
  }
  diaryTitle(id){return this.widgets.find(w=>w.id===id)?.title||({focus:this.text("三件事","Priorities"),tasks:this.text("相关任务","Tasks"),habits:this.text("习惯记录","Habits")}[id]||id);}
  showError(error){const el=this.errorEl||this.contentEl.createDiv({cls:"noria-card-error",attr:{role:"alert"}});el.setText(error?.message||String(error));el.hidden=false;}
  field(parent,label,type,value,onChange,choices){
    const wrap=parent.createEl("label",{cls:"noria-card-field"});wrap.createSpan({text:label});let input;
    if(type==="select"){input=wrap.createEl("select");for(const item of choices||[])input.createEl("option",{text:item.label||item.value,value:item.value});}
    else input=wrap.createEl("input",{attr:{type:["number","checkbox","date"].includes(type)?type:"text"}});
    if(type==="checkbox")input.checked=!!value;else input.value=value??"";
    input.addEventListener(type==="select"||type==="checkbox"?"change":"input",()=>{onChange(type==="checkbox"?input.checked:type==="number"?(input.value===""?null:Number(input.value)):input.value);this.dirty=true;this.schedulePreview();});
    if(type==="file")this.plugin.attachHomeWidgetSourceSuggest(input,()=>this.draft?.source==="noria:note"?"note-base":"markdown");
    if(type==="property"||type==="folder"){
      const id=`noria-field-${crypto.randomUUID()}`,list=wrap.createEl("datalist",{attr:{id}});input.setAttribute("list",id);
      const values=type==="folder"?this.app.vault.getAllLoadedFiles().filter(f=>f.children).map(f=>f.path):[...new Set(this.plugin.filesUnderRoots(this.plugin.getScopeSpec("notes").roots,[".md"]).flatMap(f=>Object.keys(this.app.metadataCache.getFileCache(f)?.frontmatter||{})).filter(k=>k!=="position"))];
      for(const value of values.sort())list.createEl("option",{value});
    }return input;
  }
  edit(widget){
    this.clean();this.original=clone(widget);this.draft=clone(widget);this.setTitle(this.text("卡片设置","Card settings"));
    const head=this.contentEl.createDiv({cls:"noria-card-form-head"});iconButton(head,"arrow-left",this.text("返回卡片库","Back to cards"),()=>this.goBack());
    head.createSpan({cls:"noria-card-secondary",text:this.context.page==="home"?this.text("主页 · 仅修改此卡片","Home · This card only"):this.text("同周期日记共用","Shared by notes of this period")});
    const grid=this.contentEl.createDiv({cls:"noria-card-config-grid"}),form=grid.createDiv({cls:"noria-card-form"});
    this.field(form,this.text("名称","Title"),"text",this.system.title(widget),value=>this.draft.title=value);
    this.field(form,this.text("宽度","Width"),"select",widget.size||"medium",value=>this.draft.size=value,["small","medium","wide","full"].map(value=>({value,label:this.system.t(value)})));
    const provider=this.system.providers.get(widget.source);
    if(widget.type==="extension"){
      if(provider){
        const fields=typeof provider.fields==="function"?provider.fields(this.draft.props):provider.fields;
        const advancedKeys=new Set(["recursive","tag","group","filterProperty","filterValue","unitProperty"]);
        let advanced;
        for(const field of fields||[]){
          if(widget.source==="noria:statistics"&&advancedKeys.has(field.key)&&!advanced){advanced=form.createEl("details",{cls:"noria-card-advanced"});advanced.createEl("summary",{text:this.text("更多筛选与分组","More filters and grouping")});}
          const parent=widget.source==="noria:statistics"&&advancedKeys.has(field.key)?advanced:form;
          if(this.draft.props[field.key]===undefined&&field.default!==undefined)this.draft.props[field.key]=field.default;
          const control=this.field(parent,field.label,field.type,this.draft.props[field.key],value=>{this.draft.props[field.key]=value;if(field.refresh){const draft=clone(this.draft),top=this.contentEl.scrollTop;queueMicrotask(()=>{this.edit(draft);this.dirty=true;this.contentEl.scrollTop=top;[...this.contentEl.querySelectorAll("[data-card-field]")].find(el=>el.dataset.cardField===field.key)?.focus({preventScroll:true});});}},field.options);control.dataset.cardField=field.key;
        }
        if(advanced)form.append(advanced);
        if(provider.pluginId!=="noria"){
          const info=form.createDiv({cls:"noria-card-dependency"});info.createDiv({text:provider.description||provider.title});
          const install=info.createEl("button",{text:this.text("插件详情 / 安装 / 管理","Plugin details / install / manage")});install.onclick=()=>this.system.openPlugin(provider.pluginId);
          const check=info.createEl("button",{text:this.text("重新检查","Check again")});check.onclick=()=>this.preview();
        }
      }else form.createEl("p",{text:this.text("启用提供此卡片的插件后可继续配置。","Enable this card's provider to configure it.")});
    }else if(widget.type!=="builtin"&&widget.type!=="stat")this.field(form,this.text("源文件","Source file"),"file",widget.source,value=>this.draft.source=value);
    if((widget.builtinId||widget.id)==="habit-history-card")this.field(form,this.text("显示天数","History days"),"select",String(widget.props?.historyDays||21),value=>this.draft.props.historyDays=Number(value),[7,14,21,30,60,90].map(v=>({value:String(v),label:String(v)})));
    this.previewHost=grid.createDiv({cls:"noria-card-preview"});this.previewHost.setAttribute("aria-label",this.text("预览","Preview"));
    this.errorEl=this.contentEl.createDiv({cls:"noria-card-error",attr:{role:"alert"}});this.errorEl.hidden=true;
    this.footer=this.contentEl.createDiv({cls:"noria-card-form-footer"});
    const cancel=this.footer.createEl("button",{text:this.text("取消","Cancel")});cancel.onclick=()=>this.close();
    this.applyButton=this.footer.createEl("button",{text:this.text("应用","Apply"),cls:"mod-cta"});this.applyButton.onclick=()=>this.save();
    this.preview();
  }
  schedulePreview(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.preview(),250);}
  async preview(){
    const serial=++this.generation;this.cleanupPreview?.();this.cleanupPreview=null;this.previewHost.empty();
    this.previewHost.createDiv({cls:"noria-card-preview-label",text:this.text("预览","Preview")});
    if(this.draft.type==="extension"){
      const provider=this.system.providers.get(this.draft.source);
      this.applyButton.disabled=!provider||(provider.pluginId!=="noria"&&!this.app.plugins.plugins[provider.pluginId]);
      const cleanup=await this.system.render(this.draft,this.previewHost,this.context.selection);
      if(serial!==this.generation)cleanup();else this.cleanupPreview=cleanup;
    }else{
      const mount=this.previewHost.createDiv({cls:"noria-card-builtin-preview"});mount.inert=true;
      const cleanup=()=>mount.__noriaHomeCleanup?.();this.cleanupPreview=cleanup;
      await this.plugin.runNoriaView(".obsidian/plugins/noria/views/dashboard/home",{workbench:true,previewWidget:{...clone(this.draft),props:{...this.draft.props,lazy:false}}},mount);
      if(serial!==this.generation)cleanup();
    }
  }
  async save(){
    this.errorEl.hidden=true;this.applyButton.disabled=true;
    try{
      const provider=this.system.providers.get(this.draft.source);
      const fields=typeof provider?.fields==="function"?provider.fields(this.draft.props):provider?.fields||[];
      for(const field of fields)if(field.required&&!String(this.draft.props[field.key]??"").trim())throw Error(this.text("请填写：","Required: ")+field.label);
      for(const field of fields)if(field.type==="file"&&this.draft.props[field.key]&&!this.app.vault.getAbstractFileByPath(this.draft.props[field.key]))throw Error(this.text("找不到源文件","Source file not found"));
      await provider?.validate?.(this.draft.props);
      if(this.context.page==="home")await this.system.saveHome(this.draft);
      else {const ok=await this.system.updateLayout(this.context.mode,layout=>{
        const index=layout.widgets.findIndex(w=>w.id===this.draft.id);if(index<0)layout.widgets.push(clone(this.draft));else layout.widgets[index]=clone(this.draft);
        layout=normalizeDiaryCards(layout);layout.cards[this.draft.id].size=this.draft.size;return layout;
      });if(!ok)return;}
      this.close(true);
    }catch(error){this.showError(error);}finally{this.applyButton.disabled=false;}
  }
  confirmDiscard(action){
    if(!this.dirty){action();return;}
    if(this.discardEl?.isConnected)return;
    this.discardEl=this.contentEl.createDiv({cls:"noria-card-discard",attr:{role:"alert"}});
    this.discardEl.createSpan({text:this.text("还有未应用的修改。","You have unapplied changes.")});
    const keep=this.discardEl.createEl("button",{text:this.text("继续编辑","Keep editing")});keep.onclick=()=>this.discardEl.remove();
    const discard=this.discardEl.createEl("button",{text:this.text("放弃修改","Discard changes")});discard.onclick=()=>{this.dirty=false;action();};keep.focus();
  }
  goBack(){this.confirmDiscard(()=>this.list());}
  close(force=false){if(force){this.dirty=false;super.close();}else this.confirmDiscard(()=>super.close());}
  onClose(){this.clean();this.untrack?.();}
}
module.exports={CardCatalog};
