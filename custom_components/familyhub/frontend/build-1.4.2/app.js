import {moveEntries,applyCalendarMove,installMoveGestures} from './move.js';
import {hubStorage,request,getSnapshot,latestSnapshot,applySnapshot,mergeSnapshot,uuid,hasPendingWrites} from './hub.js';
import {readAvatars,writeAvatars,avatarFromFile} from './avatars.js';
import {sections,shopCategories,members,priorities,intervals,date,today,shift,key,bounds,occurrences,readHousehold,writeHousehold,backup,parseBackup,importCalendar,exportCalendar,isUpcoming,mealBounds,completedTasks} from './data.js';
import {icon} from './icons.js';
import {feedRows,inspectFeed,matchParticipants,signalLabels} from './klender-parser.js';
import {klender,feedStatus,refreshInterval,refreshFeed,removeFeed,reloadFeed} from './klender-subscription.js';

const shopCategoriesKey='familyhub-shop-categories-v1';
const baseShopCategories=[...shopCategories];
function reloadShopCategories(){
  const saved=JSON.parse(hubStorage.getItem(shopCategoriesKey));
  shopCategories.splice(0,shopCategories.length,...new Set([...baseShopCategories,...(saved?.categories||[])]));
}
reloadShopCategories();
const calendarMovesKey='familyhub-calendar-moves-v1';
let calendarMoves=JSON.parse(hubStorage.getItem(calendarMovesKey))??{};
let moveSelection=null,moveBusy=false;
let isMoving=()=>false;
const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fullDate=new Intl.DateTimeFormat('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const dayDate=new Intl.DateTimeFormat('de-DE',{weekday:'short',day:'numeric',month:'short'});
const shortDate=new Intl.DateTimeFormat('de-DE',{day:'numeric',month:'short'});
const periodNames={today:'Heute',week:'Diese Woche',month:'Dieser Monat'};
const sectionNames={overview:'Übersicht',...Object.fromEntries(Object.entries(sections).map(([id,s])=>[id,s.name])),settings:'Einstellungen'};
const state={page:'overview',period:'week',status:'all',category:'',priority:'',shoppingList:'',person:'',anchor:today()};
let entries=[],memberNames={},editing,completionId,completionDay,toastTimeout,confirmAction;
try{({entries,memberNames}=readHousehold());}catch{notify('Gespeicherte Daten konnten nicht geladen werden.');}
function notify(message){clearTimeout(toastTimeout);$('#toast').textContent=message;toastTimeout=setTimeout(()=>$('#toast').textContent='',4100);}
async function persist(next,message,names=memberNames){
  try{await writeHousehold(next,names);entries=next;memberNames=names;render();if(message)notify(message);return true;}
  catch(error){notify(error.message||'Speichern fehlgeschlagen.');return false;}
}
let avatars={};
try{avatars=readAvatars();}catch{notify('Profilbilder konnten nicht geladen werden.');}
const memberName=member=>memberNames[member.id]||member.name;
const isMember=id=>members.some(member=>member.id===id);
const memberOptions=selected=>members.map(member=>option(member.id,memberName(member),selected)).join('');
const memberBadge=(id,prefix='')=>{
  const member=members.find(person=>person.id===id);
  if(!member)return '';
  return '<span class="member-badge" style="--member-color:'+member.color+'"><i aria-hidden="true"></i>'+escape(prefix+memberName(member))+'</span>';
};
const attendeeBadges=ids=>members.filter(member=>ids?.includes(member.id)).map(member=>memberBadge(member.id)).join('');
function avatar(member){
  const name=memberName(member);
  const initials=name.split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]??'').join('').toLocaleUpperCase('de-DE');
  const photo=avatars[member.id];
  return '<span class="avatar" style="--person-color:'+member.color+'" aria-hidden="true">'+
    (photo?'<img src="'+escape(photo)+'" alt="" width="30" height="30">':escape(initials))+'</span>';
}
function attendeeAvatars(ids){
  const people=members.filter(member=>ids?.includes(member.id));
  if(!people.length)return '';
  const names=people.map(memberName).join(', ');
  return '<details class="avatar-group"><summary aria-label="'+escape('Teilnehmer: '+names)+'">'+people.map(avatar).join('')+
    '</summary><span class="avatar-names">'+escape(names)+'</span></details>';
}
function portraitEditor(member){
  return avatar(member)+'<label class="portrait-upload">Foto auswählen für '+escape(memberName(member))+
    '<input type="file" data-avatar="'+member.id+'" accept="image/jpeg,image/png,image/webp"></label>'+
    (avatars[member.id]?button('remove-avatar',member.id,'Foto entfernen','ghost'):'');
}
async function saveAvatar(id,photo){
  const next={...avatars};
  if(photo)next[id]=photo;
  else delete next[id];
  try{await writeAvatars(next);}
  catch{notify('Das Profilbild konnte nicht gespeichert werden.');return;}
  avatars=next;
  const editor=$('#portrait-'+id);
  if(editor)editor.innerHTML=portraitEditor(members.find(member=>member.id===id));
  notify(photo?'Profilbild gespeichert.':'Profilbild entfernt.');
}
const attendeePicker=ids=>'<fieldset class="full attendee-picker"><legend>Familienmitglieder</legend><div>'+
  members.map(member=>'<label><input type="checkbox" name="attendees" value="'+member.id+'" '+(ids?.includes(member.id)?'checked':'')+'>'+memberBadge(member.id)+'</label>').join('')+'</div></fieldset>';

const klenderPeopleKey='haushaltszentrale-klender-people-v1';
const klenderCategoriesKey='familyhub-calendar-categories-v1';
let klenderCategories=JSON.parse(hubStorage.getItem(klenderCategoriesKey))??{};
const klenderRulesKey='haushaltszentrale-klender-rules-v1';
let klenderPeople={},klenderSelection,klenderRules={};
try{
  const stored=JSON.parse(hubStorage.getItem(klenderPeopleKey));
  if(stored&&typeof stored==='object'&&!Array.isArray(stored))klenderPeople=stored;
  const rules=JSON.parse(hubStorage.getItem(klenderRulesKey));
  if(rules&&typeof rules==='object'&&!Array.isArray(rules))klenderRules=rules;
}catch{
  notify('Lokale Zuordnungen für Klender konnten nicht geladen werden.');
}
const sourceAttendees=names=>matchParticipants(names,members.map(member=>({id:member.id,name:memberNames[member.id]})));
function klenderAttendees(row){
  const local=klenderPeople[row.id];
  if(Array.isArray(local))return local.filter(isMember);
  const fromRules=row.signals.flatMap(signal=>klenderRules[signal]?.people??[]).filter(isMember);
  return [...new Set([...sourceAttendees(row.participantNames),...fromRules])];
}
async function saveKlenderRule(key,people){
  const signal=klender.feed&&inspectFeed(klender.feed).signals.find(item=>item.key===key);
  if(people&&(!signal||!people.length)){
    notify('Wähle ein Merkmal und mindestens ein Familienmitglied.');
    return;
  }
  const next={...klenderRules};
  if(people)next[key]={type:signal.type,value:signal.value,people};
  else delete next[key];
  try{
    await hubStorage.setItem(klenderRulesKey,JSON.stringify(next));
    klenderRules=next;
    render();
    $('#klender-rule-select')?.focus();
    notify(people?'Regel für passende Klender-Termine gespeichert.':'Zuordnungsregel entfernt.');
  }catch{
    notify('Die Regel konnte nicht gespeichert werden.');
  }
}

function klenderRulePanel(){
  if(!klender.feed)return '';
  const analysis=inspectFeed(klender.feed);
  const groups=Object.entries(signalLabels).map(([type,label])=>{
    const choices=analysis.signals.filter(signal=>signal.type===type);
    return choices.length?'<optgroup label="'+label+'">'+choices.map(signal=>option(signal.key,signal.value)).join('')+'</optgroup>':'';
  }).join('');
  const saved=Object.entries(klenderRules).map(([key,rule])=>{
    if(!Array.isArray(rule?.people))return '';
    return '<div class="klender-rule"><span>'+escape(signalLabels[rule.type]+' · '+rule.value)+'</span><div class="member-tags">'+attendeeBadges(rule.people)+'</div>'+
      button('remove-klender-rule',key,'Entfernen','ghost','Regel für '+rule.value+' entfernen')+'</div>';
  }).join('');
  const diagnosis=analysis.events+' ICS-Termine geprüft · '+analysis.withPeople+' mit erkennbaren Teilnehmerdaten';
  return '<section class="panel full settings" id="klender-rules"><h2>Klender-Zuordnungsregeln</h2><p>'+diagnosis+'.</p>'+
    '<p>Ordne einen exportierten Namen, eine Teilnehmerkennung, eine Kategorie, eine Farbe oder einen genauen Termintitel einmalig zu. Die Auswahl gilt für alle passenden Klender-Termine in Home Assistant.</p>'+
    (groups?'<form id="klender-rule-form"><label>Merkmal aus Klender<select name="signal" id="klender-rule-select" required>'+option('','Merkmal auswählen')+groups+'</select></label>'+
      '<div id="klender-rule-people">'+attendeePicker()+'</div><button class="primary" type="submit">Regel speichern</button></form>':'')+
    saved+'<details><summary>ICS-Felder anzeigen</summary><p>'+escape(analysis.fields.join(', ')||'Keine Terminfelder vorhanden.')+'</p></details></section>';
}

