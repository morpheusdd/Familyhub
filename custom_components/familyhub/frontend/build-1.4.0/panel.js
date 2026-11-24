const FH_VERSION='1.4.0';
const FH_TAG='familyhub-panel-'+FH_VERSION.replaceAll('.','-');
const ACTIONS=['snapshot','write','calendar','calendar_remove','shopping/list','shopping/add','shopping/check','settings/todo','weather','settings/weather'];

class FamilyhubPanel extends HTMLElement {
  set hass(value) {
    this._hass=value;
    if(this.isConnected&&!this.frame)this.start();
  }
  connectedCallback(){
    if(this._hass&&!this.frame)this.start();
  }
  start(){
    // HA custom-panel ancestors do not consistently provide a definite height.
    // Give the iframe a measured pixel height instead of a percentage chain.
    this.style.cssText='display:block;width:100%;height:100vh;min-height:0;overflow:hidden';
    this.frame=document.createElement('iframe');
    this.frame.src='/familyhub-assets/build-'+FH_VERSION+'/index.html';
    this.frame.title='Familyhub';
    this.frame.allow='fullscreen; screen-wake-lock';
    this.frame.setAttribute('allowfullscreen','');
    this.frame.style.cssText='border:0;width:100%;height:100%;display:block';
    this.append(this.frame);
    this.scheduleSize=()=>{
      if(this.sizeJob)return;
      this.sizeJob=requestAnimationFrame(()=>{
        this.sizeJob=0;
        if(!this.isConnected||!this.frame)return;
        if(this.kiosk){this.style.height='';this.frame.style.height='100%';return;}
        const viewport=window.visualViewport;
        const bottom=viewport?viewport.offsetTop+viewport.height:window.innerHeight;
        const top=Math.max(0,this.getBoundingClientRect().top);
        const height=Math.max(1,Math.floor(bottom-top));
        this.style.height=height+'px';
        this.frame.style.height=height+'px';
      });
    };
    window.addEventListener('resize',this.scheduleSize);
    window.addEventListener('orientationchange',this.scheduleSize);
    this.viewport=window.visualViewport;
    this.viewport?.addEventListener('resize',this.scheduleSize);
    this.viewport?.addEventListener('scroll',this.scheduleSize);
    if(typeof ResizeObserver!=='undefined'&&this.parentElement){
      this.sizeObserver=new ResizeObserver(this.scheduleSize);
      this.sizeObserver.observe(this.parentElement);
    }
    this.scheduleSize();
    this.listener=async event=>{
      if(event.origin!==location.origin||event.source!==this.frame?.contentWindow)return;
      if(event.data?.kind==='familyhub-kiosk'){this.setKiosk(!!event.data.on);return;}
      if(event.data?.kind!=='familyhub-request')return;
      const {id,action,payload}=event.data;
      if(typeof id!=='string'||!ACTIONS.includes(action))return;
      try{
        const result=await this._hass.callWS({type:'familyhub/request',action,payload:payload??{}});
        this.frame?.contentWindow?.postMessage({kind:'familyhub-response',id,result},location.origin);
      }catch(error){
        this.frame?.contentWindow?.postMessage({kind:'familyhub-response',id,error:error.message||'Home Assistant nicht erreichbar.'},location.origin);
      }
    };
    window.addEventListener('message',this.listener);
    this.onFullscreen=()=>{
      // Leaving real fullscreen (e.g. swipe or Esc) keeps the cover mode, so the
      // tablet still shows only Familyhub. The exit button ends both.
      if(!this.fullscreenElement())this.scheduleSize();
    };
    document.addEventListener('fullscreenchange',this.onFullscreen);
    document.addEventListener('webkitfullscreenchange',this.onFullscreen);
    this.onVisible=()=>{if(this.kiosk&&!document.hidden)void this.keepAwake();};
    document.addEventListener('visibilitychange',this.onVisible);
  }
  fullscreenElement(){return document.fullscreenElement||document.webkitFullscreenElement||null;}
  async keepAwake(){
    try{
      if(!this.wakeLock&&navigator.wakeLock){
        this.wakeLock=await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release',()=>{this.wakeLock=null;});
      }
    }catch{/* Not supported or not allowed: the tablet's own auto-lock setting applies. */}
  }
  setKiosk(on){
    this.kiosk=on;
    if(on){
      // Cover Home Assistant's sidebar and header. Works everywhere, including the
      // Companion app, where the browser fullscreen API is often unavailable.
      this.style.cssText='display:block;position:fixed;inset:0;z-index:2147483000;width:100vw;height:100vh;height:100dvh;background:#101319;overflow:hidden';
      // Fullscreen the panel itself, so only Familyhub fills the screen.
      const target=this;
      if(!this.fullscreenElement()){
        try{
          const request=target.requestFullscreen?.bind(target)||target.webkitRequestFullscreen?.bind(target);
          const result=request?.({navigationUI:'hide'});
          result?.catch?.(()=>{});
        }catch{/* Cover mode stays active. */}
      }
      void this.keepAwake();
    }else{
      this.style.cssText='display:block;width:100%;height:100vh;min-height:0;overflow:hidden';
      if(this.fullscreenElement()){
        try{(document.exitFullscreen||document.webkitExitFullscreen)?.call(document)?.catch?.(()=>{});}catch{}
      }
      this.wakeLock?.release?.().catch?.(()=>{});
      this.wakeLock=null;
    }
    this.scheduleSize();
  }
  disconnectedCallback(){
    if(this.kiosk)this.setKiosk(false);
    window.removeEventListener('message',this.listener);
    window.removeEventListener('resize',this.scheduleSize);
    window.removeEventListener('orientationchange',this.scheduleSize);
    document.removeEventListener('fullscreenchange',this.onFullscreen);
    document.removeEventListener('webkitfullscreenchange',this.onFullscreen);
    document.removeEventListener('visibilitychange',this.onVisible);
    this.viewport?.removeEventListener('resize',this.scheduleSize);
    this.viewport?.removeEventListener('scroll',this.scheduleSize);
    this.sizeObserver?.disconnect();
    if(this.sizeJob)cancelAnimationFrame(this.sizeJob);
    this.sizeJob=0;
    this.frame?.remove();
    this.frame=null;
  }
}
if(!customElements.get(FH_TAG))customElements.define(FH_TAG,FamilyhubPanel);
