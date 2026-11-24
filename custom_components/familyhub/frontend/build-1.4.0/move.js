const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
export function moveEntries(entries,id,day,swapId=''){
  if(!validDay(day))throw Error('Bitte wähle ein gültiges Datum.');
  const row=entries.find(item=>item.id===id);
  if(!row||!['meal','calendar'].includes(row.type))throw Error('Dieser Eintrag kann nicht verschoben werden.');
  const other=swapId&&entries.find(item=>item.id===swapId);
  if(swapId&&(!other||other.id===row.id||row.type!=='meal'||other.type!=='meal'||other.date!==day||other.date===row.date))throw Error('Die Gerichte können nicht getauscht werden. Bitte wähle das Ziel erneut.');
  return entries.map(item=>item.id===id?{...item,date:day}:other&&item.id===other.id?{...item,date:row.date}:item);
}
export function applyCalendarMove(row,moves){
  const move=moves[row.id];if(!move)return row;
  const delta=(Date.parse(move.date+'T12:00:00Z')-Date.parse(row.date+'T12:00:00Z'))/86400000;
  const shifted=value=>new Date(Date.parse(value+'T12:00:00Z')+delta*86400000).toISOString().slice(0,10);
  return {...row,date:move.date,endDate:row.endDate?shifted(row.endDate):undefined,localMove:true,originalDate:move.originalDate};
}
export function installMoveGestures({onDrop,onPick,onError}){
  let drag=null,ghost=null,target=null,suppress=false,scrollJob=0;
  function clear(){if(scrollJob)cancelAnimationFrame(scrollJob);scrollJob=0;ghost?.remove();ghost=null;target?.classList.remove('drop-active');target=null;document.body.classList.remove('moving-entry');}
  function cancel(){const current=drag;drag=null;clear();if(current?.handle.hasPointerCapture?.(current.pointer))current.handle.releasePointerCapture(current.pointer);}
  function hit(x,y){return document.elementFromPoint(x,y)?.closest('[data-drop-day]');}
  document.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-move-id]');if(!handle||event.button!==0||drag||event.isPrimary===false)return;
    drag={id:handle.dataset.moveId,kind:handle.dataset.moveKind,handle,pointer:event.pointerId,x:event.clientX,y:event.clientY,lastY:event.clientY,active:false};
    handle.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.pointer)return;
    if(!drag.active&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<7)return;
    if(!drag.active){drag.active=true;document.body.classList.add('moving-entry');ghost=document.createElement('div');ghost.className='move-ghost';ghost.textContent=drag.handle.getAttribute('aria-label');document.body.append(ghost);}
    event.preventDefault();drag.lastY=event.clientY;ghost.style.left=Math.min(event.clientX+12,window.innerWidth-180)+'px';ghost.style.top=event.clientY+12+'px';
    target?.classList.remove('drop-active');target=hit(event.clientX,event.clientY);if(target?.dataset.dropKind===drag.kind)target.classList.add('drop-active');
    if(!scrollJob){const scroll=()=>{scrollJob=0;if(!drag?.active)return;const dy=drag.lastY<55?-12:drag.lastY>window.innerHeight-55?12:0;if(dy)window.scrollBy(0,dy);scrollJob=requestAnimationFrame(scroll);};scrollJob=requestAnimationFrame(scroll);}
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    if(!drag||event.pointerId!==drag.pointer)return;
    const current=drag,drop=hit(event.clientX,event.clientY),dish=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-row-id]')?.dataset.rowId;
    cancel();if(!current.active)return;
    suppress=true;setTimeout(()=>suppress=false,400);
    if(drop?.dataset.dropKind===current.kind)Promise.resolve(onDrop(current.id,drop.dataset.dropDay,dish)).catch(onError);
  });
  document.addEventListener('pointercancel',cancel);document.addEventListener('lostpointercapture',event=>{if(drag?.pointer===event.pointerId)cancel();});window.addEventListener('blur',cancel);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&drag){event.preventDefault();cancel();}});
  document.addEventListener('click',event=>{const handle=event.target.closest('[data-move-id]');if(!handle)return;event.preventDefault();event.stopImmediatePropagation();if(!suppress)onPick(handle.dataset.moveId);},true);
  return ()=>!!drag;
}
