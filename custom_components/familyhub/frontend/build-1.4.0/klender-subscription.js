import {readFeed} from './klender-parser.js';
import {hubStorage,request,latestSnapshot,mergeSnapshot} from './hub.js';

const storageKey='haushaltszentrale-klender-v1';
export const refreshInterval=15*60*1000;
const formatDate=new Intl.DateTimeFormat('de-DE',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Berlin'});
export const klender={url:'',feed:null,updatedAt:0,lastAttempt:0,error:'',request:null};
export function reloadFeed(){
  const saved=JSON.parse(hubStorage.getItem(storageKey));
  Object.assign(klender,{url:saved?.url??'',feed:saved?readFeed(saved.raw):null,updatedAt:saved?.updatedAt??0});
}
reloadFeed();
export function feedStatus(){
  if(klender.request)return 'Klender-Kalender wird geladen …';
  if(klender.error)return klender.error+(klender.feed?' Der zuletzt geladene Kalender bleibt sichtbar.':'');
  if(!klender.url)return 'Kein ICS-Link verbunden.';
  return 'Verbunden · Aktualisiert am '+formatDate.format(klender.updatedAt);
}
export async function refreshFeed(value,updateStatus){
  if(klender.request)return false;
  klender.request=true;
  klender.lastAttempt=Date.now();
  updateStatus();
  try{
    const saved=await request('calendar',{url:value});
    mergeSnapshot(await latestSnapshot(),[storageKey]);
    reloadFeed();
    klender.error='';
    return !!saved;
  }catch(error){klender.error=error.message;return false;}
  finally{klender.request=null;updateStatus();}
}
export async function removeFeed(){
  await request('calendar_remove');
  mergeSnapshot(await latestSnapshot(),[storageKey]);
  reloadFeed();
  klender.error='';
}