function openKlenderPeople(id){
  const row=visibleRows().find(item=>item.source==='klender'&&item.id===id);
  if(!row)return;
  klenderSelection=id;
  $('#klender-event-title').textContent=row.title;
  $('#klender-people-fields').innerHTML=attendeePicker(row.attendees)+'<label>Kategorie<input name="category" maxlength="70" list="klender-categories" value="'+escape(klenderCategories[id]||'')+'" placeholder="z. B. Geburtstage"></label><datalist id="klender-categories">'+sections.calendar.categories.map(c=>option(c,c)).join('')+'</datalist>';
  $('#klender-people-hint').textContent=row.participantNames.length
    ? 'Im Abo erkannt: '+row.participantNames.join(', ')+'. Die lokale Auswahl gilt nur für diesen Termin.'
    : 'Im Abo wurde kein Teilnehmername erkannt. Die lokale Auswahl gilt nur für diesen Termin.';
  $('#klender-use-source').hidden=!Array.isArray(klenderPeople[id]);
  $('#klender-people').showModal();
}
async function saveKlenderPeople(ids){
  const next={...klenderPeople};
  if(ids===null)delete next[klenderSelection];
  else next[klenderSelection]=ids;
  try{
    await hubStorage.setItem(klenderPeopleKey,JSON.stringify(next));
    klenderPeople=next;
    $('#klender-people').close();
    render();
    [...document.querySelectorAll('[data-action="klender-people"]')].find(control=>control.dataset.value===klenderSelection)?.focus();
    notify(ids===null?'Automatische Zuordnung aktiviert.':'Zuordnung in Home Assistant gespeichert.');
  }catch{
    notify('Die Zuordnung konnte nicht gespeichert werden.');
  }
}
const shopGroup=row=>row.category||'';
function matchesPerson(row){
  if(!state.person)return true;
  const assigned=row.type==='calendar'?row.attendees||[]:[row.assignee].filter(Boolean);
  if(state.person==='unassigned')return !assigned.length;
  return assigned.includes(state.person)||(row.type==='task'&&row.done&&row.completedBy===state.person);
}
function updateFeedStatus(){
  const status=$('#klender-status');
  if(status)status.textContent=feedStatus();
}
async function loadKlender(value=klender.url,fromForm=false){
  if(!value)return;
  if(await refreshFeed(value,updateFeedStatus)){
    if(fromForm||['calendar','overview'].includes(state.page))render();
    else updateFeedStatus();
  }
}
function refreshWhenVisible(){
  if(!document.hidden&&!klender.request&&klender.url&&Date.now()-klender.lastAttempt>=refreshInterval)void loadKlender();
}
const listName=row=>row.list||'Standard';
const listNames=()=>[...new Set(['Standard','Alexa',...entries.filter(row=>row.type==='buy').map(listName)])].sort((a,b)=>a.localeCompare(b,'de'));
const pageTypes=()=>state.page==='meal'?['meal','mealidea']:state.page==='task'?['task','routine']:Object.hasOwn(sections,state.page)?[state.page]:Object.keys(sections);
const option=(value,label,selected)=>'<option value="'+escape(value)+'"'+(value===selected?' selected':'')+'>'+escape(label)+'</option>';
const button=(action,id,content,classes='',label='')=>'<button type="button" class="'+classes+'" data-action="'+action+'" data-value="'+escape(id)+'"'+(label?' aria-label="'+escape(label)+'" title="'+escape(label)+'"':'')+'>'+content+'</button>';
const glyph=type=>'<span class="glyph '+type+'">'+icon(sections[type].icon)+'</span>';
function safeURL(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:'';}catch{return '';}}
const periodBounds=()=>state.page==='meal'&&state.period==='week'?mealBounds(state.anchor):bounds(state.period,state.anchor);
function visibleRows(){
  const [start,end]=state.page==='overview'?[today(),shift(today(),OVERVIEW_DAYS-1)]:periodBounds();
  const now=today();
  const rows=entries.flatMap(row=>occurrences(row,start,end));
  if(state.page==='buy')rows.push(...shoppingRows());

  if(klender.feed&&pageTypes().includes('calendar')){
    const feedEvents=new Map(feedRows(klender.feed,start,end).map(row=>[row.id,row]));
    for(const move of Object.values(calendarMoves)){
      if(move.date>=start&&move.date<=end)for(const row of feedRows(klender.feed,move.originalDate,move.originalDate))if(!feedEvents.has(row.id))feedEvents.set(row.id,row);
    }
    for(const original of feedEvents.values()){
      const row=applyCalendarMove(original,calendarMoves);
      rows.push({...row,category:klenderCategories[row.id]||row.category,attendees:klenderAttendees(row)});
    }
  }
  return rows.filter(row=>{
    if(row.type==='buy'&&state.shoppingList&&listName(row)!==state.shoppingList)return false;
    if(state.page==='calendar'&&state.category==='Klender'&&row.source!=='klender')return false;
    if(state.category==='__no_shop__' ? !!row.category : state.category&&!(state.page==='calendar'&&state.category==='Klender')&&state.category!==row.category)return false;
    if(!matchesPerson(row))return false;
    if(state.priority&&state.priority!==row.priority)return false;
    if(state.status==='done'&&!row.done || state.status==='open'&&row.done)return false;
    if(state.status==='late')return ['task','buy','routine'].includes(row.type)&&!!row.date&&row.date<now&&!row.done;
    if(['mealidea','outing'].includes(row.type))return true;
    if(!row.date)return true;
    return row.date>=start&&row.date<=end || ['task','buy'].includes(row.type)&&row.date<start&&!row.done;
  }).sort((a,b)=>Number(a.done)-Number(b.done)||(a.date||'9999').localeCompare(b.date||'9999')||(a.time||'').localeCompare(b.time||'')||({high:0,normal:1,low:2}[a.priority]??3)-({high:0,normal:1,low:2}[b.priority]??3));
}
function nav(id){
  const name=id==='overview'?'grid':id==='settings'?'link':sections[id].icon;
  return '<button type="button" class="nav-btn '+(state.page===id?'active':'')+'" data-action="page" data-value="'+id+'"'+' title="'+escape(sectionNames[id])+'"'+(state.page===id?' aria-current="page"':'')+'>'+icon(name)+sectionNames[id]+'</button>';
}
function toolbar(){
  const types=pageTypes();
  const cats=[...new Set([...types.flatMap(type=>sections[type].categories),...entries.filter(row=>types.includes(row.type)).map(row=>row.category).filter(Boolean),...(types.includes('calendar')?Object.values(klenderCategories):[]),...(klender.url&&types.includes('calendar')?['Klender']:[])])].sort((a,b)=>a.localeCompare(b,'de'));
  return '<div class="toolbar"><div class="period-controls">'+button('step-period','-1','‹','ghost','Vorheriger Zeitraum')+
    button('current-period','','Aktuell','ghost')+button('step-period','1','›','ghost','Nächster Zeitraum')+
    '<span>'+escape(shortDate.format(date(periodBounds()[0]))+' – '+shortDate.format(date(periodBounds()[1])))+'</span></div><div class="segments" aria-label="Zeitraum">'+Object.entries(periodNames).map(([id,name])=>'<button type="button" class="'+(id===state.period?'active':'')+'" aria-pressed="'+(id===state.period)+'" data-action="period" data-value="'+id+'">'+name+'</button>').join('')+'</div><div class="filters">'+
    (state.page==='buy'?'<select aria-label="Einkaufsliste" data-filter="shoppingList">'+option('','Alle Listen',state.shoppingList)+listNames().map(name=>option(name,name,state.shoppingList)).join('')+'</select>':'')+
    '<select aria-label="Status" data-filter="status">'+Object.entries({all:'Alle Status',open:'Offen',done:'Erledigt',late:'Überfällig'}).map(([id,name])=>option(id,name,state.status)).join('')+'</select>'+
    '<select aria-label="'+(state.page==='buy'?'Ladenkategorie':'Kategorie')+'" data-filter="category">'+option('',state.page==='buy'?'Alle Läden':'Alle Kategorien',state.category)+cats.map(name=>option(name,name,state.category)).join('')+(state.page==='buy'?option('__no_shop__','Ohne Ladenkategorie',state.category):'')+'</select>'+
    (['task','calendar'].includes(state.page)?'<select aria-label="Familienmitglied" data-filter="person">'+option('','Alle Personen',state.person)+option('unassigned',state.page==='task'?'Freie Aufgaben':'Ohne Zuordnung',state.person)+memberOptions(state.person)+'</select>':'')+
    '<select aria-label="Priorität" data-filter="priority">'+option('','Alle Prioritäten',state.priority)+Object.entries(priorities).map(([id,name])=>option(id,name,state.priority)).join('')+'</select></div></div>';
}
function calendarRow(row,grouped){
  const fromKlender=row.source==='klender';
  const title=fromKlender?'<div class="row-title">'+escape(row.title)+'</div>':button('edit',row.id,escape(row.title),'row-title');
  const meta=[row.localMove?'Lokal verschoben':'',!fromKlender?'Lokal':'',!grouped&&shortDate.format(date(row.date)),fromKlender?['Klender',row.category!=='Klender'?row.category:''].filter(Boolean).join(' · '):row.category,!fromKlender&&['high','normal','low'].includes(row.priority)?priorities[row.priority]:''].filter(Boolean).map(escape).join(' · ');
  const clock=row.time?'<time datetime="'+escape(row.date+'T'+row.time)+'">'+escape(row.time)+'</time>':'<span>Ganztägig</span>';
  const check=fromKlender?'':'<input type="checkbox" data-check="'+escape(row.id)+'" data-day="'+escape(row.date)+'" aria-label="'+escape(row.title)+' als '+(row.done?'offen':'erledigt')+' markieren" '+(row.done?'checked':'')+'>';
  const action=fromKlender
    ?button('klender-people',row.id,icon('edit'),'icon','Familienmitglieder für '+row.title+' zuordnen')
    :button('edit',row.id,icon('edit'),'icon',row.title+' bearbeiten');
  return '<div class="row agenda-event '+(fromKlender?'from-klender ':'')+(row.done?'done':'')+'">'+
    moveHandle(row)+'<div class="event-clock">'+clock+'</div><div class="row-main">'+title+
    (meta?'<div class="row-meta">'+meta+'</div>':'')+(row.notes?'<div class="note">'+escape(row.notes)+'</div>':'')+
    '</div><div class="event-actions">'+attendeeAvatars(row.attendees)+check+action+(row.localMove?button('restore-calendar-move',row.id,'↶','icon','Klender-Originaldatum wiederherstellen'):'')+'</div></div>';
}
function rowHTML(row,grouped){
  if(row.source==='alexa')return shoppingRow(row);
  if(row.type==='calendar')return calendarRow(row,grouped);
  const dateLabel=row.date?(grouped?'':row.date===today()?'Heute':shortDate.format(date(row.date))):'';
  const extra={buy:row.quantity,calendar:row.time, routine:intervals[row.repeat]}[row.type];
  const meta=[dateLabel,extra,row.type==='buy'&&(!grouped||row.list&&listName(row)!=='Standard')?listName(row):'',row.type==='buy'&&grouped?'':row.category].filter(Boolean).map(escape).join(' · ');
  const people=['task','routine'].includes(row.type)
      ? (row.assignee?memberBadge(row.assignee,'Zuständig: '):'<span class="member-badge free">Freie Aufgabe</span>')+
        (row.done?memberBadge(row.completedBy,'Erledigt von: '):'')
      : ['mealidea','outing'].includes(row.type)?memberBadge(row.suggestedBy,'Vorgeschlagen von: '):'';
  const late=!row.done&&row.date&&row.date<today()&&['task','buy','routine'].includes(row.type);
  const link=['meal','mealidea','outing'].includes(row.type)?safeURL(row.url):'';
  return '<div class="row '+(row.done?'done':'')+'" data-row-id="'+escape(row.id)+'">'+(row.type==='meal'?moveHandle(row):'')+'<input type="checkbox" data-check="'+escape(row.id)+'" data-day="'+escape(row.date)+'" aria-label="'+escape(row.title)+' als '+(row.done?'offen':'erledigt')+' markieren" '+(row.done?'checked':'')+'><div class="row-main">'+button('edit',row.id,escape(row.title),'row-title')+
    (meta?'<div class="row-meta">'+meta+'</div>':'')+(people?'<div class="member-tags">'+people+'</div>':'')+(row.notes?'<div class="note">'+escape(row.notes)+'</div>':'')+
    (row.type==='mealidea'?button('plan-idea',row.id,'Einplanen','ghost'):'')+
    (link?'<a class="note" href="'+escape(link)+'" target="_blank" rel="noopener noreferrer">Rezept öffnen ↗</a>':'')+'</div><div class="pills">'+
    (late?'<span class="pill late">Überfällig</span>':'')+(['high','normal','low'].includes(row.priority)?'<span class="pill '+row.priority+'">'+priorities[row.priority]+'</span>':'')+
    button('edit',row.id,icon('edit'),'icon','Bearbeiten')+'</div></div>';
}
function panel(type,all,overview){
  const def=sections[type];
  const rows=overview?all.slice(0,3):all;
  const grouped=!overview&&['buy','calendar','meal','routine'].includes(type);
  let body='';
  if(grouped){
    const groups=new Map();
    for(const row of rows){
      const value=type==='buy'?shopGroup(row):row.date;
      if(!groups.has(value))groups.set(value,[]);
      groups.get(value).push(row);
    }
    const shopOrder=name=>shopCategories.includes(name)?shopCategories.indexOf(name):shopCategories.length+(name?0:1);
    body=[...groups].sort(([a],[b])=>(type==='buy'?shopOrder(a)-shopOrder(b):0)||a.localeCompare(b,'de')).map(([name,items])=>'<div class="date-head">'+escape(type==='buy'?name||'Ohne Ladenkategorie':dayDate.format(date(name)))+'</div><div class="rows">'+items.map(row=>rowHTML(row,true)).join('')+'</div>').join('');
  }else if(rows.length)body='<div class="rows">'+rows.map(row=>rowHTML(row,false)).join('')+'</div>';
  if(!rows.length)body='<p class="empty">Keine passenden Einträge.</p>';
  return '<section class="panel '+type+(!overview||type==='routine'?' full':'')+'"><div class="panel-head">'+glyph(type)+'<h2>'+def.name+'</h2><div class="panel-tools">'+
    button('add',type,icon('plus'),'icon',def.one+' hinzufügen')+(overview?button('page',type,icon('arrow'),'icon',def.name+' öffnen'):'')+'</div></div>'+body+
    (overview&&all.length>rows.length?button('page',type,'Alle '+all.length+' Einträge anzeigen','show-all'):'')+'</section>';
}

