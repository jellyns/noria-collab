"use strict";
const obsidian = require("obsidian");
const D = require("./review-document.js");
const { createReviewDraftId } = require("./review-center-core.js");
const { createReviewMarkdownEditor } = require("./review-markdown-editor.js");
const {setActionIcon} = require("./workbench-controls.js");
const {TaskAdoptionActions}=require("./task-adoption.js");

// Review is a reading and writing surface inside the existing Noria workbench.
// Real Markdown supplies sections; quiet previews give way to one focused editor.
// Theme-native typography, at most two adjacent short sections, references on demand.
class ReviewWorkspace {
  constructor(renderer, parent) {
    this.renderer = renderer;
    this.parent = parent;
    this.plugin = renderer.plugin;
    this.app = this.plugin.app;
    this.mode = renderer.state.final.dirty || renderer.state.final.model.source === "empty" ? "edit" : "browse";
    this.components = [];
    this.referenceComponents = [];
    this.focusedIndex = -1;
    this.editPart = null;
    this.lastBody = "";
    this.build();
  }
  get state() { return this.renderer.state.final; }
  t(key, params) { return this.plugin.t("review.document." + key, params); }
  isViewOnly(part) { return /^(?: {0,3})(?:`{3,}|~{3,})(?:noria(?:-view)?|dataviewjs|dataview)\b/m.test(part.markdown) && !D.hasReviewContent(part.markdown); }
  action(parent, text, handler, className = "noria-review-text-action") {
    return this.renderer.createAction(parent, text, handler, className);
  }
  iconAction(parent, label, icon, handler) {
    return setActionIcon(this.action(parent, "", handler, "clickable-icon noria-workbench-icon"), icon, label);
  }
  showMenu(button, menu) {
    const rect = button.getBoundingClientRect();
    button.setAttribute("aria-expanded", "true");
    menu.onHide(() => {button.setAttribute("aria-expanded", "false");button.focus({preventScroll:true});});
    menu.showAtPosition({x:rect.right,y:rect.bottom,left:true},button.ownerDocument);
  }
  showOutline(button) {
    this.captureEditor();
    const menu = new obsidian.Menu();
    D.splitReviewSections(this.state.payload.body).forEach((part, index) => {
      if (this.isViewOnly(part)) return;
      menu.addItem(item => item.setTitle(part.title || this.t("opening"))
        .setChecked(index === this.focusedIndex)
        .onClick(() => {this.showPart(index);this.toolbar.querySelector("button")?.focus({preventScroll:true});}));
    });
    this.showMenu(button, menu);
  }
  build() {
    this.parent.empty();
    this.layout = this.parent.createDiv({ cls: "noria-review-final-first-layout noria-review-document-layout" });
    this.pane = this.layout.createDiv({ cls: "noria-review-final-pane" });
    this.pane.setAttribute("data-noria-review-final-first", this.renderer.selection.mode);
    this.toolbar = this.pane.createDiv({ cls: "noria-review-document-toolbar" });
    this.content = this.pane.createDiv({ cls: "noria-review-document-content" });
    this.taskAdoption=new TaskAdoptionActions({plugin:this.plugin,host:this.content,
      context:()=>({key:this.state.model.targetPath,path:this.state.model.targetPath,selection:this.renderer.selection,intent:"review",editor:this.editor,
        blocked:this.state.dirty||this.state.needsAdoption||this.state.blocked}),
      flush:()=>this.renderer.flushReviewEdits(),report:error=>{this.renderer.finalStatusEl.setText(error.message);this.feedback.hidden=false;}});
    this.feedback = this.pane.createDiv({ cls: "noria-review-document-feedback", attr: { "aria-live": "polite" } });
    this.renderer.finalStatusEl = this.feedback.createSpan({ cls: "noria-review-final-status" });
    this.errorActions = this.feedback.createDiv({ cls: "noria-review-document-error-actions" });
    this.reference = this.layout.createDiv({ cls: "noria-review-support-pane" });
    this.renderDocument();
    this.update();
  }
  disposeComponents(items) { for (const c of items.splice(0)) c.unload(); }
  renderMarkdown(parent, markdown, sourcePath, reference = false) {
    const component = new obsidian.Component();
    component.load();
    (reference ? this.referenceComponents : this.components).push(component);
    const el = parent.createDiv({ cls: "noria-review-prose markdown-rendered" });
    el.reviewComponent = component;
    // Embedded legacy dashboards may write to notes. A review preview only links
    // to these blocks; their source remains intact in the document editor.
    const safe = D.prepareReviewPreview(markdown, { sourcePath, viewLabel: this.t("sourceView") });
    const blockCheckbox = event => {
      if (event.target.closest?.('input[type="checkbox"], .task-list-item-checkbox')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    el.addEventListener("click", blockCheckbox, true);
    el.addEventListener("change", blockCheckbox, true);
    el.addEventListener("click", event => {
      const link = event.target.closest?.("a.internal-link");
      const target = link?.getAttribute("data-href");
      if (!target || !el.contains(link)) return;
      event.preventDefault(); event.stopPropagation();
      void this.app.workspace.openLinkText(target, sourcePath || "", true).catch(error => {
        console.error("[noria] review source link", error);
        new obsidian.Notice(String(error?.message || error));
      });
    });
    Promise.resolve(obsidian.MarkdownRenderer.render(this.app, safe, el, sourcePath || "", component)).then(() => {
      if (!el.isConnected) return;
      el.querySelectorAll('input[type="checkbox"]').forEach(input => { input.disabled = true; });
    }).catch(error => { if (el.isConnected) el.setText(String(error?.message || error)); });
    return el;
  }
  renderToolbar() {
    this.toolbar.empty();
    const nav = this.toolbar.createDiv({ cls: "noria-review-document-nav" });
    const parts = D.splitReviewSections(this.state.payload.body).map((part, index) => ({part, index})).filter(({part}) => !this.isViewOnly(part));
    const title = /^#{1,2}\s+(.+)/.exec(this.state.payload.body)?.[1] || "";
    const defaultTitles = /^(复盘|周复盘|月复盘|年复盘|Review|Weekly review|Monthly review|Yearly review)$/i;
    if (this.mode === "focus" || (this.mode === "edit" && this.editPart)) {
      this.iconAction(nav, this.t("back"), "arrow-left", () => this.showOverview());
    } else if (title && !defaultTitles.test(title)) nav.createSpan({ cls: "noria-review-document-title", text: title });
    const actions = this.toolbar.createDiv({ cls: "noria-review-document-actions" });
    if (this.mode === "edit") {
      this.iconAction(actions, this.t("read"), "book-open", () => this.showOverview());
    } else {
      this.iconAction(actions, this.t(this.mode === "focus" ? "editPart" : "editWhole"), "pencil", () => this.startEditing(this.mode === "focus" ? this.focusedIndex : -1));
    }
    this.renderer.finalSaveButton=null;
    if(this.state.needsAdoption || this.state.blocked)this.renderer.finalSaveButton=this.iconAction(actions,this.plugin.t(this.state.needsAdoption?"workbench.useDraft":"workbench.retrySave"),"save",()=>this.renderer.saveReviewFinal());
    const outline = this.iconAction(actions, this.plugin.t("workbench.outline"), "list", button => this.showOutline(button));
    outline.setAttribute("aria-haspopup", "menu");
    outline.disabled = !parts.length;
    const exists=!!this.app.vault.getAbstractFileByPath(this.state.model.targetPath);
    this.iconAction(actions, this.plugin.t(exists?"workbench.source":"workbench.createSource"), "file-text", async () => {
      await this.renderer.flushReviewEdits();
      if(this.app.vault.getAbstractFileByPath(this.state.model.targetPath))await this.plugin.openReviewSourceFile(this.state.model.targetPath);
      else if(!this.state.dirty){await this.plugin.openCalendarPeriodNote({period:this.renderer.selection.mode,date:this.renderer.selection.anchorDate,source:true,newLeaf:true});await this.renderer.reload();}
    });
    this.iconAction(actions, this.plugin.t("workbench.reload"), "refresh-cw", async () => {
      await this.renderer.flushReviewEdits();
      await this.renderer.reload();
    });
    const reference = this.referenceButton = this.iconAction(actions, this.t("reference"), "panel-right-open", () => this.renderer.setSupportMode("evidence"));
    reference.setAttribute("aria-expanded", this.renderer.state.support.mode && this.renderer.state.support.mode !== "drafts" ? "true" : "false");
    const drafts = this.state.model.preservedRecoveryDrafts || [];
    if (drafts.length) this.action(actions, this.t("drafts", { count: drafts.length }), () => this.renderer.setSupportMode("drafts"));
    const more = this.iconAction(actions, this.t("more"), "ellipsis", button => {
      const menu = new obsidian.Menu();
      this.taskAdoption.addMenuItems(menu,this.taskAdoption.takeMenuSelection());
      if(this.mode==="edit"){
        if (this.editPart) menu.addItem(item => item.setTitle(this.t("editWhole")).setIcon("pencil").onClick(() => this.startEditing(-1)));
        menu.addItem(item => item.setTitle(this.t("prompt")).setIcon("list-plus").onClick(() => this.insertPrompt()));
      }
      this.showMenu(button, menu);
    });
    more.setAttribute("aria-haspopup", "menu");
    this.taskAdoption.bindMoreButton(more,this.mode==="edit");
    this.renderer.syncFinalSaveUi();
  }
  startEditing(index = -1) {
    if (this.editor?.isComposing()) return;
    const position = index === -1 && this.editor ? this.editor.getPosition() : null;
    const offsets = position && Object.fromEntries(Object.entries(position).map(([key, value]) => [key, (this.editPart?.start || 0) + this.editor.editor.posToOffset(value)]));
    this.captureEditor();
    this.editPart = index >= 0 ? D.splitReviewSections(this.state.payload.body)[index] : null;
    this.focusedIndex = index;
    this.mode = "edit";
    this.editBaseline = this.state.payload.body;
    this.pendingPosition = offsets && Object.fromEntries(Object.entries(offsets).map(([key, offset]) => {
      const lines = this.state.payload.body.slice(0, offset).split("\n");
      return [key, { line: lines.length - 1, ch: lines.at(-1).length }];
    }));
    this.renderDocument();
    this.editor?.focus();
  }
  async showOverview() {
    if (this.editor?.isComposing()) return;
    this.captureEditor();
    const state=this.state;await this.renderer.flushReviewEdits();if(state!==this.state || state.dirty)return;
    const index = this.focusedIndex;
    this.mode = "browse";
    this.editPart = null;
    this.renderDocument();
    this.content.querySelector(`[data-review-part="${index}"] button`)?.focus();
  }
  async showPart(index) {
    if (this.editor?.isComposing()) return;
    this.captureEditor();
    const state=this.state;await this.renderer.flushReviewEdits();if(state!==this.state || state.dirty)return;
    this.focusedIndex = index;
    this.mode = "focus";
    this.renderDocument();
  }
  applyEditorValue(value) {
    if (value === this.editorValue) return;
    this.editorValue = value;
    this.state.payload.body = this.editPart ? D.replaceReviewPart(this.editBaseline, this.editPart, value) : value;
    this.lastBody = this.state.payload.body;
    this.renderer.markFinalDirty();
  }
  captureEditor() { if (this.editor) this.applyEditorValue(this.editor.editor.getValue()); }
  renderDocument() {
    this.editor?.dispose(); this.editor = null;
    this.disposeComponents(this.components);
    this.content.empty();
    this.lastBody = this.state.payload.body;
    this.renderToolbar();
    this.pane.setAttribute("data-noria-review-mode", this.mode);
    if (this.mode === "edit") {
      this.editBaseline = this.state.payload.body;
      this.editorValue = this.editPart ? this.editPart.markdown : this.state.payload.body;
      const host = this.content.createDiv({ cls: "noria-review-native-editor" });
      host.setAttribute("aria-label", this.t("editor"));
      try {
        this.editor = createReviewMarkdownEditor({
          app: this.app, container: host,
          file: this.app.vault.getAbstractFileByPath(this.state.model.targetPath),
          value: this.editorValue,
          position: this.pendingPosition,
          onChange: value => this.applyEditorValue(value),
          onSave: () => void this.renderer.saveReviewFinal(),
          onExit: () => this.showOverview(),
          onToggleMode:()=>this.showOverview()
        });
        this.pendingPosition = null;
      } catch (error) {
        host.createDiv({ cls: "noria-review-support-message is-error", text: this.t("editorUnavailable") });
        this.action(host, this.plugin.t("review.files.openSource"), () => this.plugin.openReviewSourceFile(this.state.model.targetPath));
        console.error("[noria] review Markdown editor", error);
      }
      if (!D.hasReviewContent(this.state.payload.body)) {
        const hint = this.content.createDiv({ cls: "noria-review-writing-hint" });
        hint.createSpan({ text: this.t("emptyHint") });
        this.action(hint, this.t("prompt"), () => this.insertPrompt());
      }
      return;
    }
    const parts = D.splitReviewSections(this.state.payload.body);
    const grid = this.content.createDiv({ cls: "noria-review-parts" });
    const selected = this.mode === "focus" ? [this.focusedIndex] : parts.map((part, index) => this.isViewOnly(part) ? -1 : index).filter(index => index >= 0);
    const compact = part => part.content.length <= 360 && !/^\s*(?:\||!\[|```|~~~)/m.test(part.content);
    const paired = new Set();
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i].title && parts[i + 1].title && compact(parts[i]) && compact(parts[i + 1])) { paired.add(i); paired.add(i + 1); i++; }
    }
    selected.forEach(index => {
      const part = parts[index]; if (!part) return;
      const card = grid.createEl("section", { cls: "noria-review-chapter" });
      card.setAttribute("data-review-part", String(index));
      card.classList.toggle("is-paired", paired.has(index) && this.mode !== "focus");
      card.classList.toggle("is-unheaded", !part.title);
      card.classList.toggle("is-focused", this.mode === "focus");
      const head = card.createDiv({ cls: "noria-review-chapter-head" });
      if (part.title) head.createEl("h3", { text: part.title });
      const edit = this.action(head, "", () => this.startEditing(index), "noria-review-icon-btn noria-review-chapter-edit");
      this.renderer.paintIcon(edit, "pencil", "✎");
      edit.setAttribute("aria-label", this.t("editNamed", { title: part.title || this.t("opening") }));
      const preview = this.mode === "focus" ? { markdown: part.content, truncated: false } : D.previewReviewPart(part.content);
      if (preview.markdown) {
        const text = this.renderMarkdown(card, preview.markdown, this.state.model.targetPath);
        text.classList.toggle("is-preview", preview.truncated);
      } else if (!part.content) this.action(card, this.t("writeHere"), () => this.startEditing(index));
      if (preview.truncated) this.action(card, this.t("expand"), () => this.showPart(index));
    });
  }
  insertPrompt() {
    this.captureEditor();
    const prompt = this.plugin.getNoriaLocale() === "zh"
      ? "\n\n### 值得记住的事\n\n\n### 从中想到的\n\n\n### 想继续或调整的\n\n"
      : "\n\n### What I want to remember\n\n\n### What it brings to mind\n\n\n### What I want to continue or adjust\n\n";
    // Inserting an outline is a deliberate edit, never the default saved record.
    this.state.payload.body = this.state.payload.body.replace(/\n+$/, "") + prompt;
    this.renderer.markFinalDirty();
    this.editPart = null; this.mode = "edit"; this.renderDocument(); this.editor?.focus();
  }
  renderDrafts(parent) {
    const drafts = this.state.model.preservedRecoveryDrafts || [];
    if (!drafts.length) { parent.createDiv({ text: this.t("noDrafts") }); return; }
    if (!drafts.some(d => d.draftId === this.selectedDraft)) this.selectedDraft = drafts[drafts.length - 1].draftId;
    const select = parent.createEl("select", { cls: "noria-review-draft-select", attr: { "aria-label": this.t("chooseDraft") } });
    drafts.forEach(d => select.createEl("option", { value: d.draftId, text: new Date(d.updatedAt).toLocaleString() }));
    select.value = this.selectedDraft;
    select.addEventListener("change", () => { this.selectedDraft = select.value; this.renderReference(true); });
    const entry = drafts.find(d => d.draftId === this.selectedDraft);
    const payload = D.normalizeReviewPayload(entry.payload, this.state.model.sectionHeading, this.state.model.savedPayload.body);
    const actions = parent.createDiv({ cls: "noria-review-draft-actions" });
    this.action(actions, this.t("useDraft"), async () => {
      await this.renderer.flushReviewRecoveryDraft();
      const existing = await this.plugin.readReviewRecoveryStore(true);
      this.state.model.preservedRecoveryDrafts = (existing.entries?.[this.state.model.targetKey] || []).filter(d => d.draftId !== entry.draftId);
      this.state.model.draftId = createReviewDraftId();
      this.state.model.recoveryDraft = entry;
      this.state.payload = payload;
      this.renderer.markFinalDirty("recovered");
      this.editPart = null; this.mode = "edit";
      this.renderer.state.support = { ...this.renderer.state.support, mode: "" };
      this.renderDocument(); this.update(); this.editor?.focus();
    });
    this.action(actions, this.plugin.t("review.final.copyRecovery"), async () => {
      try { await navigator.clipboard.writeText(payload.body); }
      catch (_) { const input = parent.createEl("textarea"); input.value = payload.body; input.focus(); input.select(); }
    });
    this.action(actions, this.plugin.t("review.final.discardRecovery"), async () => {
      try {
        const store = await this.plugin.clearReviewRecoveryEntry(this.state.model.targetKey, [entry]);
        this.state.model.preservedRecoveryDrafts = (store.entries?.[this.state.model.targetKey] || []).filter(d => d.draftId !== this.state.model.draftId && d.draftId !== this.state.model.recoveryDraft?.draftId);
        this.renderReference(true); this.renderToolbar();
      } catch (error) { this.state.saveState = "error"; this.state.error = String(error.message || error); this.update(); }
    });
    this.renderMarkdown(parent, payload.body, entry.targetPath, true);
  }
  renderReference(force = false) {
    const support = this.renderer.state.support;
    const wasOpen = !!this.lastSupport?.mode;
    if (!wasOpen && support.mode) {
      this.referenceReturnScroll = [];
      for (let el = this.layout.parentElement; el; el = el.parentElement) {
        if (el.scrollHeight > el.clientHeight) this.referenceReturnScroll.push({ el, top: el.scrollTop, left: el.scrollLeft });
      }
    }
    this.layout.setAttribute("data-noria-review-support-open", support.mode ? "true" : "false");
    this.reference.hidden = !support.mode;
    if (!force && this.lastSupport === support) return;
    this.lastSupport = support;
    this.disposeComponents(this.referenceComponents);
    this.reference.empty();
    if (!support.mode) {
      if (wasOpen) {
        if (this.editor) this.editor.focus();
        else this.referenceButton?.focus({ preventScroll: true });
        for (const item of this.referenceReturnScroll || []) { item.el.scrollTop = item.top; item.el.scrollLeft = item.left; }
        this.referenceReturnScroll = null;
      }
      return;
    }
    this.reference.setAttribute("data-noria-review-support", support.mode);
    if (support.mode === "drafts") {
      const header = this.reference.createDiv({ cls: "noria-review-support-head" });
      header.createSpan({ cls: "noria-review-support-title", text: this.t("chooseDraft") });
      this.action(header, this.plugin.t("runtime.common.close"), () => this.renderer.setSupportMode("drafts"));
      this.renderDrafts(this.reference.createDiv({ cls: "noria-review-support-content" }));
    } else this.renderer.renderReviewSupport(this.reference);
  }
  update() {
    if (this.lastBody !== this.state.payload.body) {
      this.editPart = null;
      this.mode = this.state.dirty ? "edit" : "browse";
      this.renderDocument();
    }
    this.content.inert = false;
    this.toolbar.inert = false;
    this.reference.inert = false;
    this.renderReference();
    this.referenceButton?.setAttribute("aria-expanded", this.renderer.state.support.mode && this.renderer.state.support.mode !== "drafts" ? "true" : "false");
    this.errorActions.empty();
    if (this.state.error) this.errorActions.createSpan({ cls: "noria-review-document-error", text: this.state.error });
    if (this.state.saveState === "conflict") {
      this.action(this.errorActions, this.plugin.t("review.final.keepDraftReload"), async () => {
        await this.renderer.flushReviewRecoveryDraft();
        this.renderer._forceFinalReload = true;
        await this.renderer.render();
      });
      this.action(this.errorActions, this.plugin.t("review.files.openSource"), () => this.plugin.openReviewSourceFile(this.state.model.targetPath));
    }
    this.renderer.syncFinalSaveUi();
    this.feedback.hidden = !this.renderer.getFinalSaveStateCopy() && !this.state.error;
  }
  renderPeriodReferences(parent) {
    const scope = this.referenceScope || this.renderer.selection;
    const box = parent.createDiv({ cls: "noria-review-period-reference" });
    const controls = box.createDiv({ cls: "noria-review-reference-picker" });
    const modes = scope.mode === "yearly" ? ["monthly", "daily"] : scope.mode === "monthly" ? ["weekly", "daily"] : ["daily"];
    const kind = modes.includes(this.referenceKind) ? this.referenceKind : modes[0];
    if (this.referenceScope) this.action(controls, this.t("back"), () => {
      this.referenceScope = null; this.referenceKind = ""; this.referencePeriod = ""; this.renderReference(true);
    });
    const mode = controls.createEl("select", { attr: { "aria-label": this.t("referenceKind") } });
    modes.forEach(value => mode.createEl("option", { value, text: value === "daily" ? this.t("records") : this.plugin.t("review.period." + value) }));
    mode.value = kind;
    mode.onchange = () => { this.referenceKind = mode.value; this.referencePeriod = ""; this.renderReference(true); };
    const dates = controls.createEl("select", { attr: { "aria-label": this.t("referenceDate") } });
    const content = box.createDiv({ cls: "noria-review-reference-body" });
    content.setText(this.plugin.t("review.support.loading"));
    void this.plugin.getReviewReferenceChoices(scope, kind).then(choices => {
      if (!box.isConnected) return;
      choices.forEach(choice => dates.createEl("option", { value: choice.selection.period, text: choice.selection.period + (choice.exists ? "" : " · " + this.t("notRecorded")) }));
      dates.value = choices.some(c => c.selection.period === this.referencePeriod) ? this.referencePeriod : (choices.filter(c => c.exists).at(-1) || choices.at(-1))?.selection.period || "";
      let readId = 0;
      let activePreview = null;
      const show = async () => {
        const id = ++readId;
        const choice = choices.find(c => c.selection.period === dates.value);
        this.referencePeriod = dates.value;
        if (activePreview) {
          activePreview.reviewComponent.unload();
          this.referenceComponents = this.referenceComponents.filter(component => component !== activePreview.reviewComponent);
          activePreview = null;
        }
        content.empty();
        if (!choice?.exists) { content.setText(this.t("notRecorded")); return; }
        try {
          const source = await this.plugin.loadTextFromVault(choice.targetPath);
          if (!box.isConnected || id !== readId) return;
          const actions = content.createDiv({ cls: "noria-review-reference-actions" });
          this.action(actions, this.plugin.t("review.files.openSource"), () => this.plugin.openReviewSourceFile(choice.targetPath));
          if (kind !== "daily") this.action(actions, this.t("traceRecords"), () => {
            this.referenceScope = choice.selection; this.referenceKind = "daily"; this.referencePeriod = ""; this.renderReference(true);
          });
          let records = source;
          if (kind === "daily" && choice.targetPath === this.state.model.targetPath) {
            const binding = D.readReviewDocument(source, [this.state.model.sectionHeading]);
            if (binding.exists) records = source.slice(0, binding.start) + source.slice(binding.end);
          }
          const body = kind === "daily" ? records.replace(/^---[\s\S]*?\n---\s*\n/, "") : D.readReviewDocument(source, [this.plugin.getReviewFinalSectionHeading(kind, source)]).markdown;
          if (body.trim()) activePreview = this.renderMarkdown(content, body, choice.targetPath, true);
          else content.createDiv({ text: this.t("notRecorded") });
        } catch (error) { if (box.isConnected && id === readId) content.setText(String(error.message || error)); }
      };
      dates.onchange = () => void show();
      void show();
    }).catch(error => { if (box.isConnected) content.setText(String(error.message || error)); });
  }
  dispose() {
    this.taskAdoption.dispose();
    this.editor?.dispose(); this.editor = null;
    this.disposeComponents(this.components);
    this.disposeComponents(this.referenceComponents);
  }
}

module.exports = { ReviewWorkspace };
