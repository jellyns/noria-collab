"use strict";
const missing=value=>value===null||value===undefined||value==="";
function filterNotes(rows,config){
  const folder=String(config.folder||"").replace(/\\/g,"/").replace(/^\/+|\/+$/g,"");
  const tag=String(config.tag||"").replace(/^#/,"");
  return rows.filter(row=>{
    const path=row.path;
    if(folder&&!(config.recursive!==false?path.startsWith(folder+"/"):path.slice(0,path.lastIndexOf("/"))===folder))return false;
    if(tag&&!(row.tags||[]).some(value=>String(value).replace(/^#/,"")===tag||String(value).replace(/^#/,"").startsWith(tag+"/")))return false;
    if(config.filterProperty){const value=row.properties[config.filterProperty];if(config.filterValue===""||config.filterValue==null){if(missing(value))return false;}
      else if(![value].flat().some(item=>String(item)===String(config.filterValue)))return false;}
    return true;
  });
}
function summarize(rows,config={}){
  const numeric=["sum","mean","min","max"].includes(config.calculate),valid=[],invalid=[],groups=new Map();let missingCount=0;
  const units=new Set(config.unitProperty?rows.filter(row=>!missing(row.properties[config.property])).map(row=>row.properties[config.unitProperty]):[]);
  for(const row of rows){const value=config.property?row.properties[config.property]:1;
    if(missing(value)){missingCount++;continue;}
    if(numeric&&config.unitProperty&&(units.size>1||missing(row.properties[config.unitProperty]))){invalid.push({...row,error:"Incompatible or missing unit"});continue;}
    if(numeric&&(typeof value!=="number"||!Number.isFinite(value))){invalid.push(row);continue;}
    valid.push({...row,value});
    const keys=config.group==="folder"?[row.path.slice(0,row.path.lastIndexOf("/"))||"/"]:config.group==="tag"?[...new Set(row.tags||[])]:
      config.display==="trend"?[row.date]:config.calculate==="distribution"?[...new Set([value].flat())]:[];
    for(const key of keys){if(missing(key))continue;if(typeof key==="object"){invalid.push(row);continue;}const label=String(key);if(!groups.has(label))groups.set(label,[]);groups.get(label).push({...row,value});}
  }
  const calculate=list=>!list.length?null:config.calculate==="sum"?list.reduce((a,b)=>a+b.value,0):config.calculate==="mean"?list.reduce((a,b)=>a+b.value,0)/list.length:
    config.calculate==="min"?Math.min(...list.map(r=>r.value)):config.calculate==="max"?Math.max(...list.map(r=>r.value)):list.length;
  return {matched:rows.length,recorded:valid.length,missing:missingCount,invalid,rows:valid,value:calculate(valid),
    groups:[...groups].map(([key,items])=>({key,value:calculate(items),rows:items})).sort((a,b)=>a.key.localeCompare(b.key))};
}
// A shared calendar axis includes missing days. Gaps never become zero or a joined trend.
function alignDailyRecords(results,range){
  const start=Date.parse(range.start+"T00:00:00Z"),end=Date.parse(range.end+"T00:00:00Z");
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw Error("Invalid date range");
  const dates=Array.from({length:Math.floor((end-start)/86400000)+1},(_,i)=>new Date(start+i*86400000).toISOString().slice(0,10));
  return {dates,series:results.map(result=>{const byDate=new Map();for(const row of result.rows){if(!byDate.has(row.date))byDate.set(row.date,[]);byDate.get(row.date).push(row);}
    return dates.map(date=>{const rows=byDate.get(date)||[];return {date,rows,value:rows.length===1?rows[0].value:null,ambiguous:rows.length>1};});})};
}
module.exports={missing,filterNotes,summarize,alignDailyRecords};