const savedShopping=getSnapshot().values['familyhub-shopping-cache-v1'];
let shoppingItems=savedShopping?.entity===getSnapshot().todo_entity?savedShopping.items:[],shoppingError='',shoppingBusy=false,syncBusy=false;
let shoppingMeta=JSON.parse(hubStorage.getItem('familyhub-shopping-meta-v1'))??{};
let lastDay=today();

function shoppingRows(){
  return shoppingItems.map(item=>({id:'alexa:'+item.uid,uid:item.uid,type:'buy',source:'alexa',
    title:item.summary,done:item.status==='completed',category:shoppingMeta[item.uid]??'',date:'',list:'Alexa'}));
}
function shoppingRow(row){
  return '<div class="row"><input type="checkbox" data-alexa-check="'+escape(row.uid)+'" aria-label="'+escape(row.title)+' als erledigt markieren" '+(row.done?'checked':'')+'>'+
    '<div class="row-main"><span class="row-title">'+escape(row.title)+'</span><div class="row-meta">Alexa</div></div>'+
    '<select aria-label="Kategorie für '+escape(row.title)+'" data-alexa-category="'+escape(row.uid)+'">'+option('','Ohne Kategorie',row.category)+shopCategories.map(category=>option(category,category,row.category)).join('')+'</select></div>';
}
function shoppingControls(){
  return '<section class="shopping-controls"><p role="status">'+escape(shoppingError||'Alexa · '+getSnapshot().todo_entity)+'</p>'+
    '<form id="alexa-add"><label>Zu Alexa hinzufügen<input name="title" required maxlength="140" placeholder="Artikel"></label><button class="primary" type="submit">Hinzufügen</button>'+
    button('shopping-refresh','','Aktualisieren','ghost')+'</form><form id="shop-category-form"><label>Neue Ladenkategorie<input name="category" required maxlength="70" placeholder="z. B. Bäckerei"></label><button class="ghost" type="submit">Kategorie anlegen</button></form></section>';
}
function shoppingSettings(){
  return '<section class="panel settings"><h2>Alexa-Einkaufsliste</h2><p>Die Liste wird über Alexa Devices gelesen. Hinzufügen und Abhaken wirken auf dieselbe Alexa-Liste.</p>'+
    '<form id="todo-settings"><label>Entitäts-ID<input name="entity" required pattern="todo\.[a-z0-9_]+" value="'+escape(getSnapshot().todo_entity)+'"></label><button class="primary" type="submit">Liste verbinden</button></form>'+
    '<p>'+escape(shoppingError||'Liste unter Einkäufe öffnen.')+'</p></section>';
}
async function loadShopping(redraw=false){
  if(shoppingBusy)return;
  shoppingBusy=true;
  try{shoppingItems=await request('shopping/list');shoppingError='';}
  catch(error){shoppingError=error.message;}
  finally{shoppingBusy=false;if(redraw||state.page==='buy'&&!document.querySelector('dialog[open]')&&!document.activeElement?.matches('input,textarea,select'))render();}
}
async function synchronize(){
  if(isMoving()||syncBusy||hasPendingWrites()||document.hidden||document.querySelector('dialog[open]')||document.activeElement?.matches('input,textarea,select'))return;
  syncBusy=true;
  try{
    const next=await latestSnapshot();
    // Read requests can overlap with a new user action. Defer applying until idle.
    if(isMoving()||hasPendingWrites()||document.querySelector('dialog[open]')||document.activeElement?.matches('input,textarea,select'))return;
    const changed=JSON.stringify(next.revisions)!==JSON.stringify(getSnapshot().revisions);
    if(changed){
      applySnapshot(next);
      reloadShopCategories();
      calendarMoves=JSON.parse(hubStorage.getItem(calendarMovesKey))??{};
      ({entries,memberNames}=readHousehold());
      avatars=readAvatars();
      klenderPeople=JSON.parse(hubStorage.getItem(klenderPeopleKey))??{};
      klenderRules=JSON.parse(hubStorage.getItem(klenderRulesKey))??{};
  klenderCategories=JSON.parse(hubStorage.getItem(klenderCategoriesKey))??{};
      shoppingMeta=JSON.parse(hubStorage.getItem('familyhub-shopping-meta-v1'))??{};
      reloadFeed();
    }
    const dayChanged=today()!==lastDay;
    if(dayChanged){lastDay=today();state.anchor=today();}
    if(changed||dayChanged)render();
    await loadShopping();
  }catch(error){notify(error.message);}
  finally{syncBusy=false;}
}
function overviewTask(row){
  const assigned=members.find(member=>member.id===row.assignee);
  const meta=[row.date===today()?'Heute':row.date?shortDate.format(date(row.date)):'Ohne Fälligkeit',row.type==='routine'?intervals[row.repeat]:'',assigned?memberName(assigned):'Freie Aufgabe'].filter(Boolean).join(' · ');
  return '<div class="row overview-task"><input type="checkbox" data-check="'+escape(row.id)+'" data-day="'+escape(row.date)+'" aria-label="'+escape(row.title)+' abschließen"><div class="row-main">'+button('edit',row.id,escape(row.title),'row-title')+'<div class="row-meta">'+escape(meta)+'</div></div>'+
    (['high','normal','low'].includes(row.priority)?'<span class="pill '+row.priority+'">'+priorities[row.priority]+'</span>':'')+(assigned?avatar(assigned):'')+'</div>';
}
function overviewCard(type,rows,limit=4){
  return '<section class="panel '+type+'"><div class="panel-head">'+glyph(type)+'<h2>'+sections[type].name+'</h2><span class="overview-count">'+rows.length+' offen</span>'+button('page',type,icon('arrow'),'icon',sections[type].name+' öffnen')+'</div>'+
    '<div class="overview-list">'+(rows.length?rows.slice(0,limit).map(overviewTask).join(''):'<p class="empty">Keine anstehenden Aufgaben.</p>')+'</div>'+
    (rows.length>limit?button('page',type,'Alle '+rows.length+' anzeigen','show-all'):'')+'</section>';
}
function overviewEvent(row){
  const people=members.filter(member=>row.attendees?.includes(member.id));
  const own=row.source!=='klender';
  const label=[row.title,dayDate.format(date(row.date)),row.time||'Ganztägig',row.category,own?'Lokaler Termin':'',row.localMove?'Nur in Familyhub verschoben':'',...people.map(memberName)].filter(Boolean).join(' · ');
  const tag=own?'<small class="local-date-label own">Lokal</small>':row.localMove?'<small class="local-date-label">Verschoben</small>':'';
  return '<div class="overview-event-wrap">'+moveHandle(row)+button('overview-event',row.id,'<time>'+escape((row.localMove?'↪ ':'')+(row.time||'Tag'))+'</time><span class="overview-event-title">'+escape(row.title)+tag+'</span><span class="overview-portraits" aria-hidden="true">'+people.map(avatar).join('')+'</span>','overview-event',label)+'</div>';
}
/* ---------- Weather (1.4.0) ---------- */
const OVERVIEW_DAYS=7;
const weatherInfo={
  'clear-night':['🌙','Klar'],cloudy:['☁️','Bewölkt'],exceptional:['⚠️','Unwetter'],fog:['🌫️','Nebel'],hail:['🌨️','Hagel'],
  lightning:['🌩️','Gewitter'],'lightning-rainy':['⛈️','Gewitter'],partlycloudy:['⛅','Teils bewölkt'],pouring:['🌧️','Starkregen'],
  rainy:['🌦️','Regen'],snowy:['❄️','Schnee'],'snowy-rainy':['🌨️','Schneeregen'],sunny:['☀️','Sonnig'],windy:['💨','Windig'],'windy-variant':['💨','Windig']
};
let weather=null,weatherBusy=false;
const weatherIcon=condition=>(weatherInfo[condition]||['🌡️'])[0];
const weatherText=condition=>(weatherInfo[condition]||['',''])[1];
const roundTemp=value=>value==null||value===''||Number.isNaN(Number(value))?'–':Math.round(Number(value))+'°';
function weatherFor(day){
  return weather?.forecast?.find(item=>typeof item.datetime==='string'&&new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date(item.datetime))===day);
}
function weatherChip(day){
  const item=weatherFor(day);
  if(!item)return '';
  const rain=item.precipitation_probability!=null&&item.precipitation_probability>=30?' · '+Math.round(item.precipitation_probability)+'%':'';
  return '<span class="day-weather" title="'+escape(weatherText(item.condition))+'">'+weatherIcon(item.condition)+' '+roundTemp(item.temperature)+'<small>/'+roundTemp(item.templow)+rain+'</small></span>';
}
function heroWeather(){
  if(!weather)return '';
  const todayItem=weatherFor(today());
  return '<div class="hero-weather" title="'+escape(weatherText(weather.condition))+'"><span class="hero-weather-icon">'+weatherIcon(weather.condition)+'</span><div><strong>'+roundTemp(weather.temperature)+'</strong><small>'+escape(weatherText(weather.condition))+(todayItem?' · '+roundTemp(todayItem.temperature)+' / '+roundTemp(todayItem.templow):'')+'</small></div></div>';
}
function weatherCard(){
  if(!weather)return '<section class="overview-day overview-weather"><h3>Wetter</h3><p class="day-empty">Wetterdaten werden geladen …</p></section>';
  const days=[];
  for(let day=today(),i=0;i<OVERVIEW_DAYS;i++,day=shift(day,1)){
    const item=weatherFor(day);
    if(item)days.push('<div class="mini-forecast"><span>'+escape(i===0?'Heute':new Intl.DateTimeFormat('de-DE',{weekday:'short'}).format(date(day)))+'</span><b>'+weatherIcon(item.condition)+'</b><span>'+roundTemp(item.temperature)+'</span><small>'+roundTemp(item.templow)+'</small></div>');
  }
  const todayItem=weatherFor(today());
  return '<section class="overview-day overview-weather"><h3>Wetter<span class="weather-now">'+weatherIcon(weather.condition)+' '+roundTemp(weather.temperature)+'</span></h3>'+
    '<p class="weather-line">'+escape(weatherText(weather.condition))+(todayItem?.precipitation_probability!=null?' · Regen '+Math.round(todayItem.precipitation_probability)+'%':'')+'</p>'+
    '<div class="mini-forecasts">'+days.join('')+'</div></section>';
}
async function loadWeather(){
  if(weatherBusy)return;
  weatherBusy=true;
  try{
    const next=await request('weather');
    const changed=JSON.stringify(next)!==JSON.stringify(weather);
    weather=next;
    if(changed&&state.page==='overview'&&!isMoving()&&!document.querySelector('dialog[open]'))render();
    if(changed)updateSaver?.();
  }catch{/* No weather entity: the overview works without it. */}
  finally{weatherBusy=false;}
}
function overviewTasks(rows){
  // A daily routine appears once (its next open date), not once per day.
  const seen=new Set();
  return rows.filter(row=>{
    if(row.type!=='routine')return true;
    if(seen.has(row.id))return false;
    seen.add(row.id);return true;
  });
}
function renderOverview(hero){
  const [start,end]=mealBounds();
  const rows=visibleRows();
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  const events=rows.filter(row=>row.type==='calendar'&&!row.done&&isUpcoming(row,today(),clock));
  const tasks=overviewTasks(rows.filter(row=>['task','routine'].includes(row.type)&&!row.done));
  const meals=entries.filter(row=>row.type==='meal');
  const last=shift(today(),OVERVIEW_DAYS-1);
  let mealRows='',days='';
  for(let day=today();day<=last;day=shift(day,1)){
    const items=events.filter(row=>row.date===day);
    days+='<section class="overview-day '+(day===today()?'current':'')+'" data-drop-kind="calendar" data-drop-day="'+day+'"><h3><span>'+escape(dayDate.format(date(day)))+(day===today()?'<span class="today-label">Heute</span>':'')+'</span>'+weatherChip(day)+'</h3><div class="overview-day-events">'+(items.length?items.map(overviewEvent).join(''):'<p class="day-empty">Keine Termine</p>')+'</div></section>';
  }
  for(let day=start;day<=end;day=shift(day,1)){
    const dishes=meals.filter(row=>row.date===day);
    mealRows+='<div class="week-meal '+(day===today()?'current':'')+'" data-drop-kind="meal" data-drop-day="'+day+'"><time>'+dayDate.format(date(day))+'</time><div>'+
      (dishes.length?dishes.map(row=>'<div class="move-meal" data-row-id="'+escape(row.id)+'">'+moveHandle(row)+button('edit',row.id,escape(row.title),'row-title')+'</div>').join(''):'<span class="muted">Noch offen</span>')+'</div></div>';
  }
  $('#app').innerHTML=hero+'<div class="weekly-overview">'+
    '<section class="panel overview-calendar"><div class="panel-head">'+glyph('calendar')+'<h2>Familienkalender</h2><span class="overview-range">'+escape(shortDate.format(date(today()))+' – '+shortDate.format(date(last)))+'</span>'+button('page','calendar',icon('arrow'),'icon','Familienkalender öffnen')+'</div><div class="overview-days">'+days+'</div></section>'+
    '<div class="overview-side"><section class="panel meal"><div class="panel-head">'+glyph('meal')+'<h2>Essensplan</h2><span class="overview-range">Do–Mi · '+escape(shortDate.format(date(start))+' – '+shortDate.format(date(end)))+'</span>'+button('page','meal',icon('arrow'),'icon','Essensplan öffnen')+'</div><div class="week-meals">'+mealRows+'</div></section>'+
    overviewCard('task',tasks)+'</div></div>'+
    '<div class="overview-links">'+button('page','buy',icon('cart')+' Einkaufsliste','ghost')+button('page','outing','Unternehmungen','ghost')+'</div>'+
    (kiosk.on?'':button('kiosk-toggle','',icon('expand'),'kiosk-button','Vollbild für Tablet'));
}
function openOverviewEvent(id){
  const row=visibleRows().find(item=>item.type==='calendar'&&item.id===id);
  if(!row)return;
  $('#event-detail-title').textContent=row.title;
  $('#event-detail-body').innerHTML='<p>'+escape(fullDate.format(date(row.date))+' · '+(row.time||'Ganztägig'))+'</p>'+(row.category?'<p>Kategorie: '+escape(row.category)+'</p>':'')+attendeeAvatars(row.attendees)+(row.localMove?'<p class="local-move-note">Nur in Familyhub verschoben. Original in Klender: '+escape(shortDate.format(date(row.originalDate)))+'.</p>'+button('restore-calendar-move',row.id,'Klender-Datum wiederherstellen','ghost'):'')+(row.notes?'<p class="event-detail-notes">'+escape(row.notes)+'</p>':'')+'<div class="dialog-actions">'+button(row.source==='klender'?'klender-people':'edit',row.id,row.source==='klender'?'Personen & Kategorie':'Termin bearbeiten','ghost')+'</div>';
  $('#event-details').showModal();
}
function monthCalendar(rows){
  const [start,end]=bounds('month',state.anchor);
  const gridStart=shift(start,-((date(start).getDay()+6)%7));
  const gridEnd=shift(end,6-((date(end).getDay()+6)%7));
  let cells='';
  for(let day=gridStart;day<=gridEnd;day=shift(day,1)){
    const items=rows.filter(row=>row.date===day);
    cells+='<div data-drop-kind="calendar" data-drop-day="'+day+'" class="calendar-cell '+(day<start||day>end?'outside ':'')+(day===today()?'current':'')+'">'+
      button('add-on-day',day,String(date(day).getDate()),'day-number','Termin am '+day+' hinzufügen')+
      items.map(row=>'<div class="calendar-mini">'+moveHandle(row)+(row.source==='klender'?button('klender-people',row.id,escape((row.time||'')+' '+row.title),'row-title'):button('edit',row.id,escape((row.time||'')+' '+row.title),'row-title'))+(row.category&&row.category!=='Klender'?'<span class="calendar-category">'+escape(row.category)+'</span>':'')+attendeeAvatars(row.attendees)+(row.localMove?button('restore-calendar-move',row.id,'↶ Lokal','ghost','Klender-Originaldatum wiederherstellen'):'')+'</div>').join('')+'</div>';
  }
  return '<section class="panel full"><div class="month-grid">'+['Mo','Di','Mi','Do','Fr','Sa','So'].map(day=>'<div class="weekday">'+day+'</div>').join('')+cells+'</div></section>';
}

