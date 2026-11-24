import {hubStorage,uuid} from './hub.js';
export const shopCategories = ['Lebensmittel','Drogerie','Tierbedarf','Baumarkt'];
export const members = [
  {id:'member-1',name:'Person 1',color:'#7ce0bd'},
  {id:'member-2',name:'Person 2',color:'#9ebcff'},
  {id:'member-3',name:'Person 3',color:'#ffaeb6'},
  {id:'member-4',name:'Person 4',color:'#ffd08a'},
  {id:'member-5',name:'Person 5',color:'#c5b4fd'}
];
const memberIds = new Set(members.map(member=>member.id));
export const sections = {
  task: {name:'Aufgaben', one:'Aufgabe', icon:'check', categories:['Haushalt','Familie','Garten','Organisation']},
  buy: {name:'Einkäufe', one:'Einkauf', icon:'cart', categories:shopCategories},
  calendar: {name:'Familienkalender', one:'Termin', icon:'calendar', categories:['Familie','Schule','Freizeit','Arzt','Geburtstage','Haare schneiden','Events','Konzert']},
  meal: {name:'Essensplan', one:'Gericht', icon:'meal', categories:['Frühstück','Mittagessen','Abendessen']},
  mealidea: {name:'Essensideen & Wünsche',one:'Essensidee',icon:'meal',categories:['Idee','Wunsch','Vorschlag']},
  outing: {name:'Unternehmungen',one:'Unternehmung',icon:'calendar',categories:['Draußen','Sport','Ausflug','Zu Hause']},
  routine: {name:'Routinen', one:'Routine', icon:'repeat', categories:['Haushalt','Familie','Garten','Organisation']}
};
export const priorities = {none:'Ohne Priorität',high:'Hoch',normal:'Mittel',low:'Niedrig'};
export const intervals = {daily:'Täglich',weekly:'Wöchentlich',fortnightly:'Alle 2 Wochen',monthly:'Monatlich'};
export const date = (key) => new Date(key+'T12:00:00');
export const key = (day) => [day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-');
export const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
export function shift(day,n){const next=date(day);next.setDate(next.getDate()+n);return key(next);}
export function bounds(view,now=today()){
  const d=date(now);
  if(view==='week'){const start=shift(now,-((d.getDay()+6)%7));return [start,shift(start,6)];}
  if(view==='month')return [key(new Date(d.getFullYear(),d.getMonth(),1)),key(new Date(d.getFullYear(),d.getMonth()+1,0))];
  return [now,now];
}
export function occurrences(entry,start,end){
  if(entry.type!=='routine')return [entry];
  if(!entry.date)return [];
  const origin=date(entry.date);
  const rows=[];
  for(let day=start;day<=end;day=shift(day,1)){
    if(day<entry.date)continue;
    const current=date(day);
    const last=new Date(current.getFullYear(),current.getMonth()+1,0).getDate();
    const elapsed=(Date.parse(day+'T00:00:00Z')-Date.parse(entry.date+'T00:00:00Z'))/86400000;
    const matches=(entry.repeat==='fortnightly'&&elapsed%14===0)||entry.repeat==='daily'||(entry.repeat==='weekly'&&current.getDay()===origin.getDay())||(entry.repeat==='monthly'&&current.getDate()===Math.min(last,origin.getDate()));
    if(matches)rows.push({...entry,date:day,done:entry.completed?.includes(day)??false,completedBy:entry.completedByDate?.[day]});
  }
  return rows;
}
const storageKey='haushaltszentrale-v1';
function normalizeEntries(entries){
  return entries.map(row=>row.type==='buy'&&row.category==='Supermarkt'?{...row,category:'Lebensmittel'}:row);
}
export function readHousehold(){
  const raw=hubStorage.getItem(storageKey);
  if(raw===null)return {entries:[],memberNames:{}};
  const {entries,memberNames={}}=parseBackup(raw);
  return {entries,memberNames};
}
export async function writeHousehold(entries,memberNames){
  await hubStorage.setItem(storageKey,JSON.stringify({version:1,entries,memberNames}));
}
export function backup(entries,memberNames){
  return JSON.stringify({version:1,entries,memberNames},null,2);
}
const validDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && key(date(value))===value;
export function parseBackup(raw){
  const data=JSON.parse(raw);
  if(data?.version!==1||!Array.isArray(data.entries))throw Error('Ungültige Sicherungsdatei.');
  const ids=new Set();
  for(const row of data.entries){
    if(!row || !Object.hasOwn(sections,row.type) || typeof row.id!=='string' || !row.id || ids.has(row.id) || typeof row.title!=='string' || !row.title.trim())throw Error('Die Datei enthält ungültige Einträge.');
    if(row.date && !validDate(row.date) || ['calendar','meal','routine'].includes(row.type) && !validDate(row.date))throw Error('Die Datei enthält ein ungültiges Datum.');
    if(row.type==='routine' && (!Object.hasOwn(intervals,row.repeat)||!Array.isArray(row.completed)||!row.completed.every(validDate)))throw Error('Die Datei enthält eine ungültige Routine.');
    if(['notes','category','quantity','time','url'].some(field=>row[field]!=null&&typeof row[field]!=='string'))throw Error('Die Datei enthält ungültige Felder.');
    if(row.suggestedBy!=null && row.suggestedBy!=='' && !memberIds.has(row.suggestedBy) ||
      row.assignee!=null && row.assignee!=='' && !memberIds.has(row.assignee) ||
      row.completedBy!=null && row.completedBy!=='' && !memberIds.has(row.completedBy) ||
      row.attendees!=null && (!Array.isArray(row.attendees) || !row.attendees.every(id=>memberIds.has(id))))throw Error('Die Datei enthält eine ungültige Personenzuordnung.');
    ids.add(row.id);
  }
  const names=data.memberNames;
  if(names!==undefined && (!names || typeof names!=='object' || Array.isArray(names) ||
    Object.entries(names).some(([id,name])=>!memberIds.has(id)||typeof name!=='string'||name.length>45)))throw Error('Die Datei enthält ungültige Familiennamen.');
  return {entries:normalizeEntries(data.entries),memberNames:names};
}
export function exportCalendar(entries){
  const escape=value=>String(value??'').replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(',','\\,').replaceAll(';','\\;').replaceAll('\r','');
  const stamp=new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Haushaltszentrale//Familienkalender//DE','CALSCALE:GREGORIAN'];
  for(const row of entries.filter(item=>item.type==='calendar'&&!item.demo)){
    const day=row.date.replaceAll('-','');
    const start=row.time?'DTSTART:'+day+'T'+row.time.replace(':','')+'00':'DTSTART;VALUE=DATE:'+day;
    lines.push('BEGIN:VEVENT','UID:'+escape(row.externalId||row.id+'@haushaltszentrale'), 'DTSTAMP:'+stamp,start,'SUMMARY:'+escape(row.title),'DESCRIPTION:'+escape(row.notes),'END:VEVENT');
  }
  return lines.concat('END:VCALENDAR','').join('\r\n');
}
export function importCalendar(raw){
  const events=[];
  let item=null,skipped=0;
  const unescape=value=>value.replace(/\\([nN,;\\])/g,(_,char)=>char.toLowerCase()==='n'?'\n':char);
  const lines=raw.replace(/\r?\n[ \t]/g,'').split(/\r?\n/);
  if(!lines.includes('BEGIN:VCALENDAR'))throw Error('Die Datei ist kein ICS-Kalender.');
  for(const line of lines){
    if(line==='BEGIN:VEVENT'){item={};continue;}
    if(!item)continue;
    if(line==='END:VEVENT'){
      const start=item.DTSTART?.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?$/);
      if(!start || !item.SUMMARY || item.STATUS==='CANCELLED' || item.RRULE || item['RECURRENCE-ID'] || item.RDATE || item.EXDATE || (item.zone && !['Europe/Berlin','Europe/Vienna','Europe/Zurich'].includes(item.zone))){skipped++;item=null;continue;}
      let [,y,m,d,h,min,utc]=start;
      let day=y+'-'+m+'-'+d;
      let time=h?h+':'+min:'';
      if(!validDate(day) || h && (+h>23 || +min>59)){skipped++;item=null;continue;}
      if(utc){
        const instant=new Date(day+'T'+time+':00Z');
        day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(instant);
        time=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'}).format(instant);
      }
      events.push({id:uuid(),externalId:item.UID||[day,time,item.SUMMARY].join('|'),source:'ics',type:'calendar',title:unescape(item.SUMMARY),notes:unescape(item.DESCRIPTION||''),date:day,time,priority:'normal',category:'Importiert',done:false});
      item=null;continue;
    }
    const colon=line.indexOf(':');
    if(colon<0)continue;
    const [field,...parameters]=line.slice(0,colon).split(';');
    item[field]=line.slice(colon+1);
    if(field==='DTSTART')item.zone=parameters.find(part=>part.startsWith('TZID='))?.slice(5).replaceAll('"','');
  }
  return {events,skipped};
}

export function isUpcoming(row,day,clock){
  const through=row.endDate||row.date;
  if(through!==day)return through>day;
  const end=row.endTime||row.time;
  return !end||end>=clock;
}

export function mealBounds(anchor=today()){
  const start=shift(anchor,-((date(anchor).getDay()+3)%7));
  return [start,shift(start,6)];
}

export function completedTasks(entries,start,end){
  const rows=[];
  for(const entry of entries){
    if(entry.type==='task'&&entry.done){
      const completionDate=entry.completedOn||entry.date||'';
      if(!completionDate||(completionDate>=start&&completionDate<=end))rows.push({...entry,completionDate,exactCompletion:!!entry.completedOn});
    }
    if(entry.type==='routine')for(const day of entry.completed||[]){
      const completionDate=entry.completedOnByDate?.[day]||day;
      if(completionDate>=start&&completionDate<=end)rows.push({...entry,completionDate,occurrenceDate:day,completedBy:entry.completedByDate?.[day],exactCompletion:!!entry.completedOnByDate?.[day]});
    }
  }
  return rows.sort((a,b)=>(b.completionDate||'').localeCompare(a.completionDate||''));
}
