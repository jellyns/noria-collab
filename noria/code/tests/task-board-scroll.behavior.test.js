const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/runtime/views/tasks-calendar/runtime-core.js'), 'utf8');
const scrollCode = source.slice(source.indexOf('var tcMonthWeekScrollState ='), source.indexOf('function bindMonthLayoutResizeObserver'));

function fixture(saved) {
  const week = {
    isConnected: true, scrollTop: 200, scrollHeight: 600, clientHeight: 180,
    getBoundingClientRect: () => ({ top: 100, bottom: 280 }),
    querySelector(selector) { return selector.includes('header') ? { offsetHeight: 24 } : { getAttribute: () => '2026-09-13' }; },
    querySelectorAll: () => week.items,
    items: []
  };
  const item = (key, contentTop) => ({ key, contentTop,
    closest: () => ({ getAttribute: () => '2026-09-16' }),
    getBoundingClientRect() { const top=100+this.contentTop-week.scrollTop; return { top, bottom: top+19, height:19 }; }
  });
  week.items=[item('edited',233),item('neighbor',256),item('later',279)];
  const root={ getAttribute: ()=>'month', querySelectorAll: ()=>[week] };
  const context=vm.createContext({ Map, input:{ monthWeekScrollState:saved }, rootNode:root, getMonthTaskDomKeyShort:n=>n.key });
  vm.runInContext(scrollCode,context);
  return {week,root,context, capture:()=>context.captureMonthWeekScroll(week),restore:()=>context.restoreMonthWeekScroll(root)};
}

test('week scroll follows the visible task when rows are inserted before it',()=>{
  const f=fixture(); f.capture(); f.week.items.forEach(n=>n.contentTop+=23); f.restore();
  assert.equal(f.week.scrollTop,223);
  assert.equal(f.week.items[0].getBoundingClientRect().top,133);
});
test('removing the first visible task retains a nearby task at its prior offset',()=>{
  const f=fixture(); f.capture(); f.week.items.shift(); f.week.items.forEach(n=>n.contentTop-=23); f.restore();
  assert.equal(f.week.scrollTop,177);
  assert.equal(f.week.items[0].getBoundingClientRect().top,156);
});
test('month positions survive runtime replacement through transient input',()=>{
  const old=fixture();const saved=old.root.__noriaCaptureMonthScrollState();
  const fresh=fixture(JSON.parse(JSON.stringify(saved)));fresh.week.scrollTop=0;fresh.restore();
  assert.equal(fresh.week.scrollTop,200);
});
test('layout commits cannot undo a native scroll whose event has not arrived yet',()=>{
  const f=fixture();f.capture();f.week.scrollTop=399;f.restore();
  assert.equal(f.week.scrollTop,399);
  assert.equal(f.root.__noriaCaptureMonthScrollState()[0][1].top,399);
});
test('top-of-week stays at the top and missing anchors clamp to the available range',()=>{
  const f=fixture(); f.week.scrollTop=0; f.capture(); f.week.items[0].contentTop+=23; f.restore(); assert.equal(f.week.scrollTop,0);
  f.week.scrollTop=200; f.capture(); f.week.items=[]; f.week.scrollHeight=250; f.restore(); assert.equal(f.week.scrollTop,70);
});