function footer(){
  const demo=entries.some(row=>row.demo);
  return '<footer class="footer"><span>'+(demo?'Beispieldaten zum Ausprobieren':'Änderungen werden in Home Assistant gespeichert.')+'</span><div>'+
    (demo?button('remove-demo','','Beispieldaten entfernen','ghost')+' ':'')+button('page','settings','Einstellungen & Datensicherung','ghost')+'</div></footer>';
}
function settings(){
  return '<div class="grid">'+
    '<section class="panel settings"><h2>Familienmitglieder</h2><p>Familyhub 1.4.2</p><p>Die Namen gelten im Kalender und in der Aufgabenliste. Profilbilder werden in Home Assistant gespeichert.</p><form id="family-form" class="family-form">'+
    members.map(member=>'<div class="family-member"><label>Familienname<input name="'+member.id+'" aria-label="'+member.name+'" maxlength="45" value="'+escape(memberNames[member.id]||'')+'" placeholder="'+member.name+'"></label><div class="portrait-editor" id="portrait-'+member.id+'">'+portraitEditor(member)+'</div></div>').join('')+
    '<button class="primary" type="submit">Namen speichern</button></form></section>'+
    '<section class="panel settings"><h2>Klender abonnieren</h2><p>Kopiere in Klender unter „Termine exportieren“ den iCalendar-Link. Teilnehmernamen aus dem Abo werden mit den Namen deiner Familienmitglieder abgeglichen. Home Assistant aktualisiert Klender alle 15 Minuten, auch bei geschlossener Ansicht.</p>'+
    '<form id="klender-form" class="klender-form"><label>Klender-ICS-Link<input type="password" name="url" autocomplete="off" spellcheck="false" maxlength="4000" required placeholder="'+(klender.url?'Neuen Link eingeben':'https://… oder webcal://…')+'"></label><button class="primary" type="submit">'+(klender.url?'Link ersetzen':'Kalender verbinden')+'</button></form>'+
    '<p id="klender-status" role="status">'+escape(feedStatus())+'</p>'+
    (klender.url?'<div class="actions">'+button('show-klender','','Klender-Termine ansehen','ghost')+button('klender-rules','','Zuordnungsregeln','ghost')+button('klender-refresh','','Jetzt aktualisieren','ghost')+button('klender-remove','','Abo entfernen','ghost')+'</div>':'')+
    '<div><a href="https://app.klender.nl/" rel="noopener noreferrer" target="_blank">Klender öffnen ↗</a></div></section>'+
    klenderRulePanel()+
    shoppingSettings()+
    tabletSettings()+
    '<section class="panel settings"><h2>Kalenderdateien</h2><div class="actions">'+button('ics-in','','ICS-Datei importieren','ghost')+button('ics-out','','ICS exportieren','ghost')+'</div></section>'+ 
    '<section class="panel settings"><h2>Choosy</h2><p>Öffne in Choosy ein Rezept und teile es. Wenn Choosy einen Link bereitstellt, füge ihn beim Gericht im Feld „Rezeptlink“ ein.</p><div><a href="https://choosy.de/" rel="noopener noreferrer" target="_blank">Choosy öffnen ↗</a></div></section>'+
    '<section class="panel settings"><h2>Datensicherung</h2><p>Exportiere deine Einträge und Familiennamen als JSON. Beim Wiederherstellen ersetzt die ausgewählte Datei den Datenbestand in Home Assistant.</p><div class="actions">'+button('json-in','','Sicherung wiederherstellen','ghost')+button('json-out','','Sicherung herunterladen','ghost')+'</div></section></div>';
}
function taskReport(){
  const [start,end]=bounds(state.period,state.anchor);
  let rows=completedTasks(entries,start,end);
  if(state.person)rows=rows.filter(row=>state.person==='unassigned'?!row.completedBy:row.completedBy===state.person);
  const people=[...members.map(m=>({id:m.id,name:memberName(m)})),{id:'',name:'Ohne Personenangabe'}];
  return '<section class="panel task-report"><div class="panel-head"><h2>Wer hat was erledigt?</h2></div><div class="settings"><p>'+escape(shortDate.format(date(start))+' – '+shortDate.format(date(end)))+' · Nach erledigender Person, unabhängig vom Statusfilter. Bei älteren Einträgen wird ersatzweise die Fälligkeit verwendet; Einträge ohne Datum werden gesondert gekennzeichnet.</p>'+people.filter(p=>!state.person||(state.person==='unassigned'?!p.id:p.id===state.person)).map(person=>{
    const own=rows.filter(row=>(row.completedBy||'')===person.id);
    return '<details class="report-person"><summary>'+escape(person.name)+' · '+own.length+' erledigt</summary>'+(own.length?'<ul>'+own.map(row=>'<li><strong>'+escape(row.title)+'</strong> · '+(row.type==='routine'?'Routine':'Aufgabe')+' · '+escape(row.completionDate?shortDate.format(date(row.completionDate))+(row.exactCompletion?'':' (Fälligkeit; Erledigungsdatum unbekannt)'):'Datum unbekannt')+'</li>').join('')+'</ul>':'<p>Keine Erledigungen im Zeitraum.</p>')+'</details>';
  }).join('')+'</div></section>';
}
function render(){
  if(isMoving())return;
  const {page}=state;
  document.body.dataset.page=page;
  $('#logo').innerHTML=icon('home');
  $('#nav').innerHTML='<div class="nav-label">HAUSHALT</div>'+['overview','calendar','meal','task','buy','outing','settings'].map(nav).join('');
  $('#aside-bottom').innerHTML='<div class="nav-btn">'+icon('home')+'Home Assistant verbunden</div>';
  $('#breadcrumb').innerHTML='Haushalt <span aria-hidden="true">/</span> <b>'+sectionNames[page]+'</b>';
  const overview=page==='overview';
  const heading=overview?'Heute & nächste Woche':page==='calendar'?'Familienagenda':sectionNames[page];
  const subtitle={mealidea:'Sammle Wünsche und plane sie für eine Woche ein.',outing:'Ideen und Wünsche für eure gemeinsame Zeit.',overview:'Aufgaben, Einkäufe, Termine und Mahlzeiten an einem Ort.',task:'Weise Aufgaben zu und halte fest, wer sie erledigt hat.',buy:'Sieh deine Einkäufe nach Ladenkategorien sortiert.',calendar:'Plane Termine und markiere, wer dabei ist.',meal:'Plane Mahlzeiten und hinterlege Links zu deinen Rezepten.',routine:'Hake jeden wiederkehrenden Termin einzeln ab.',settings:'Bearbeite Familiennamen, verbinde Klender und sichere deine Daten.'}[page];
  const cta=page==='settings'?'':button('add',overview?'':page,icon('plus')+(overview?'Neuer Eintrag':sections[page].one+' hinzufügen'),'primary');
  const hero='<section class="hero"><div><div class="eyebrow">'+escape(fullDate.format(date(today())))+'</div><h1>'+heading+'</h1><p>'+subtitle+'</p></div><div class="hero-side">'+(overview&&kiosk.on?kioskNav():'')+(overview?heroWeather():'')+(overview&&kiosk.on?'<div class="hero-clock" id="hero-clock">'+escape(clockText())+'</div>'+button('kiosk-toggle','',icon('shrink'),'kiosk-exit','Vollbild beenden'):kiosk.on?button('page','overview','← Übersicht','primary kiosk-back','Zurück zur Übersicht'):cta)+'</div></section>';
  if(page==='settings'){$('#app').innerHTML=hero+'<div class="toolbar"></div>'+settings()+footer();return;}
  if(overview){renderOverview(hero);return;}
  const rows=visibleRows();
  const groups=Object.fromEntries(Object.keys(sections).map(type=>[type,rows.filter(row=>row.type===type)]));
  const types=pageTypes();
  $('#app').innerHTML=hero+toolbar()+(page==='buy'?shoppingControls():'')+'<div class="grid">'+
    types.map(type=>type==='calendar'?(state.period==='month'?monthCalendar(groups[type]):moveDays(type,groups[type])):type==='meal'?moveDays(type,groups[type]):panel(type,groups[type],overview)).join('')+'</div>'+(page==='task'?taskReport():'')+footer();
}
function navigate(page){
  if(!Object.hasOwn(sectionNames,page))return;
  state.page=page;if(page==='meal')state.period='week';state.anchor=today();state.status=page==='buy'?'open':'all';state.priority='';state.category='';state.shoppingList='';state.person='';
  if(location.hash!=='#'+page)history.pushState(null,'','#'+page);
  render();window.scrollTo(0,0);
}
function formFields(type,row={}){
  const def=sections[type];
  const field=(name,label,kind='text',value='',extra='',wide=false)=>'<label class="'+(wide?'full':'')+'">'+label+'<input name="'+name+'" type="'+kind+'" value="'+escape(value)+'" '+extra+'></label>';
  const required=['calendar','meal','routine'].includes(type);
  const cats=[...new Set([...def.categories,...entries.filter(item=>item.type===type).map(item=>item.category).filter(Boolean)])];
  $('#fields').innerHTML='<label class="full">Bereich<select name="type" '+(editing.id||editing.fixed?'disabled':'')+'>'+Object.entries(sections).map(([id,s])=>option(id,s.name,type)).join('')+'</select></label>'+
    field('title','Titel','text',row.title,'required maxlength="140"',true)+
    field('date',type==='routine'?'Erster Termin':required?'Datum':'Fällig am','date',row.date??(['buy','mealidea','outing'].includes(type)?'':state.anchor),required?'required':'')+
    '<label>Priorität<select name="priority">'+Object.entries(priorities).map(([id,label])=>option(id,label,row.priority||(['task','routine','outing'].includes(type)?'none':'normal'))).join('')+'</select></label>'+
    (type==='buy'
      ? '<label>Ladenkategorie<select name="category">'+option('','Ohne Ladenkategorie',row.category??state.category)+cats.map(name=>option(name,name,row.category??state.category)).join('')+'</select></label>'
      : field('category','Kategorie','text',row.category,'list="categories" maxlength="70"')+'<datalist id="categories">'+cats.map(c=>option(c,c)).join('')+'</datalist>')+
    (type==='buy'?field('quantity','Menge','text',row.quantity,'maxlength="60"')+field('list','Einkaufsliste','text',row.list??(state.shoppingList||'Standard'),'list="lists" maxlength="70"')+'<datalist id="lists">'+listNames().map(name=>option(name,name)).join('')+'</datalist>':'')+
    (type==='calendar'?field('time','Uhrzeit','time',row.time)+
      attendeePicker(row.attendees):'')+
    (['task','routine'].includes(type)?'<label>Zuständig<select name="assignee">'+option('','Freie Aufgabe',row.assignee||'')+memberOptions(row.assignee)+'</select></label>'+
      (row.done?'<label>Erledigt von<select name="completedBy">'+option('','Ohne Angabe',row.completedBy||'')+memberOptions(row.completedBy)+'</select></label>':''):'')+
    (['mealidea','outing'].includes(type)?'<label>Vorgeschlagen von<select name="suggestedBy">'+option('','Ohne Angabe',row.suggestedBy||'')+memberOptions(row.suggestedBy)+'</select></label>':'')+
    (['meal','mealidea','outing'].includes(type)?field('url','Rezeptlink (z. B. Choosy)','url',row.url,'placeholder="https://…" maxlength="1500"',true):'')+
    (['task','routine'].includes(type)?'<label>Wiederholung<select name="repeat">'+(type==='task'?option('none','Einmalig',row.repeat||'none'):'')+Object.entries(intervals).map(([id,label])=>option(id,label,row.repeat||(type==='routine'?'weekly':'none'))).join('')+'</select></label>':'')+
    '<label class="full">Notizen<textarea name="notes" maxlength="1800" placeholder="Details ergänzen">'+escape(row.notes)+'</textarea></label>';
  $('#fields [name=type]').addEventListener('change',event=>{
    const current=Object.fromEntries(new FormData($('#entry')));
    editing.type=event.target.value;
    formFields(editing.type,{title:current.title,notes:current.notes,priority:current.priority});
    $('#fields [name=type]').focus();
  });
}
function openEditor(type,id){
  const row=entries.find(item=>item.id===id);
  editing={id:row?.id,type:row?.type||type||'task',fixed:!!type};
  $('#dialog-title').textContent=row?'Eintrag bearbeiten':type?sections[type].one+' hinzufügen':'Neuer Eintrag';
  $('#delete').hidden=!row;
  formFields(editing.type,row);
  $('#editor').showModal();
  $('#fields [name=title]').focus();
}
function confirm(title,description,action){
  $('#confirm-title').textContent=title;$('#confirm-text').textContent=description;confirmAction=action;$('#confirm-box').showModal();
}
function download(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function pickFile(kind){
  const input=$('#import-file');input.dataset.kind=kind;input.accept=kind==='ics'?'.ics,text/calendar':'.json,application/json';input.value='';input.click();
}
$('#entry').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=new FormData(event.target);
  const values=Object.fromEntries([...form].map(([k,v])=>[k,v.trim()]));
  if(editing.type==='calendar')values.attendees=form.getAll('attendees');
  if(!values.title){const title=$('#fields [name=title]');title.setCustomValidity('Bitte gib einen Titel ein.');title.reportValidity();title.addEventListener('input',()=>title.setCustomValidity(''),{once:true});return;}
  if(values.url&&!safeURL(values.url)){const url=$('#fields [name=url]');url.setCustomValidity('Bitte verwende einen HTTP- oder HTTPS-Link.');url.reportValidity();url.addEventListener('input',()=>url.setCustomValidity(''),{once:true});return;}
  const previous=entries.find(row=>row.id===editing.id);
  const item={...previous,...values,id:previous?.id||uuid(),type:editing.type,done:previous?.done??false,demo:false};
  if(item.type==='task'&&item.repeat&&item.repeat!=='none'){item.type='routine';item.done=false;delete item.completedBy;}
  if(item.type==='routine'){
    if(!item.date){const input=$('#fields [name=date]');input.setCustomValidity('Bitte wähle ein Startdatum für die Wiederholung.');input.reportValidity();input.addEventListener('input',()=>input.setCustomValidity(''),{once:true});return;}
    item.completed=previous?.completed??[];
  }
  if(await persist(previous?entries.map(row=>row.id===item.id?item:row):[...entries,item],'Eintrag gespeichert.'))$('#editor').close();
});
function focusTaskCheck(id){
  [...document.querySelectorAll('[data-check]')].find(input=>input.dataset.check===id)?.focus();
}
$('#completion').addEventListener('close',()=>focusTaskCheck(completionId));
$('#completion-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const person=$('#completed-by').value;
  if(!isMember(person))return;
  const next=entries.map(row=>{
    if(row.id!==completionId)return row;
    if(row.type==='routine')return {...row,completed:[...new Set([...(row.completed??[]),completionDay])],completedByDate:{...row.completedByDate,[completionDay]:person},completedOnByDate:{...row.completedOnByDate,[completionDay]:today()}};
    return {...row,done:true,completedBy:person,completedOn:today()};
  });
  if(await persist(next,'Aufgabe abgehakt.'))$('#completion').close();
});
document.addEventListener('submit',async event=>{
  if(event.target.id==='shop-category-form'){
    event.preventDefault();
    const name=String(new FormData(event.target).get('category')||'').trim();
    if(!name)return;
    if(shopCategories.some(c=>c.toLocaleLowerCase('de')===name.toLocaleLowerCase('de'))){notify('Diese Kategorie gibt es bereits.');return;}
    try{await hubStorage.setItem(shopCategoriesKey,JSON.stringify({categories:[...shopCategories,name]}));reloadShopCategories();render();notify('Ladenkategorie angelegt.');}catch(error){notify(error.message);}
    return;
  }
  if(event.target.id==='alexa-add'){
    event.preventDefault();
    const form=event.target;
    const submit=form.querySelector('button[type=submit]');
    submit.disabled=true;
    try{
      await request('shopping/add',{title:String(new FormData(form).get('title')).trim()});
      form.reset();
      await loadShopping(true);
    }catch(error){notify(error.message);}
    finally{submit.disabled=false;}
    return;
  }
  if(event.target.id==='todo-settings'){
    event.preventDefault();
    try{
      await request('settings/todo',{entity:String(new FormData(event.target).get('entity')).trim()});
      mergeSnapshot(await latestSnapshot(),[],['todo_entity']);
      await loadShopping(true);
      notify('Alexa-Liste verbunden.');
    }catch(error){notify(error.message);}
    return;
  }

  if(event.target.id==='klender-rule-form'){
    event.preventDefault();
    const form=new FormData(event.target);
    saveKlenderRule(form.get('signal'),form.getAll('attendees').filter(isMember));
    return;
  }
  if(event.target.id==='klender-people-form'){
    event.preventDefault();
    const form=new FormData(event.target);
    const category=String(form.get('category')||'').trim();
    const next={...klenderCategories};
    if(category)next[klenderSelection]=category;else delete next[klenderSelection];
    try{await hubStorage.setItem(klenderCategoriesKey,JSON.stringify(next));klenderCategories=next;}catch(error){notify(error.message);return;}
    await saveKlenderPeople(form.getAll('attendees').filter(isMember));
    return;
  }
  if(event.target.id==='klender-form'){
    event.preventDefault();
    void loadKlender(String(new FormData(event.target).get('url')).trim(),true);
    return;
  }
  if(event.target.id!=='family-form')return;
  event.preventDefault();
  const form=new FormData(event.target);
  const names=Object.fromEntries(members.map(member=>[member.id,form.get(member.id).trim()]));
  if(await persist(entries,'Familiennamen gespeichert.',names))$('#family-form button').focus();
});
document.addEventListener('click',async event=>{
  const target=event.target.closest('button');
  if(!target)return;
  const {action,value}=target.dataset;
  if(action==='page')navigate(value);
  if(action==='add-on-day'){state.anchor=value;openEditor('calendar');}
  if(action==='plan-idea'){
    const row=entries.find(item=>item.id===value);
    if(row){openEditor('meal');formFields('meal',{title:row.title,notes:row.notes,url:row.url,date:state.anchor,category:'Abendessen'});}
  }
  if(action==='shopping-refresh')await loadShopping(true);
  if(action==='save-todo')return;

  if(action==='remove-avatar'&&isMember(value))await saveAvatar(value,null);
  if(action==='step-period'){
    const step=Number(value);
    if(state.period==='month'){
      const day=date(state.anchor);
      state.anchor=key(new Date(day.getFullYear(),day.getMonth()+step,1));
    }else state.anchor=shift(state.anchor,step*(state.period==='week'?7:1));
    render();
  }
  if(action==='current-period'){state.anchor=today();render();}
  if(action==='period'){state.period=value;render();}
  if(action==='add')openEditor(value);
  if(action==='restore-calendar-move')void restoreCalendarMove(value);
  if(action==='overview-event')openOverviewEvent(value);
  if(action==='kiosk-toggle')setKiosk(!kiosk.on);
  if(action==='kiosk-test-saver')showSaver('test');
  if(action==='edit'){$('#event-details').close();openEditor('',value);}
  if(action==='remove-demo')confirm('Beispieldaten entfernen?','Deine eigenen und bearbeiteten Einträge bleiben erhalten.',()=>persist(entries.filter(row=>!row.demo),'Beispieldaten entfernt.'));
  if(action==='klender-settings'){navigate('settings');$('#klender-form input').focus();}
  if(action==='show-klender'){
    state.period='month';state.status='all';state.priority='';
    navigate('calendar');state.category='Klender';render();
  }
  if(action==='klender-people'){$('#event-details').close();openKlenderPeople(value);}
  if(action==='cancel-klender-people')$('#klender-people').close();
  if(action==='restore-klender-people')saveKlenderPeople(null);
  if(action==='klender-rules'){
    if(state.page!=='settings')navigate('settings');
    $('#klender-rule-select')?.focus();
    $('#klender-rules')?.scrollIntoView({block:'nearest'});
  }
  if(action==='remove-klender-rule')saveKlenderRule(value,null);
  if(action==='klender-refresh')void loadKlender(klender.url,true);
  if(action==='klender-remove')confirm('Klender-Abo entfernen?','Die Termine aus dem Abo verschwinden aus Familyhub.',async()=>{
    try{await removeFeed();render();notify('Klender-Abo entfernt.');}
    catch{notify('Das Kalender-Abo konnte nicht entfernt werden.');}
  });
  if(action==='cancel-completion')$('#completion').close();
  if(action==='json-out')download('haushaltszentrale-'+today()+'.json',backup(entries,memberNames),'application/json');
  if(action==='ics-out'){
    if(!entries.some(row=>row.type==='calendar'&&!row.demo)){notify('Lege zuerst einen eigenen Termin an.');return;}
    download('familienkalender.ics',exportCalendar(entries),'text/calendar;charset=utf-8');
  }
  if(action==='json-in')pickFile('json');
  if(action==='ics-in')pickFile('ics');
  if(target.classList.contains('close'))target.closest('dialog')?.close();
  if(target.id==='delete')confirm('Eintrag löschen?',editing.type==='routine'?'Die Routine und alle zugehörigen Abhakungen werden gelöscht.':'Der Eintrag wird aus Familyhub entfernt.',async()=>{if(await persist(entries.filter(row=>row.id!==editing.id),'Eintrag gelöscht.'))$('#editor').close();});
  if(target.id==='cancel-confirm')$('#confirm-box').close();
  if(target.id==='approve-confirm'){$('#confirm-box').close();await confirmAction?.();}
});
document.addEventListener('change',async event=>{
  const target=event.target;
  if(target.dataset.alexaCheck){
    target.disabled=true;
    try{await request('shopping/check',{uid:target.dataset.alexaCheck,done:target.checked});await loadShopping(true);}
    catch(error){target.checked=!target.checked;notify(error.message);}
    finally{target.disabled=false;}
    return;
  }
  if(target.dataset.alexaCategory){
    const next={...shoppingMeta,[target.dataset.alexaCategory]:target.value};
    try{await hubStorage.setItem('familyhub-shopping-meta-v1',JSON.stringify(next));shoppingMeta=next;render();}
    catch(error){notify(error.message);}
    return;
  }
  if(target.dataset.avatar&&target.files?.length&&isMember(target.dataset.avatar)){
    const id=target.dataset.avatar;
    target.disabled=true;
    try{await saveAvatar(id,await avatarFromFile(target.files[0]));}
    catch(error){notify(error instanceof DOMException?'Das Bild konnte nicht geöffnet werden.':error.message);}
    finally{target.disabled=false;target.value='';}
    return;
  }
  if(target.id==='klender-rule-select'){
    $('#klender-rule-people').innerHTML=attendeePicker(klenderRules[target.value]?.people);
    return;
  }
  if(target.dataset.filter){state[target.dataset.filter]=target.value;render();[...document.querySelectorAll('[data-filter]')].find(control=>control.dataset.filter===target.dataset.filter)?.focus();return;}
  if(target.dataset.check){
    const {check,day}=target.dataset;
    const entry=entries.find(row=>row.id===check);
    if(['task','routine'].includes(entry?.type)&&target.checked){
      target.checked=false;
      completionId=entry.id;completionDay=day;
      $('#completion-task').textContent=entry.title;
      $('#completed-by').innerHTML=option('','Person auswählen',entry.assignee||'')+memberOptions(entry.assignee);
      $('#completion').showModal();
      $('#completed-by').focus();
      return;
    }
    const next=entries.map(row=>{
      if(row.id!==check)return row;
      if(row.type==='task')return {...row,done:false,completedBy:'',completedOn:''};
      if(row.type!=='routine')return {...row,done:target.checked};
      const completed=new Set(row.completed);
      if(target.checked)completed.add(day);else completed.delete(day);
      const completedByDate={...row.completedByDate};delete completedByDate[day];
      const completedOnByDate={...row.completedOnByDate};delete completedOnByDate[day];
      return {...row,completed:[...completed],completedByDate,completedOnByDate};
    });
    if(await persist(next,target.checked?'Abgehakt.':'Wieder geöffnet.')){
      [...document.querySelectorAll('[data-check]')].find(input=>input.dataset.check===check&&input.dataset.day===day)?.focus();
    }else target.checked=!target.checked;
    return;
  }
  if(target.id!=='import-file'||!target.files.length)return;
  try{
    const raw=await target.files[0].text();
    if(target.dataset.kind==='json'){
      const restored=parseBackup(raw);
      confirm('Sicherung wiederherstellen?',restored.entries.length+' Einträge aus der Sicherung ersetzen die aktuellen Daten. Enthaltene Familiennamen werden ebenfalls übernommen.',()=>persist(restored.entries,'Sicherung wiederhergestellt.',restored.memberNames??memberNames));
      return;
    }
    const {events,skipped}=importCalendar(raw);
    if(!events.length){notify(skipped?'Keine unterstützten Einzeltermine gefunden.':'Der Kalender enthält keine Termine.');return;}
    confirm('Kalender importieren?',events.length+' Einzeltermine werden übernommen. '+(skipped?skipped+' Einträge werden übersprungen. ':'' )+'Bereits importierte Termine mit gleicher Kalender-ID werden aktualisiert.',async()=>{
      const next=[...entries];
      for(const row of events){
        const index=next.findIndex(item=>item.type==='calendar'&&(item.externalId===row.externalId||item.id+'@haushaltszentrale'===row.externalId));
        if(index<0)next.push(row);else next[index]={...next[index],title:row.title,notes:row.notes,time:row.time,date:row.date};
      }
      if(await persist(next,'Kalender importiert.')){state.period='month';navigate('calendar');}
    });
  }catch(error){notify(error instanceof SyntaxError?'Ungültige JSON-Datei.':error.message);}
});
function moveHandle(row){
  if(!['meal','calendar'].includes(row.type))return '';
  return '<button type="button" class="move-handle" data-move-id="'+escape(row.id)+'" data-move-kind="'+row.type+'" aria-label="'+escape(row.title)+' verschieben" title="Ziehen oder antippen zum Verschieben"><span class="grip-dots" aria-hidden="true"></span></button>';
}
function moveDays(type,rows){
  const [start,end]=periodBounds();let body='';
  for(let day=start;day<=end;day=shift(day,1)){
    const items=rows.filter(row=>row.date===day);
    body+='<section class="move-day" data-drop-kind="'+type+'" data-drop-day="'+day+'"><div class="date-head">'+escape(dayDate.format(date(day)))+'</div><div class="rows">'+(items.length?items.map(row=>rowHTML(row,true)).join(''):'<p class="empty">'+(type==='meal'?'Noch kein Gericht – hier ablegen':'Keine Termine – hier ablegen')+'</p>')+'</div></section>';
  }
  return '<section class="panel full"><div class="panel-head">'+glyph(type)+'<h2>'+sections[type].name+'</h2></div><p class="move-help">Am Griff ⠿ ziehen oder zum Auswählen eines Datums antippen.'+(type==='meal'?' Belegte Tage erlauben zusätzlich das Tauschen.':' Klender-Verschiebungen gelten nur in Familyhub.')+'</p>'+body+'</section>';
}
function movableRow(id){return entries.find(row=>row.id===id)||visibleRows().find(row=>row.id===id&&row.source==='klender');}
function updateMoveChoices(preferred=''){
  if(!moveSelection)return;
  const day=$('#move-date').value;
  const targets=entries.filter(row=>row.type==='meal'&&row.date===day&&row.id!==moveSelection.id&&day!==moveSelection.date);
  $('#move-targets').innerHTML=targets.map(row=>option(row.id,row.title,preferred||targets[0]?.id)).join('');
  $('#move-swap-option').disabled=!targets.length;
  $('#move-target-label').hidden=!targets.length;
  if(!targets.length)$('#move-mode').value='move';
}
function openMovePicker(id,day='',preferred=''){
  const row=movableRow(id);if(!row)return;
  moveSelection={...row};
  $('#move-title').textContent=row.type==='meal'?'Gericht verschieben oder tauschen':'Termin verschieben';
  $('#move-name').textContent=row.title;
  $('#move-date').value=day||row.date;
  $('#move-hint').textContent=row.source==='klender'?'Nur in Familyhub: Der Originaltermin in Klender bleibt unverändert. Diese lokale Verschiebung bleibt bei Kalenderaktualisierungen erhalten.':'Uhrzeit, Personen, Kategorie und Notizen bleiben erhalten.';
  $('#move-meal-options').hidden=row.type!=='meal';
  $('#move-mode').value='move';updateMoveChoices(preferred);
  $('#move-editor').showModal();$('#move-date').focus();
}
async function dropEntry(id,day,targetId=''){
  const row=movableRow(id);if(!row||row.date===day||moveBusy)return;
  if(row.source==='klender'||row.type==='meal'&&entries.some(item=>item.type==='meal'&&item.id!==id&&item.date===day)){openMovePicker(id,day,targetId);return;}
  await commitMove(row,day);
}
async function commitMove(row,day,swapId=''){
  if(moveBusy)return false;
  moveBusy=true;
  try{
    if(row.source==='klender'){
      // Validate the day using the same calendar-date validation as own events.
      moveEntries([{id:row.id,type:'calendar',date:row.date}],row.id,day);
      const next={...calendarMoves};
      const originalDate=calendarMoves[row.id]?.originalDate||row.date;
      if(day===originalDate)delete next[row.id];else next[row.id]={date:day,originalDate};
      await hubStorage.setItem(calendarMovesKey,JSON.stringify(next));calendarMoves=next;render();notify('Termin nur in Familyhub verschoben.');return true;
    }
    const current=entries.find(item=>item.id===row.id);
    if(!current||current.date!==row.date)throw Error('Der Eintrag hat sich geändert. Bitte erneut auswählen.');
    return await persist(moveEntries(entries,row.id,day,swapId),swapId?'Gerichte getauscht.':'Eintrag verschoben.');
  }catch(error){notify(error.message);return false;}
  finally{moveBusy=false;}
}
async function restoreCalendarMove(id){
  const next={...calendarMoves};delete next[id];
  try{await hubStorage.setItem(calendarMovesKey,JSON.stringify(next));calendarMoves=next;$('#event-details').close();render();notify('Originaldatum aus Klender wiederhergestellt.');}catch(error){notify(error.message);}
}
$('#move-date').addEventListener('change',()=>updateMoveChoices());
$('#move-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!moveSelection||moveBusy)return;
  const submit=event.target.querySelector('[type=submit]');submit.disabled=true;
  try{if(await commitMove(moveSelection,$('#move-date').value,moveSelection.type==='meal'&&$('#move-mode').value==='swap'?$('#move-targets').value:''))$('#move-editor').close();}finally{submit.disabled=false;}
});

