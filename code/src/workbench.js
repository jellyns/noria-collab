"use strict";
const { DiaryWorkspace } = require("./diary-workspace.js");
const PAGES = ["home", "diary"];

// The workbench keeps one quiet navigation row above independent scroll areas.
// Home keeps its composition; date writing and review receive their own space.
// Obsidian colors, fonts and calendar geometry remain the visual authority.
class NoriaWorkbench {
  constructor(view, initial = {}) {
    this.view = view; this.plugin = view.plugin; this.host = view.hostEl;
    this.active = initial.page === "review" ? "diary" : PAGES.includes(initial.page) ? initial.page : "home";
    this.intent = initial.page === "review" || initial.intent === "review" ? "review" : "record";
    this.selection = this.plugin.resolveReviewSelection(initial.selection || {});
    this.pages = new Map(); this.loads = new Map(); this.serial = 0;
    this.scrolls = {...(initial.scrolls || {})};
    this.diaryCards = initial.diaryCards;
    const id = `noria-workbench-${Math.random().toString(36).slice(2)}`;
    this.nav = this.host.createDiv({cls: "noria-workbench-nav", attr: {role: "tablist", "aria-label": this.t("navigation")}});
    this.body = this.host.createDiv({cls: "noria-workbench-pages"});
    for (const page of PAGES) {
      const button = this.nav.createEl("button", {text: this.t(page), attr: {type: "button", role: "tab", id: `${id}-${page}-tab`, "aria-controls": `${id}-${page}`}});
      button.addEventListener("click", () => {void this.show(page).catch(e => this.error(e));});
      button.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = event.key === "Home" ? 0 : event.key === "End" ? PAGES.length - 1 : (PAGES.indexOf(page) + (event.key === "ArrowRight" ? 1 : PAGES.length - 1)) % PAGES.length;
        void this.show(PAGES[index]).then(() => this.pages.get(PAGES[index]).button.focus()).catch(e => this.error(e));
      });
      const panel = this.body.createDiv({cls: `noria-workbench-page noria-workbench-page--${page}`, attr: {role: "tabpanel", id: `${id}-${page}`, "aria-labelledby": button.id}});
      panel.hidden = page !== this.active;
      this.pages.set(page, {button, panel});
    }
  }
  t(key) {return this.plugin.t("workbench." + key);}
  error(error) {this.pages.get(this.active)?.panel.createDiv({cls: "noria-itemview-error", text: String(error?.message || error)});}
  async ensure(page) {
    if (this.loads.has(page)) return this.loads.get(page);
    const panel = this.pages.get(page).panel;
    const load = (async () => {
      if (page === "home") await this.plugin.runNoriaView("dashboardHome", {workbench: true}, panel);
      if (page === "diary") {this.diary = new DiaryWorkspace(this, panel); await this.diary.select(this.selection, this.intent);}
    })();
    this.loads.set(page, load);
    try {await load;} catch (error) {this.loads.delete(page); throw error;}
  }
  async show(page, selection, intent) {
    // Migrate persisted B1 layout state; internal navigation has two pages.
    if (page === "review") {page = "diary"; intent = "review";}
    if (!PAGES.includes(page)) return;
    const serial = ++this.serial;
    const previous = this.active;
    if (previous === "diary") {await this.diary?.flush(); this.selection = this.diary?.selection || this.selection;}
    if (serial !== this.serial) return;
    if (selection) this.selection = this.plugin.resolveReviewSelection(selection);
    if (intent) this.intent = intent;
    const old = this.pages.get(previous).panel;
    if (this.loads.has(previous)) this.scrolls[previous] = old.scrollTop;
    if (old.contains(document.activeElement)) document.activeElement.blur();
    this.active = page;
    for (const [name, refs] of this.pages) {
      refs.panel.hidden = name !== page;
      refs.button.setAttribute("aria-selected", String(name === page));
      refs.button.tabIndex = name === page ? 0 : -1;
    }
    await this.ensure(page);
    if (serial !== this.serial) return;
    if (page === "diary") await this.diary.select(this.selection, this.intent);
    if (serial !== this.serial) return;
    this.pages.get(page).panel.scrollTop = this.scrolls[page] || 0;
    this.view.app.workspace.requestSaveLayout?.();
  }
  state() {
    const selection = this.active === "diary" ? this.diary?.selection : this.selection;
    return {page: this.active, intent:this.diary?.intent || this.intent, selection: selection || this.selection,
      diaryCards: this.diary?.cards.state() || this.diaryCards,
      scrolls: {...this.scrolls, [this.active]: this.pages.get(this.active).panel.scrollTop}};
  }
  async refresh() {
    if (this.loads.has("home")) {
      const panel = this.pages.get("home").panel, top = panel.scrollTop;
      panel.__noriaHomeCleanup?.(); panel.empty();
      await this.plugin.runNoriaView("dashboardHome", {workbench: true}, panel); panel.scrollTop = top;
    }
    if (this.active === "diary") await this.diary?.refresh();
  }
  async refreshTasks() {
    if (this.loads.has("home")) {
      await this.loads.get("home");
      await this.pages.get("home").panel.__noriaHomeTaskRefresh?.();
    }
    if (this.active === "diary") await this.diary?.refreshTasks();
  }
  dispose() {
    ++this.serial;
    this.diary?.dispose();
    this.pages.get("home").panel.__noriaHomeCleanup?.();
  }
}
module.exports = { NoriaWorkbench };
