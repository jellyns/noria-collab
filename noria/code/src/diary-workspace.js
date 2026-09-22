"use strict";
const obsidian = require("obsidian");
const { DiaryDocumentStore, mergeKnownLineChange } = require("./diary-document.js");
const { createReviewMarkdownEditor } = require("./review-markdown-editor.js");
const { prepareReviewPreview, readReviewDocument } = require("./review-document.js");
const {projectDiaryTasks, diaryRange, shiftPeriod} = require("./diary-tasks.js");
const {DiaryHabitStore,withoutHabitRecords} = require("./diary-habits.js");
const {renderDiaryHabitRow} = require("./diary-habit-view.js");
const {DiaryCardLayout} = require("./diary-card-layout.js");
const {setActionIcon} = require("./workbench-controls.js");
const {renderWorkbenchTaskRow} = require("./task-row.js");
const {TaskAdoptionActions}=require("./task-adoption.js");
const {QuickCaptureComposer,decorateDiaryQuickNotes}=require("./quick-capture.js");
const {renderDailyStateControls}=require("./daily-state-controls.js");
const H = require("./runtime/views/dashboard/core/utils/habit-parsing.js");
const {scanAtxHeadings}=require("./runtime/views/dashboard/core/utils/diary-day-blocks.js");
const editorText = value => String(value || "").replace(/\r\n?/g,"\n");