/* ---------- Tablet-Vollbild & Einbrennschutz (1.4.0) ----------
   Settings are stored per device (localStorage), so a wall tablet can run in
   kiosk mode while phones keep the normal view. */
const kioskKey='familyhub-kiosk-v1';
const kioskDefaults={on:false,nightMode:true,nightStart:'22:00',nightEnd:'06:00',saverMinutes:15,shift:true,returnMinutes:2};
function readKiosk(){try{return JSON.parse(localStorage.getItem(kioskKey))||{};}catch{return {};}}
const kiosk={...kioskDefaults,...readKiosk()};
function saveKiosk(){try{localStorage.setItem(kioskKey,JSON.stringify(kiosk));}catch{/* private mode */}}
const clockFormat=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const clockText=()=>clockFormat.format(new Date());
const toMinutes=value=>{const match=/^(\d{2}):(\d{2})$/.exec(String(value));return match?Number(match[1])*60+Number(match[2]):NaN;};
function inNight(){
  if(!kiosk.nightMode)return false;
  const start=toMinutes(kiosk.nightStart),end=toMinutes(kiosk.nightEnd),now=toMinutes(clockText());
  if(Number.isNaN(start)||Number.isNaN(end)||start===end)return false;
  return start<end?now>=start&&now<end:now>=start||now<end;
}
let lastActivity=Date.now(),wakeUntil=0,saverMode='',saverTest=false,fullscreenAsked=false;
function tellParent(){parent.postMessage({kind:'familyhub-kiosk',on:kiosk.on},location.origin);}
function setKiosk(on){
  kiosk.on=on;saveKiosk();
  document.body.classList.toggle('kiosk',on);
  fullscreenAsked=on;
  tellParent();
  lastActivity=Date.now();
  if(!on){hideSaver();document.body.style.removeProperty('--shift-x');document.body.style.removeProperty('--shift-y');}
  if(on&&state.page!=='overview')navigate('overview');else render();
  notify(on?'Vollbild aktiv. Zum Beenden das Symbol neben der Uhr antippen.':'Vollbild beendet.');
}
function kioskNav(){
  const items=[['calendar','calendar','Familienkalender'],['meal','meal','Essensplan'],['task','check','Aufgaben'],['buy','cart','Einkäufe'],['outing','outing','Unternehmungen']];
  return '<nav class="kiosk-nav" aria-label="Bereiche">'+items.map(([page,ic,label])=>'<button type="button" class="kiosk-tab" data-action="page" data-value="'+page+'" aria-label="'+label+'" title="'+label+'"><span class="glyph '+page+'">'+icon(ic)+'</span></button>').join('')+'</nav>';
}
function tabletSettings(){
  const check=(name,label)=>'<label class="check-line"><input type="checkbox" name="'+name+'" '+(kiosk[name]?'checked':'')+'> '+label+'</label>';
  return '<section class="panel settings" id="tablet-settings"><h2>Tablet & Vollbild</h2><p>Gilt nur für dieses Gerät. Im Vollbild zeigt Familyhub nur die Übersicht, hält den Bildschirm wach und schützt ihn vor dem Einbrennen.</p>'+
    '<form id="tablet-form" class="tablet-form">'+
    check('shift','Inhalt alle 2 Minuten minimal verschieben (gegen Einbrennen)')+
    check('nightMode','Nachtmodus: Bildschirm abdunkeln, nur Uhr anzeigen')+
    '<div class="tablet-times"><label>Nacht von<input type="time" name="nightStart" value="'+escape(kiosk.nightStart)+'"></label><label>bis<input type="time" name="nightEnd" value="'+escape(kiosk.nightEnd)+'"></label></div>'+
    '<label>Im Vollbild zurück zur Übersicht nach (Minuten ohne Berührung, 0 = aus)<input type="number" name="returnMinutes" min="0" max="60" step="1" value="'+escape(kiosk.returnMinutes)+'"></label>'+
    '<label>Bildschirmschoner nach (Minuten ohne Berührung, 0 = aus)<input type="number" name="saverMinutes" min="0" max="240" step="1" value="'+escape(kiosk.saverMinutes)+'"></label>'+
    '<div class="actions"><button class="primary" type="submit">Speichern</button>'+button('kiosk-test-saver','','Bildschirmschoner testen','ghost')+button('kiosk-toggle','',kiosk.on?'Vollbild beenden':'Vollbild starten','ghost')+'</div></form>'+
    '<p>Tipp fürs iPad: Automatische Sperre auf „Nie“ stellen (Einstellungen → Anzeige & Helligkeit) und mit „Geführter Zugriff“ die App fixieren.</p></section>';
}
document.addEventListener('submit',event=>{
  if(event.target.id!=='tablet-form')return;
  event.preventDefault();
  const data=new FormData(event.target);
  const start=String(data.get('nightStart')||''),end=String(data.get('nightEnd')||'');
  const minutes=Math.max(0,Math.min(240,Math.round(Number(data.get('saverMinutes'))||0)));
  const back=Math.max(0,Math.min(60,Math.round(Number(data.get('returnMinutes'))||0)));
  if(!/^\d{2}:\d{2}$/.test(start)||!/^\d{2}:\d{2}$/.test(end)){notify('Bitte gültige Uhrzeiten eingeben.');return;}
  Object.assign(kiosk,{shift:data.has('shift'),nightMode:data.has('nightMode'),nightStart:start,nightEnd:end,saverMinutes:minutes,returnMinutes:back});
  saveKiosk();notify('Tablet-Einstellungen gespeichert (nur dieses Gerät).');
});
function saverHTML(){
  const now=today();
  const clock=clockText();
  const events=visibleRows().filter(row=>row.type==='calendar'&&!row.done&&isUpcoming(row,now,clock)&&row.date<=shift(now,1)).slice(0,4);
  const meals=entries.filter(row=>row.type==='meal'&&row.date===now).map(row=>row.title);
  const todayWeather=weather?weatherFor(now):null;
  return '<div class="saver-clock">'+escape(clock)+'</div><div class="saver-date">'+escape(fullDate.format(date(now)))+'</div>'+
    (weather?'<div class="saver-weather">'+weatherIcon(weather.condition)+' '+roundTemp(weather.temperature)+(todayWeather?' <small>'+roundTemp(todayWeather.temperature)+' / '+roundTemp(todayWeather.templow)+'</small>':'')+'</div>':'')+
    (saverMode==='night'?'':
      (meals.length?'<div class="saver-line">🍽️ '+escape(meals.join(', '))+'</div>':'')+
      (events.length?'<ul class="saver-events">'+events.map(row=>'<li><b>'+escape(row.date===now?(row.time||'Heute'):'Morgen'+(row.time?' '+row.time:''))+'</b> '+escape(row.title)+'</li>').join('')+'</ul>':''))+
    '<div class="saver-hint">Tippen zum Aufwecken</div>';
}
function placeSaver(box){
  // Move the content to a new spot every minute, so nothing stays on the same pixels.
  const x=10+Math.random()*80,y=12+Math.random()*70;
  box.style.left=x+'%';box.style.top=y+'%';
}
function showSaver(mode){
  let layer=document.getElementById('saver');
  if(!layer){
    layer=document.createElement('div');layer.id='saver';
    layer.innerHTML='<div class="saver-box"></div>';
    layer.addEventListener('pointerdown',event=>{
      event.preventDefault();event.stopPropagation();
      if(saverMode==='night')wakeUntil=Date.now()+2*60*1000;
      lastActivity=Date.now();hideSaver();
    });
    document.body.append(layer);
  }
  saverTest=mode==='test';
  saverMode=saverTest?(inNight()?'night':'idle'):mode;
  layer.className=saverMode;
  const box=layer.firstElementChild;
  box.innerHTML=saverHTML();
  placeSaver(box);
  layer.hidden=false;
}
function hideSaver(){const layer=document.getElementById('saver');if(layer)layer.hidden=true;saverMode='';saverTest=false;}
function updateSaver(){const layer=document.getElementById('saver');if(layer&&!layer.hidden)layer.firstElementChild.innerHTML=saverHTML();}
function kioskTick(){
  const heroClock=document.getElementById('hero-clock');
  if(heroClock)heroClock.textContent=clockText();
  if(saverTest)return;
  if(!kiosk.on){if(saverMode)hideSaver();return;}
  const idle=Date.now()-lastActivity;
  const busy=!!document.querySelector('dialog[open]')||isMoving();
  // On a sub page, go back to the overview after a while without touch.
  const typing=document.activeElement?.matches?.('input,textarea,select');
  if(!busy&&!typing&&state.page!=='overview'&&kiosk.returnMinutes>0&&idle>kiosk.returnMinutes*60*1000){navigate('overview');return;}
  let want='';
  if(!busy&&inNight()&&Date.now()>wakeUntil&&idle>60*1000)want='night';
  else if(!busy&&kiosk.saverMinutes>0&&idle>kiosk.saverMinutes*60*1000)want='idle';
  if(want&&want!==saverMode)showSaver(want);
  else if(!want&&saverMode)hideSaver();
  // Reload once at night to keep a tablet that runs for weeks fresh.
  if(toMinutes(clockText())===210&&performance.now()>15*60*1000&&!busy)location.reload();
}
function kioskMinute(){
  if(kiosk.on&&kiosk.shift&&new Date().getMinutes()%2===0){
    document.body.style.setProperty('--shift-x',Math.round(Math.random()*12-6)+'px');
    document.body.style.setProperty('--shift-y',Math.round(Math.random()*12-6)+'px');
  }
  const layer=document.getElementById('saver');
  if(layer&&!layer.hidden){updateSaver();placeSaver(layer.firstElementChild);}
}
for(const type of ['pointerdown','keydown','touchstart']){
  document.addEventListener(type,()=>{
    lastActivity=Date.now();
    // Real fullscreen needs a tap; after a reload the first touch requests it again.
    if(kiosk.on&&!fullscreenAsked){fullscreenAsked=true;tellParent();}
  },{capture:true,passive:true});
}
if(kiosk.on){document.body.classList.add('kiosk');tellParent();}
setInterval(kioskTick,15*1000);
setInterval(kioskMinute,60*1000);

