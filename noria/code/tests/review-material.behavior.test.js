const test=require("node:test"),assert=require("node:assert/strict");
const {readingBody,buildReviewMaterial,collectReviewMaterialRecords}=require("../src/review-material.js");
const {normalizeReviewSelection}=require("../src/review-center-core.js");
function plugin(files){const reads=[];return {reads,resolveReviewSelection:normalizeReviewSelection,
  resolveCalendarNoteSpecAsync:async(mode,date)=>({path:`Diary/${normalizeReviewSelection({mode,anchorDate:date}).period}.md`}),
  getReviewFinalSectionHeading:mode=>mode==="weekly"?"周复盘":"月复盘",
  loadTextFromVault:async path=>{reads.push(path);return files[path]||"";}};}
test("material retains authored prose and code while omitting executable views",()=>{
  const text='---\nmood: 稳定\n---\n\nMention focusPanel without hiding this sentence.\n\n```noria\n{"view":"focusPanel"}\n```\n\n```js\nconst example=1;\n```\n';
  const body=readingBody(text);assert.match(body,/Mention focusPanel/);assert.match(body,/const example=1/);assert.doesNotMatch(body,/"view"|mood:/);
});
test("compact material keeps secondary projects and long original records without duplicate statistics",()=>{
  const task={label:"Deliver one result",path:"Projects/A.md",line:4};
  const envelope={payload:{mode:"daily",period:"2026-09-16",evidenceHash:"source",evidence:{tasks:{done:1,open:1,doneItems:[task],openItems:[{label:"Write a paragraph",path:"Projects/B.md",line:8}]}},snapshot:{domains:{tasks:{completion:{completedItems:[{title:task.label,source:{path:task.path,line:3}}]}},vaultHealth:{noise:"x".repeat(5000)}}}}};
  const original="作者的原话。".repeat(800),result=buildReviewMaterial(envelope,{records:[{path:"Diary/day.md",text:original}],fullEvidencePath:"full.json"});
  assert.equal(result.payload.records[0].text,original);assert.equal(result.payload.tasks.length,2);assert.ok(result.payload.tasks.some(t=>t.path==="Projects/B.md"));
  assert.doesNotMatch(JSON.stringify(result),/vaultHealth|5000/);assert.equal(result.payload.fullEvidencePath,"full.json");
});
test("monthly material prefers adopted weekly reviews and reads uncovered dates once",async()=>{
  const p=plugin({"Diary/2026-09.md":"## 九月\n\n原定计划。","Diary/2026-W37.md":"## 周复盘\n\n完成了一篇文章，记下散步见闻。","Diary/2026-09-02.md":"边界日原文。","Diary/2026-09-08.md":"已被周回顾覆盖的原文。"});
  const model={mode:"monthly",date:"2026-09-16",period:"2026-09",periodNotePath:"Diary/2026-09.md",evidence:{dailyNotes:[{date:"2026-09-02",path:"Diary/2026-09-02.md",exists:true},{date:"2026-09-08",path:"Diary/2026-09-08.md",exists:true}]}};
  const result=await collectReviewMaterialRecords(p,model);
  assert.ok(result.records.some(r=>r.role==="lower-review"));assert.ok(result.records.some(r=>r.text==="边界日原文。"));
  assert.ok(!p.reads.includes("Diary/2026-09-08.md"));assert.ok(result.references.some(r=>r.date==="2026-09-08"));assert.equal(new Set(p.reads).size,p.reads.length);
});
test("missing lower reviews use actual daily records and supplied daily text is not reread",async()=>{
  const p=plugin({"Diary/2026-09-08.md":"生活记录，无须变成任务。"});
  const monthly=await collectReviewMaterialRecords(p,{mode:"monthly",date:"2026-09-16",period:"2026-09",evidence:{dailyNotes:[{date:"2026-09-08",path:"Diary/2026-09-08.md",exists:true}]}});
  assert.equal(monthly.records[0].text,"生活记录，无须变成任务。");
  p.reads.length=0;const daily=await collectReviewMaterialRecords(p,{mode:"daily",date:"2026-09-08",period:"2026-09-08",diaryPath:"Diary/2026-09-08.md",evidence:{excerpts:[{path:"Diary/2026-09-08.md",text:"完整原文"}]}});
  assert.equal(p.reads.length,0);assert.equal(daily.records[0].text,"完整原文");
});