// Date notes own the content. This reading surface adds a familiar calendar,
// a focused editor, and explicit routes to review and the native source note.
class DiaryWorkspace {
  constructor(workbench, host) {
    this.workbench = workbench;
    this.plugin = workbench.plugin;
    this.host = host;
    this.store = new DiaryDocumentStore(this.plugin);
    this.habitStore = new DiaryHabitStore(this.plugin);
    this.sessions = new Map();
    this.calendarState = {};
    this.generation = 0;
    this.intent = "record";
    this.intentScrolls = {};
    this.taskGeneration = 0;
    this.habitGeneration = 0;
    this.summaryGeneration = 0;
    this.root = host.createDiv({cls: "noria-diary"});
    this.toolbar = this.root.createDiv({cls: "noria-diary-toolbar"});
    this.layout = this.root.createDiv({cls: "noria-diary-layout"});
    this.calendarPanel = this.root.createDiv({cls:"noria-diary-date-picker",attr:{role:"region","aria-label":this.t("calendar")}});
    this.calendar = this.calendarPanel.createDiv({cls: "noria-diary-calendar"});
    const calendarActions = this.calendarPanel.createDiv({cls:"noria-diary-calendar-actions"});
    this.button(calendarActions,this.t("pinCalendar"),async()=>{this.closeCalendar();await this.plugin.openCalendarLeaf(this.selection);});
    this.button(calendarActions,this.t("close"),()=>this.closeCalendar());
    this.article = this.layout.createDiv({cls: "noria-diary-article"});
    this.actions = this.article.createDiv({cls: "noria-diary-actions"});
    this.feedback = this.article.createDiv({cls: "noria-diary-feedback", attr: {"aria-live": "polite"}});
    this.cardHost = this.article.createDiv({cls:"dashboard-home-root noria-diary-cards"});
    this.cards = new DiaryCardLayout(workbench, this.cardHost);
    this.focusHost = this.cards.add("focus", "noria-diary-tasks");
    this.taskHost = this.cards.add("tasks", "noria-diary-tasks");
    this.habitHost = this.cards.add("habits", "noria-diary-habits");
    this.summaryHost = this.article.createDiv({cls:"noria-diary-period-summary"});
    this.statsHost = this.article.createDiv({cls:"noria-diary-statistics"});
    this.statsHost.hidden = true;
    this.stateHost = this.article.createDiv({cls:"noria-diary-state"});
    this.captureHost = this.article.createDiv({cls:"noria-diary-capture-host"});
    this.content = this.article.createDiv({cls: "noria-diary-content"});
    this.taskAdoption=new TaskAdoptionActions({plugin:this.plugin,host:this.content,
      context:()=>this.session?{key:this.session.model.path,path:this.session.model.path,selection:this.selection,intent:"record",editor:this.editor,
        blocked:this.session.dirty||this.session.needsAdoption||this.session.blocked}:null,
      flush:()=>this.flush(),afterSaved:result=>this.adoptOwnWrite(this.session,result),report:error=>this.report(error)});
    this.draftsHost = this.article.createDiv({cls: "noria-diary-drafts"});
    this.reviewHost = this.layout.createDiv({cls:"noria-diary-review"});
    this.reviewHost.hidden = true;
    this.outsideClick = event => {
      if (this.root.classList.contains("is-calendar-open") && !event.composedPath().includes(this.calendarPanel) && !event.composedPath().includes(this.calendarToggle)) this.closeCalendar(false);
    };
    document.addEventListener("click",this.outsideClick);
    this.root.addEventListener("keydown",event=>{if(event.key === "Escape" && this.root.classList.contains("is-calendar-open")){event.preventDefault();this.closeCalendar();}});
  }
  t(key, params) { return this.plugin.t("workbench." + key, params); }
  button(host, label, action, cls = "", icon = "") {
    const button = host.createEl("button", {text: icon ? "" : label, cls: (icon ? "clickable-icon noria-workbench-icon " : "noria-review-text-action ") + cls, attr: {type: "button"}});
    if (icon) setActionIcon(button, icon, label);
    button.addEventListener("click", () => { Promise.resolve().then(() => action(button)).catch(error => this.report(error)); });
    return button;
  }
  report(error) {
    this.feedback.setText(error?.code === "diary-conflict" ? this.t("conflict") : error?.code === "diary-target" ? this.t("targetChanged") : String(error?.message || error));
    this.feedback.setAttribute("role", "alert");
  }
  capture() {
    if (this.editor && this.session) {
      this.session.body = this.editor.editor.getValue();
      this.session.dirty = this.session.body !== editorText(this.session.model.body);
      this.session.position = this.editor.getPosition();
    }
  }
  async flush() {
    clearTimeout(this.timer); this.timer = null;
    this.capture();
    const s = this.session;
    if (s) {await this.store.preserve(s.model, s.body);await this.save({acceptRecovery:false,retry:false});}
    await this.review?.flushReviewEdits();
  }
  async select(input, intent = this.intent || "record") {
    const token = ++this.generation;
    this.root.inert = true;
    try {
    await this.flush();
    await this.captureComposer?.preserve();
    if (token !== this.generation) return;
    const selection = this.plugin.resolveReviewSelection(input);
    const targetChanged = this.selection?.anchorDate !== selection.anchorDate;
    const key = `${selection.mode}:${selection.period}`;
    let s = this.sessions.get(key);
    if (!s || !s.dirty) {
      const loadingSession=s,loadingBody=s?.body,loadingRaw=s?.model.raw;
      const model = await this.store.load(selection);
      if (token !== this.generation) return;
      await this.flush();
      if (token !== this.generation) return;
      s = this.sessions.get(key);
      if (!s?.dirty && (!s || (s===loadingSession && s.body===loadingBody && s.model.raw===loadingRaw))) {
        const same = s?.model.raw === model.raw && s?.model.exists === model.exists;
        if (same) s.model.preservedDrafts = model.preservedDrafts;
        else {
        s = {model, body: editorText(model.recoveryDraft?.payload.body ?? model.body),
          dirty: !!model.recoveryDraft, needsAdoption:!!model.recoveryDraft,
          editing: !!model.recoveryDraft || !model.exists, position: null};
        this.sessions.set(key, s);
        }
      }
    }
    if (token !== this.generation) return;
    this.capture(); this.editor?.dispose(); this.editor = null;
    this.session = s;
    if(this.captureComposer && (selection.mode!=="daily" || this.captureComposer.date!==selection.anchorDate)) {
      this.captureComposer.dispose();this.captureComposer=null;
    }
    s.model.selection = selection;
    this.intent = intent;
    this.workbench && (this.workbench.intent = intent);
    this.calendarState.selectedDate = selection.anchorDate;
    if (targetChanged || !this.calendarState.anchor) {
      this.calendarState.anchor = selection.anchorDate.slice(0, 7);
      this.calendarState.weekOffset = null;
      this.calendarState.mode = "days";
    }
    this.calendarState.visibleWeeks = 6;
    this.renderToolbar();
    this.renderContent();
    await Promise.all([this.cards.setSelection(selection), this.renderCalendar(), this.contentReady, this.refreshTasks?.()]);
    await this.renderIntent?.();
    } finally {if (token === this.generation) this.root.inert = false;}
  }
  get selection() { return this.session?.model.selection; }
  renderToolbar() {
    this.toolbar.empty();
    const dates = this.toolbar.createDiv({cls:"noria-diary-date-controls"});
    this.previousButton = this.button(dates,this.t("previous"),()=>this.navigatePeriod(-1),"noria-period-arrow","chevron-left");
    this.calendarToggle = this.button(dates,this.selection.period,async()=>{
      if(this.root.classList.contains("is-calendar-open")){this.closeCalendar();return;}
      const visible=this.plugin.app.workspace.getLeavesOfType("noria-calendar").some(leaf=>{
        const el=leaf.view.hostEl,box=el?.getBoundingClientRect();return box?.width>0 && box?.height>0 && el.checkVisibility();
      });
      if(visible) {await this.plugin.openCalendarLeaf(this.selection);return;}
      this.root.classList.add("is-calendar-open");this.calendarToggle.setAttribute("aria-expanded","true");
      this.calendarPanel.style.top = `${this.toolbar.getBoundingClientRect().bottom-this.root.getBoundingClientRect().top}px`;
      await this.renderCalendar();this.calendar.querySelector("button")?.focus();
    },"noria-diary-date");
    this.calendarToggle.setAttribute("aria-expanded",String(this.root.classList.contains("is-calendar-open")));
    this.nextButton = this.button(dates,this.t("next"),()=>this.navigatePeriod(1),"noria-period-arrow","chevron-right");
    this.button(dates,this.t("current."+this.selection.mode),()=>this.select({mode:this.selection.mode,anchorDate:this.plugin.getLocalYmd()}));
    const intents = this.toolbar.createDiv({cls:"noria-diary-intents",attr:{role:"group","aria-label":this.t("diary")}});
    for(const intent of ["record","review"]){
      const b=this.button(intents,this.t(intent),()=>this.setIntent(intent));
      b.setAttribute("aria-pressed",String(this.intent === intent));
    }
    const select = this.toolbar.createDiv({cls: "noria-diary-periods", attr: {role: "group", "aria-label": this.t("period")}});
    for (const mode of ["daily", "weekly", "monthly", "yearly"]) {
      const b = this.button(select, this.plugin.getCalendarPeriodLabel(mode, true), () => this.select({mode, anchorDate: this.selection.anchorDate}));
      b.setAttribute("aria-pressed", String(mode === this.selection.mode));
    }
  }
  async navigatePeriod(direction) {
    await this.select(shiftPeriod(this.selection, direction));
    (direction < 0 ? this.previousButton : this.nextButton)?.focus({preventScroll:true});
  }
  async renderCalendar() {
    if (!this.root.classList.contains("is-calendar-open")) return;
    const bridge = this.plugin.buildRuntimeBridgeConfig();
    await this.plugin.runNoriaView("calendar", {mount: this.calendar, calendarState: this.calendarState, fixedWeeks: 6, browseHeader: true,
      onToday: date => this.chooseCalendarPeriod(this.selection.mode, date).catch(e => this.report(e)),
      noriaBridge: {...bridge, calendar: {...bridge.calendar, openPeriodNote: async ({period, date}) => {
        await this.chooseCalendarPeriod(period, date);
      }}}}, this.calendar);
  }
  async chooseCalendarPeriod(mode, date) {
    await this.select({mode: mode === "daily" ? this.selection.mode : mode, anchorDate: date});
    this.closeCalendar();
  }
  closeCalendar(focus = true) {
    this.root.classList.remove("is-calendar-open");
    this.calendarToggle?.setAttribute("aria-expanded", "false");
    if (focus) this.calendarToggle?.focus({preventScroll:true});
  }
  async setIntent(intent) {
    await this.flush();
    this.intentScrolls[this.intent] = this.host.scrollTop;
    this.intent = intent;this.workbench.intent = intent;
    this.closeCalendar(false);this.renderToolbar();await this.renderIntent();
    this.host.scrollTop = this.intentScrolls[intent] || 0;
    this.plugin.app.workspace.requestSaveLayout?.();
  }
  async renderIntent() {
    if(!this.reviewHost) return;
    const reviewing = this.intent === "review";
    this.article.hidden = reviewing;this.reviewHost.hidden = !reviewing;
    this.root.dataset.intent = this.intent;
    if(!reviewing) {await this.refreshDocument();return;}
    if(!this.review) this.review = await this.plugin.renderReviewCenterInHost(this.reviewHost,{selection:this.selection,expanded:true,workspacePage:true,sharedDateNavigation:true});
    else if(["mode","period","anchorDate"].some(k=>this.selection[k] !== this.review.selection[k])) await this.review.setSelection(this.selection);
    else await this.review.reload();
  }
  clearContent() { this.editor?.dispose(); this.editor = null; this.component?.unload(); this.component = null; this.content.empty(); }
  renderActions() {
    this.actions.empty();
    this.button(this.actions,this.plugin.cards.text("添加卡片","Add a card"),()=>this.plugin.cards.catalog({page:"diary",mode:this.selection.mode,selection:this.selection}),"","layout-grid");
    const s = this.session;
    if(this.selection.mode==="daily") {
      const capture=this.button(this.actions,this.t("quickCapture"),()=>this.toggleCapture(),"","square-pen");
      capture.setAttribute("aria-expanded",String(!!this.captureComposer && !this.captureHost.hidden));
    }
    if (s.editing) {
      this.button(this.actions, this.t("read"), () => this.toggleEditing(),"","book-open");
    } else this.button(this.actions, this.t("edit"), () => {s.editing = true; this.renderContent(); this.editor?.focus();},"","pencil");
    this.outlineButton = this.button(this.actions,this.t("outline"),button=>this.showOutline(button),"","list");
    this.outlineButton.setAttribute("aria-haspopup","menu");
    this.sourceButton = this.button(this.actions, this.t(s.model.exists?"source":"createSource"), async () => {
      await this.flush();
      if(s.model.exists) await this.plugin.openCalendarNoteFile(s.model.path,{newLeaf:true});
      else if(!s.dirty) {await this.plugin.openCalendarPeriodNote({period:s.model.selection.mode,date:s.model.selection.anchorDate,source:true,newLeaf:true});await this.refreshDocument();}
    },"","file-text");
    if (s.needsAdoption || s.blocked) this.button(this.actions,this.t(s.needsAdoption?"useDraft":"retrySave"),()=>this.save({acceptRecovery:true,retry:true}),"","save");
    if (s.needsAdoption || s.blocked) this.button(this.actions, this.t("copy"), async () => {
      this.capture(); await navigator.clipboard.writeText(s.body); this.feedback.setText(this.t("copied"));
    },"","copy");
    this.button(this.actions, this.t("reload"), async () => {
      await this.flush();
      this.sessions.delete(`${this.selection.mode}:${this.selection.period}`);
      await this.select(this.selection);
    },"","refresh-cw");
    const more=this.button(this.actions,this.plugin.t("review.document.more"),button=>{
      const menu=new obsidian.Menu();this.taskAdoption.addMenuItems(menu,this.taskAdoption.takeMenuSelection());
      const rect=button.getBoundingClientRect();menu.showAtPosition({x:rect.right,y:rect.bottom,left:true},button.ownerDocument);
    },"","ellipsis");
    more.setAttribute("aria-haspopup","menu");
    this.taskAdoption.bindMoreButton(more);
  }
  async toggleEditing() {
    if(this.editor?.isComposing())return;
    const s=this.session;
    if(s.editing){await this.flush();if(s!==this.session || s.dirty)return;s.editing=false;}
    else s.editing=true;
    this.renderContent();if(s.editing)this.editor?.focus();
  }
  toggleCapture() {
    if(this.captureComposer) {this.captureHost.hidden=!this.captureHost.hidden;}
    else {
      const session=this.session;
      this.captureHost.hidden=false;
      this.captureComposer=new QuickCaptureComposer({plugin:this.plugin,host:this.captureHost,date:this.selection.anchorDate,
        beforeSave:async()=>{await this.flush();return session===this.session && !session.dirty && !session.blocked && !session.needsAdoption;},
        onSaved:async result=>{await this.adoptOwnWrite(session,result.write);await this.refreshDocument();}});
      void this.captureComposer.ready.catch(e=>this.captureComposer?.report(e));
    }
    this.renderActions();
    if(!this.captureHost.hidden)this.captureComposer.focus();
  }
  renderDailyState() {
    this.stateHost.empty();
    if(this.selection.mode!=="daily")return;
    const session=this.session;
    renderDailyStateControls({plugin:this.plugin,host:this.stateHost,date:this.selection.anchorDate,raw:session.model.raw,
      context:{page:"diary",mode:this.selection.mode,selection:{...this.selection}},
      beforeSave:async()=>{await this.flush();return session===this.session && !session.dirty && !session.blocked && !session.needsAdoption;},
      onSaved:async result=>{await this.adoptOwnWrite(session,result.write);this.renderDailyState();},report:e=>this.report(e)});
  }
  renderContent() {
    this.capture(); this.clearContent(); this.renderActions();
    this.contentReady = Promise.resolve();
    const s = this.session;
    this.renderDailyState();
    this.feedback.removeAttribute("role");
    this.feedback.setText(s.needsAdoption?this.t("reviewRecovery"):s.blocked?this.t("conflict"):"");
    if (s.editing) {
      const host = this.content.createDiv({cls: "noria-diary-editor"});
      const file = this.plugin.app.vault.getAbstractFileByPath(s.model.path);
      this.editor = createReviewMarkdownEditor({app: this.plugin.app, container: host, file, value: s.body, position: s.position,
        onChange: body => {
          s.body = body; s.dirty = body !== editorText(s.model.body);s.needsAdoption=false;
          if(!s.blocked)this.feedback.setText("");
          clearTimeout(this.timer); this.timer = setTimeout(() => {void this.flush().catch(e => this.report(e));}, 400);
        }, onSave: () => this.save({acceptRecovery:true,retry:true}), onExit: () => {void this.toggleEditing().catch(e=>this.report(e));},
        onToggleMode:()=>this.toggleEditing()
      });
    } else {
      const prose = this.content.createDiv({cls: "markdown-rendered noria-diary-prose"});
      this.component = new obsidian.Component(); this.component.load();
      let displayed = s.body;
      try {
        const heading=this.plugin.getReviewFinalSectionHeading(this.selection.mode,s.model.raw);
        const review=readReviewDocument(displayed,[heading]);
        if(review.exists) displayed=displayed.slice(0,review.start)+displayed.slice(review.end);
      } catch (_) { /* Ambiguous boundaries remain visible in the native document. */ }
      if(this.selection.mode === "daily" && this.selection.anchorDate<=this.plugin.getLocalYmd()) displayed=withoutHabitRecords(displayed,this.selection.anchorDate);
      const safe = prepareReviewPreview(displayed, {sourcePath: s.model.path, viewLabel: this.t("source")});
      prose.addEventListener("click", event => {
        if (event.target.closest?.('input[type="checkbox"]')) {event.preventDefault();event.stopImmediatePropagation();}
      }, true);
      prose.addEventListener("click", event => {
        const link = event.target.closest?.("a.internal-link");
        if (link?.dataset.href) {event.preventDefault(); void this.plugin.app.workspace.openLinkText(link.dataset.href, s.model.path, true).catch(e => this.report(e));}
      });
      this.contentReady = Promise.resolve(obsidian.MarkdownRenderer.render(this.plugin.app, safe, prose, s.model.path, this.component)).then(() => {
        if(s.model.selection.mode==="daily")decorateDiaryQuickNotes(prose,this.t("quickCaptureUntimed"));
        prose.querySelectorAll('input[type="checkbox"]').forEach(el => {el.disabled = true;});
      }).catch(e => this.report(e));
    }
    this.renderDrafts();
  }
  renderDrafts() {
    this.draftsHost.empty();
    const s = this.session, drafts = s.model.preservedDrafts || [];
    if (!drafts.length) return;
    const details = this.draftsHost.createEl("details");
    details.createEl("summary", {text: `${this.t("recover")} (${drafts.length})`});
    const select = details.createEl("select", {attr: {"aria-label": this.t("recover")}});
    drafts.forEach((d, i) => select.createEl("option", {text: new Date(d.updatedAt).toLocaleString(), value: String(i)}));
    const preview = details.createEl("textarea", {attr: {readonly: "", "aria-label": this.t("draftContent")}});
    const update = () => {preview.value = drafts[Number(select.value) || 0].payload?.body || "";};
    select.addEventListener("change", update); update();
    this.button(details, this.t("copy"), () => navigator.clipboard.writeText(preview.value));
    this.button(details, this.t("useDraft"), async () => {await this.flush(); s.body = preview.value; s.dirty = true; s.editing = true;s.needsAdoption=false;s.blocked=false; this.editor?.dispose(); this.editor = null; await this.store.preserve(s.model,s.body); this.renderContent();await this.save({acceptRecovery:true,retry:true});});
  }
  async save({acceptRecovery=true,retry=true}={}) {
    this.capture();const s=this.session;if(!s)return true;
    if(acceptRecovery)s.needsAdoption=false;if(retry)s.blocked=false;
    if(s.savePromise)return s.savePromise;
    if(!s.dirty)return true;
    if(s.needsAdoption || s.blocked)return false;
    if(this.editor?.isComposing()){clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush().catch(e=>this.report(e));},400);return false;}
    this.saving=true;
    s.savePromise=(async()=>{
      try {
        while(s.dirty){
          if(s===this.session)this.capture();
          if(this.editor?.isComposing())break;
          const submitted=s.body,model=await this.store.save(s.model,submitted);
          if(s===this.session)this.capture();
          const saved=editorText(model.body);
          const body=s.body===submitted?saved:saved===submitted?s.body:mergeKnownLineChange(submitted,s.body,saved);
          if(body===null){const error=new Error(this.t("conflict"));error.code="diary-conflict";throw error;}
          s.model=model;s.dirty=body!==saved;s.needsAdoption=false;
          if(s===this.session && this.editor){
            if(s.body!==body){const position=this.editor.getPosition();this.editor.setValue(body);this.editor.editor.setSelection(position.anchor,position.head||position.anchor);}
            this.editor.setFile?.(this.plugin.app.vault.getAbstractFileByPath(model.path));
          }
          s.body=body;
          if(s.dirty)await this.store.preserve(s.model,s.body);
        }
        if(s===this.session && !this.disposed){this.renderActions?.();this.feedback.setText(s.model.recoveryCleared===false?this.t("savedDraftRetained"):"");}
        if(s.dirty && !this.disposed){clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush().catch(e=>this.report(e));},400);}
        return !s.dirty;
      } catch(error){s.blocked=true;await this.store.preserve(s.model,s.body);if(s===this.session && !this.disposed){this.report(error);this.renderActions?.();}return false;}
    })();
    try{return await s.savePromise;}finally{s.savePromise=null;this.saving=false;}
  }
  async refresh() {
    await this.refreshTasks?.();
    if(this.intent === "review") {await this.review?.reload();return;}
    await this.refreshDocument();
  }
  async refreshDocument() {
    const s = this.session;
    if (!s || s.dirty || this.saving) return;
    const latest = await this.store.load(s.model.selection);
    if (s !== this.session || s.dirty || this.saving) return;
    if (latest.path !== s.model.path || latest.raw !== s.model.raw || latest.exists !== s.model.exists) {
      const top = this.host.scrollTop;
      await this.select(s.model.selection);
      this.host.scrollTop = top;
    }
  }
  showOutline(button = this.outlineButton) {
    const show = menu => {
      const rect = button.getBoundingClientRect();
      button.setAttribute("aria-expanded","true");
      menu.onHide(() => {button.setAttribute("aria-expanded","false");button.focus({preventScroll:true});});
      menu.showAtPosition({x:rect.right,y:rect.bottom,left:true},button.ownerDocument);
    };
    if(this.editor) {
      const headings=scanAtxHeadings(this.editor.editor.getValue()),menu=new obsidian.Menu();
      if(!headings.length){this.feedback.setText(this.t("noHeadings"));return;}
      headings.forEach(h=>menu.addItem(item=>item.setTitle(h.title).onClick(()=>{
        const pos=this.editor.editor.offsetToPos(h.start);this.editor.editor.setCursor(pos);this.editor.editor.scrollIntoView({from:pos,to:pos},true);this.editor.focus();
      })));
      show(menu);return;
    }
    const headings=Array.from(this.content.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    const menu=new obsidian.Menu();
    if(!headings.length) {this.feedback.setText(this.t("noHeadings"));return;}
    headings.forEach(el=>menu.addItem(item=>item.setTitle(el.textContent).onClick(()=>el.scrollIntoView({block:"start"}))));
    show(menu);
  }
  async toggleStatistics(force = false) {
    if(!force) this.statsHost.hidden=!this.statsHost.hidden;
    if(this.statsHost.hidden) return;
    this.statsHost.empty();
    const range=diaryRange(this.selection);
    this.statsHost.createDiv({cls:"noria-diary-section-heading",text:this.t("statistics")});
    const mount=this.statsHost.createDiv();
    await this.plugin.runNoriaView("periodicStats",{scope:this.selection.mode,preset:this.selection.mode,dateRange:range},mount,this.session.model.path);
  }
  async refreshTasks() {
    if(!this.taskHost || !this.selection) return;
    const generation=++this.taskGeneration, selection={...this.selection}, path=this.session.model.path;
    try {
      const tasks=await this.plugin.getRuntimeTaskRows("tasks");
      if(generation !== this.taskGeneration || this.selection.period !== selection.period) return;
      this.tasks=projectDiaryTasks(tasks,selection,path,this.plugin.getLocalYmd());
      this.renderTasks();
      await Promise.all([this.refreshHabits(),this.refreshPeriodSummary()]);
      if(!this.statsHost.hidden) await this.toggleStatistics(true);
    } catch(error){if(generation === this.taskGeneration) this.report(error);}
  }
  renderTasks() {
    const data=this.tasks;if(!data) return;
    const expanded=this.session.taskExpanded || (this.session.taskExpanded={});
    const opened=this.taskHost.querySelector("details")?.open;
    this.root.dataset.currentPeriod=String(data.current);
    const group=(id,title,rows)=>{
      const area=this.cards.section(id,title,rows.length).body;
      const list=area.createDiv({cls:"noria-diary-task-list"});
      rows.slice(0,expanded[id]?undefined:3).forEach(row=>this.renderTaskRow(list,row));
      if(rows.length>3&&!expanded[id]) {
        const more=this.button(area,this.t("allTasks",{count:rows.length}),()=>{expanded[id]=true;more.remove();rows.slice(3).forEach(row=>this.renderTaskRow(list,row));});
      }
      return area;
    };
    this.cards.setAvailable("focus",!!data.focus.length);
    this.cards.setAvailable("tasks",!!data.pending.length||!!data.done.length||!data.focus.length);
    if(data.focus.length)group("focus",this.t("focus."+this.selection.mode),data.focus);
    const pending=group("tasks",this.t(data.focus.length?"otherTasks":"tasks"),data.pending);
    if(!data.focus.length&&!data.pending.length)pending.createDiv({cls:"noria-diary-task-empty",text:this.t("noTasks")});
    if(data.done.length){const done=pending.createEl("details");done.open=opened===true||this.taskFocus?.completed===true;done.createEl("summary",{text:this.t("completedTasks",{count:data.done.length})});data.done.forEach(row=>this.renderTaskRow(done,row));}
    if(this.taskFocus) {
      const target=this.taskFocus;
      const row=[...this.root.querySelectorAll(".noria-workbench-task-row")].find(el=>el.dataset.sourcePath===target.path&&Number(el.dataset.sourceLine)===target.line);
      row?.querySelector(target.control==="checkbox"?"input[type=checkbox]":".noria-diary-task-title")?.focus({preventScroll:true});
    }
    this.taskFocus=null;
  }
  async refreshHabits() {
    if(!this.habitHost || !this.selection) return;
    const selection={...this.selection}, generation=++this.habitGeneration;
    const available=selection.mode !== "daily" || selection.anchorDate<=this.plugin.getLocalYmd();
    this.cards.setAvailable("habits",available);
    if(!available) return;
    if(selection.mode!=="daily"){
      const service=await this.plugin.createDataService({});
      const snapshot=await service.getSnapshot({range:{mode:"custom",...diaryRange(selection)},include:["habits"]});
      if(generation!==this.habitGeneration)return;
      const {body}=this.cards.section("habits",this.t("habits"));
      for(const item of snapshot.domains.habits?.items||[]){
        const row=body.createEl("details",{cls:"noria-period-habit"}),summary=row.createEl("summary");
        summary.createSpan({text:item.name});summary.createSpan({cls:"noria-card-secondary",text:this.plugin.cards.text(`${item.checked} 次打卡`,`${item.checked} check-ins`)});
        const dates=row.createDiv({cls:"noria-period-habit-dates"});
        for(const day of item.heatmap?.series||[])if(day.checked){const b=dates.createEl("button",{text:day.date,cls:"noria-review-text-action"});b.onclick=()=>this.select({mode:"daily",anchorDate:day.date});}
      }
      if(!body.children.length)body.createSpan({cls:"noria-card-secondary",text:this.plugin.cards.text("本期还没有习惯记录","No habit records for this period")});
      return;
    }
    const data=await this.habitStore.load(selection.anchorDate);
    if(generation !== this.habitGeneration || selection.anchorDate !== this.selection.anchorDate) return;
    const records=new Map(data.records.map(r=>[r.name,r]));
    const configs=new Map(data.active.map(c=>[c.name,c]));
    data.records.forEach(r=>configs.set(r.name,{...configs.get(r.name),...H.inferLegacyHabitConfig(r.text),name:r.name,id:r.id,aliases:r.aliases}));
    const names=selection.anchorDate === this.plugin.getLocalYmd() ? [...configs.keys()] : [...records.keys()];
    const card=this.cards.section("habits",this.t("habits"));
    const heading=card.tools;
    this.button(heading,this.t("habitBackfill"),()=>{
      const menu=new obsidian.Menu();
      data.active.filter(c=>!names.includes(c.name)).forEach(cfg=>menu.addItem(item=>item.setTitle(cfg.name).onClick(()=>{names.push(cfg.name);this.renderHabitRow(list,cfg,null,selection.anchorDate);})));
      if(!data.active.some(c=>!names.includes(c.name))) menu.addItem(item=>item.setTitle(this.plugin.t("runtime.habits.editParams")).onClick(()=>this.plugin.openCalendarNoteFile(data.registryPath,{newLeaf:true})));
      const rect=heading.getBoundingClientRect();menu.showAtPosition({x:rect.right-160,y:rect.bottom});
    },"","plus");
    const list=card.body.createDiv({cls:"noria-diary-habit-list"});
    names.forEach(name=>this.renderHabitRow(list,configs.get(name),records.get(name),selection.anchorDate));
    if(!names.length) list.createSpan({cls:"noria-diary-task-empty",text:this.plugin.cards.text(data.active.length?"这天还没有打卡记录":"还没有设置习惯",data.active.length?"No habit records for this date":"No habits configured")});
  }
  async refreshPeriodSummary() {
    if(!this.summaryHost) return;
    const selection={...this.selection};
    this.summaryHost.hidden=selection.mode === "daily";
    if(this.summaryHost.hidden) return;
    const generation=++this.summaryGeneration;
    const service=await this.plugin.createDataService({});
    const snapshot=await service.getSnapshot({range:{mode:"custom",...diaryRange(selection)},include:["tasks","habits","notes"]});
    if(generation !== this.summaryGeneration || this.selection.mode !== selection.mode || this.selection.period !== selection.period) return;
    this.summaryHost.empty();
    this.summaryHost.createSpan({text:this.t("periodSummary",{tasks:snapshot.domains.tasks?.completion?.completed || 0,habits:snapshot.domains.habits?.summary?.checked || 0,words:snapshot.domains.notes?.diaryWords?.total || 0})});
    this.button(this.summaryHost,this.t("statistics"),()=>this.toggleStatistics());
  }
  renderHabitRow(parent,config,record,date) {
    return renderDiaryHabitRow({parent,plugin:this.plugin,config,record,onSave:async(done,value)=>{
      const session=this.session;
      try {await this.flush();const result=await this.habitStore.write({config,date,done,value});await this.adoptOwnWrite(session,result);await this.refresh();
        [...this.habitHost.querySelectorAll(".noria-diary-habit-row")].find(row=>row.dataset.habit===config.name)?.querySelector("button")?.focus({preventScroll:true});return true;}
      catch(error){this.report(error);return false;}
    }});
  }
  async adoptOwnWrite(session,result) {
    if(session===this.session)this.capture();
    const rebased=this.store.rebaseKnownWrite(session.model,session.body,result);
    if(!rebased)return;
    session.model=rebased.model;session.body=rebased.body;session.dirty=session.body!==session.model.body;
    if(session===this.session && this.editor) {
      const position=this.editor.getPosition();this.editor.setValue(session.body);
      this.editor.editor.setSelection(position.anchor,position.head||position.anchor);
    } else if(session===this.session)this.renderContent();
    await this.store.preserve(session.model,session.body);
  }
  renderTaskRow(parent,row) {
    const session=this.session;
    return renderWorkbenchTaskRow(this.plugin,parent,row.task,{
      beforeWrite:()=>this.flush(),onSaved:async(result,task,control)=>{
        if(session===this.session)this.taskFocus={path:task.path,line:task.line,completed:task.completed,control};
        await this.adoptOwnWrite(session,result);
      }
    });
  }
  dispose() {
    this.cards.dispose();
    this.captureComposer?.dispose();
    this.taskAdoption.dispose();
    ++this.generation;++this.taskGeneration;++this.habitGeneration;++this.summaryGeneration; void this.flush().catch(() => {});this.disposed=true; clearTimeout(this.timer);
    this.review?.unload();document.removeEventListener("click",this.outsideClick);
    this.clearContent(); this.calendar.__noriaCalendarResizeObserver?.disconnect();
    if (this.calendar.__noriaCalendarKeydown) document.removeEventListener("keydown", this.calendar.__noriaCalendarKeydown);
  }
}
module.exports = { DiaryWorkspace };