function useHash(){
  const page=location.hash.slice(1);
  state.page=Object.hasOwn(sectionNames,page)?page:'overview';
  state.status=state.page==='buy'?'open':'all';state.category='';state.shoppingList='';state.person='';render();
}
window.addEventListener('familyhub-conflict',()=>{
  calendarMoves=JSON.parse(hubStorage.getItem(calendarMovesKey))??{};
  reloadShopCategories();
  ({entries,memberNames}=readHousehold());
  avatars=readAvatars();
  klenderPeople=JSON.parse(hubStorage.getItem(klenderPeopleKey))??{};
  klenderRules=JSON.parse(hubStorage.getItem(klenderRulesKey))??{};
  klenderCategories=JSON.parse(hubStorage.getItem(klenderCategoriesKey))??{};
  shoppingMeta=JSON.parse(hubStorage.getItem('familyhub-shopping-meta-v1'))??{};
});
window.addEventListener('popstate',useHash);
document.addEventListener('visibilitychange',refreshWhenVisible);
setInterval(refreshWhenVisible,refreshInterval);
if(kiosk.on&&location.hash&&location.hash!=='#overview')history.replaceState(null,'','#overview');
useHash();
void loadShopping();
void loadWeather();
setInterval(()=>void loadWeather(),30*60*1000);
setInterval(()=>void synchronize(),10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void synchronize();});

let overviewResize;window.addEventListener('resize',()=>{clearTimeout(overviewResize);overviewResize=setTimeout(()=>{if(state.page==='overview'&&!document.querySelector('dialog[open]'))render();},150);});

isMoving=installMoveGestures({onDrop:dropEntry,onPick:openMovePicker,onError:error=>notify(error.message)});
