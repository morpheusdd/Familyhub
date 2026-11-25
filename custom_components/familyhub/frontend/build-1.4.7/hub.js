export function uuid(){
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
const pending=new Map();
let snapshot;
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==parent||event.data?.kind!=='familyhub-response')return;
  const job=pending.get(event.data.id);
  if(!job)return;
  clearTimeout(job.timer);
  pending.delete(event.data.id);
  if(event.data.error)job.reject(Error(event.data.error));
  else job.resolve(event.data.result);
});
export function request(action,payload={}){
  return new Promise((resolve,reject)=>{
    const id=uuid();
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Home Assistant antwortet nicht. Bitte die Verbindung prüfen.'));},30000);
    pending.set(id,{resolve,reject,timer,action});
    parent.postMessage({kind:'familyhub-request',id,action,payload},location.origin);
  });
}
export const hasPendingWrites=()=>[...pending.values()].some(job=>!['snapshot','shopping/list'].includes(job.action));
export const hubStorage={
  getItem(key){const value=snapshot.values[key];return value==null?null:JSON.stringify(value);},
  async setItem(key,raw){
    const value=JSON.parse(raw);
    let result;
    try{result=await request('write',{key,value,revision:snapshot.revisions[key]??0});}
    catch(error){
      if(error.message.includes('anderen Gerät')){
        mergeSnapshot(await request('snapshot'),[key]);
        window.dispatchEvent(new CustomEvent('familyhub-conflict'));
      }
      throw error;
    }
    snapshot.values[key]=result.value;
    snapshot.revisions[key]=result.revision;
  },
  async removeItem(key){return this.setItem(key,'null');},
};
export async function initialize(){snapshot=await request('snapshot');}
export function getSnapshot(){return snapshot;}
export async function latestSnapshot(){return request('snapshot');}
export function applySnapshot(next){snapshot=next;}

export function mergeSnapshot(next,keys=[],fields=[]){
  for(const key of keys){
    snapshot.values[key]=next.values[key];
    snapshot.revisions[key]=next.revisions[key];
  }
  for(const field of fields)snapshot[field]=next[field];
}
