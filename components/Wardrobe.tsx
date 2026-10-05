'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import NextImage from 'next/image';
import rawGarments from '@/lib/garments.json';
import { clamp } from '@/lib/motion';
import { garmentAssetUrl } from '@/lib/garment-assets';
import { WardrobeRenderer, type Garment, type Mode } from '@/lib/wardrobe-three';
import { MOBILE_RACK_QUERY, RACK_WIDTH, mobileRackView, mobileProductView } from '@/lib/rack-view';

const W = 2912;
const PRODUCTS = rawGarments as Garment[];
const TIMELINE:[number,number,Mode][]=[[0,-1,'rack'],[1.05,1,'rack'],[2.5,2,'rack'],[3.583333,3,'rack'],[5.016667,4,'rack'],[6.366667,5,'rack'],[7.2,6,'rack'],[8.45,6,'product'],[10.1,5,'product'],[10.72,4,'product'],[11.29,3,'product'],[12.21,2,'product'],[13.55,6,'rack'],[14.333333,8,'rack'],[15.02,5,'rack'],[15.34,2,'rack'],[16.81,1,'rack'],[17.95,-1,'rack']];

export default function Wardrobe() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const loaded = useRef<Garment[]>(PRODUCTS);
  const engine = useRef<WardrobeRenderer | null>(null);
  const [loadError,setLoadError]=useState(false);
  const [availability,setAvailability]=useState(false);
  const [adding,setAdding]=useState(false);
  const scene = useRef({ active: -1, selected: 6, mode: 'rack' as Mode, hoodie: false, demo: false, demoStart: 0, reduced: false, dragging: false, dragX: 0, dragStartSpin: 0, spin: 0, mobile:false,rackPosition:6,dragRackStart:6 });
  const [mode, setMode] = useState<Mode>('rack');
  const [hover, setHover] = useState(-1);
  const [selected, setSelected] = useState(6);
  const [ready, setReady] = useState(false);
  const [hoodie, setHoodie] = useState(false);
  const [collection,setCollection]=useState<Garment[]>(PRODUCTS);
  const [showTools, setShowTools] = useState(false);
  const [demo, setDemo] = useState(false);
  const [mobile,setMobile]=useState(false);
  const [rackPosition,setRackPosition]=useState(6);
  const [frame,setFrame]=useState({width:W,height:1620});
  const lastFocus = useRef<HTMLElement | null>(null);
  const rackCursor = useRef(6);
  const highlightRack = useCallback((i: number) => {
    if(i>=0)rackCursor.current=i;
    scene.current.active=i;setHover(i);
  }, []);
  const focusRack = useCallback((position: number, stopReplay=true) => {
    const s=scene.current;
    const next=clamp(position,0,loaded.current.length-1);
    s.rackPosition=next;setRackPosition(next);
    if(stopReplay){s.demo=false;setDemo(false);}
    highlightRack(Math.round(next));
  }, [highlightRack]);
  const browseRack = useCallback((direction: -1 | 1) => {
    const s=scene.current;
    if(s.mode!=='rack'||(!ready&&!loadError))return;
    const count=loaded.current.length;
    const current=Math.min(s.active>=0?s.active:rackCursor.current,count-1);
    if(s.mobile){focusRack(clamp(current+direction,0,count-1));return;}
    s.demo=false;setDemo(false);
    highlightRack((current+direction+count)%count);
  }, [highlightRack,focusRack,ready,loadError]);
  const pick = useCallback((i: number) => {
    const count = loaded.current.length || 10;
    i = (i + count) % count;
    scene.current.selected = i; setSelected(i);
  }, []);
  const openProduct = useCallback((i: number) => {
    lastFocus.current = document.activeElement as HTMLElement;
    setAvailability(false); scene.current.spin=0; pick(i); scene.current.mode = 'product'; scene.current.demo = false;
    setDemo(false); setMode('product');
  }, [pick]);
  const close = useCallback(() => {
    setAvailability(false);scene.current.spin=0;const active=scene.current.mode==='product'&&scene.current.selected<loaded.current.length?scene.current.selected:-1;scene.current.mode='rack';if(scene.current.mobile)focusRack(active>=0?active:scene.current.rackPosition,false);else highlightRack(active);setMode('rack');
    requestAnimationFrame(() => lastFocus.current?.focus());
  }, [highlightRack,focusRack]);

  useEffect(()=>{
    const query=matchMedia(MOBILE_RACK_QUERY);
    const apply=()=>{scene.current.mobile=query.matches;setMobile(query.matches);if(query.matches)focusRack(scene.current.rackPosition,false);else highlightRack(-1);engine.current?.invalidate();};
    queueMicrotask(apply);query.addEventListener('change',apply);
    return()=>query.removeEventListener('change',apply);
  },[focusRack,highlightRack]);

  useEffect(() => {
    let stopped = false;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    scene.current.reduced = mq.matches;
    const applyMotion = () => { scene.current.reduced=mq.matches;engine.current?.invalidate(); };
    mq.addEventListener('change',applyMotion);
    const tick = (now:number) => {
      const s=scene.current;
      if(!s.demo)return;
      const t=(now-s.demoStart)/1000;
      let entry=TIMELINE[0];for(const e of TIMELINE)if(t>=e[0])entry=e;
      if(s.mode!==entry[2]){s.mode=entry[2];setMode(entry[2]);}
      if(entry[2]==='product'){
        if(s.selected!==entry[1]){s.selected=entry[1];setSelected(entry[1]);}
      }else if(s.active!==entry[1]){highlightRack(entry[1]);}
      if(t>18.9333){s.demo=false;setDemo(false);if(s.mobile)focusRack(s.active>=0?s.active:s.rackPosition,false);}
    };
    try {
      const fail=()=>{setLoadError(true);engine.current?.dispose();engine.current=null;};
      const renderer=new WardrobeRenderer(canvas.current!,()=>scene.current,tick,fail);
      engine.current=renderer;
      void renderer.load(PRODUCTS).then(()=>{
        if(stopped||engine.current!==renderer)return;
        loaded.current=PRODUCTS;setReady(true);setLoadError(false);
      }).catch(()=>{if(!stopped)fail();});
    }catch{queueMicrotask(()=>{if(!stopped)setLoadError(true);});}
    const visible=()=>{if(!document.hidden)engine.current?.invalidate();};
    document.addEventListener('visibilitychange',visible);
    return()=>{stopped=true;engine.current?.dispose();engine.current=null;mq.removeEventListener('change',applyMotion);document.removeEventListener('visibilitychange',visible);};
  }, [highlightRack,focusRack]);

  useEffect(()=>{engine.current?.invalidate();},[mode,hover,selected,hoodie,demo,mobile,rackPosition]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if(availability){setAvailability(false);return;}close(); scene.current.demo = false; setDemo(false); }
      if(e.key==='Tab'&&scene.current.mode==='product') {
        const selector=availability?'.availability-panel button':'.product-controls button,.availability,.drawer-handle';
        const buttons=Array.from(panel.current!.querySelectorAll<HTMLButtonElement>(selector));
        const first=buttons[0],last=buttons.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
      if (scene.current.mode === 'product' && e.key === 'ArrowLeft') { e.preventDefault(); pick(scene.current.selected - 1); }
      if (scene.current.mode === 'product' && e.key === 'ArrowRight') { e.preventDefault(); pick(scene.current.selected + 1); }
      if (e.key.toLowerCase() === 'h' && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) setShowTools(v => !v);
    };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, [close, pick,availability]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const hydration=requestAnimationFrame(()=>{
      if(params.has('tools'))setShowTools(true);
      const value=params.get('product');if(value&&Number.isFinite(Number(value)))openProduct(clamp(Number(value),0,9));
    });
    const context=(document as Document & {modelContext?:{registerTool:(tool:object,options:object)=>void|Promise<void>}}).modelContext;
    if(!context?.registerTool)return()=>cancelAnimationFrame(hydration);
    const lifecycle=new AbortController();
    const register=(tool:object)=>{try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
    register({name:'list_garments',description:'Read the garment collection and the current selected garment.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({garments:loaded.current.map((g)=>({id:g.id,name:g.name,type:g.type})),selected:loaded.current[scene.current.selected]?.id,mode:scene.current.mode})});
    register({name:'open_garment',description:'Open a garment in the visible product viewer.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:unknown)=>{const id=(input as {id?:unknown})?.id;if(typeof id!=='string')throw new Error('A garment id is required.');const index=loaded.current.findIndex(g=>g.id===id);if(index<0)throw new Error('Unknown garment id.');openProduct(index);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return{selected:id,mode:'product'};}});
    register({name:'close_garment',description:'Close the garment viewer and return to the clothing rail.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute:async()=>{close();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return{mode:'rack'};}});
    return()=>{cancelAnimationFrame(hydration);lifecycle.abort();};
  }, [openProduct, close, pick]);

  useEffect(()=>{
    const container=panel.current;if(!container)return;
    const resize=new ResizeObserver(()=>{
      const track=container.querySelector<HTMLElement>('.ticker-track');
      if(track)track.style.animationDuration=`${track.scrollWidth*.25/(76*container.clientWidth/W)}s`;
      const bounds=canvas.current!.getBoundingClientRect();
      setFrame(previous=>previous.width===bounds.width&&previous.height===bounds.height?previous:{width:bounds.width,height:bounds.height});
    });resize.observe(container);resize.observe(canvas.current!);return()=>resize.disconnect();
  },[]);

  const targetAt = (e: React.PointerEvent) => {
    if(engine.current)return engine.current.hit(e.clientX,e.clientY,e.pointerType==='touch');
    if(!loadError)return -1;
    const r=canvas.current!.getBoundingClientRect();
    const view=scene.current.mobile?mobileRackView(collection.map(g=>g.pivot),scene.current.rackPosition,r.width,r.height):{x:0,y:0,zoom:1};
    const x=(e.clientX-r.left-r.width/2)/r.width*W/view.zoom+W/2+view.x;
    const y=(e.clientY-r.top-r.height/2)/r.width*W/view.zoom+810-view.y;
    if(y<490||y>1200)return -1;
    let hit=-1,distance=e.pointerType==='touch'?140:95;
    collection.forEach((g,i)=>{const d=Math.abs(g.pivot*W-x);if(d<distance){distance=d;hit=i;}});
    return hit;
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s=scene.current;
    if(e.buttons===1&&Math.abs(e.clientX-s.dragX)>5)s.dragging=true;
    if(mode==='product'&&e.buttons===1){
      s.spin=clamp(s.dragStartSpin+(e.clientX-s.dragX)*.008,-1.1,1.1);
      engine.current?.invalidate();return;
    }
    if(mode==='rack'&&s.mobile&&e.buttons===1&&s.dragging){
      const bounds=e.currentTarget.getBoundingClientRect();
      const view=mobileRackView(collection.map(g=>g.pivot),s.rackPosition,bounds.width,bounds.height);
      const gap=(collection.at(-1)!.pivot-collection[0].pivot)*RACK_WIDTH/(collection.length-1);
      focusRack(s.dragRackStart-(e.clientX-s.dragX)*RACK_WIDTH/(bounds.width*view.zoom*gap));return;
    }
    if(s.demo||s.mobile||e.pointerType==='touch'||mode!=='rack')return;
    const i=targetAt(e);if(s.active!==i)highlightRack(i);
  };
  const leave = () => { if(!scene.current.demo&&!scene.current.mobile)highlightRack(-1); };
  const addHoodie = async () => {
    if(adding)return;setAdding(true);
    try {
      if(hoodie){
        engine.current?.remove('hoodie');loaded.current=PRODUCTS;
        setHoodie(false);setCollection(PRODUCTS);close();return;
      }
      const res=await fetch('/garments/hoodie.json');if(!res.ok)throw new Error('Hoodie unavailable');
      const g:Garment=await res.json();await engine.current?.add(g);
      loaded.current=[...PRODUCTS,g];setHoodie(true);setCollection([...PRODUCTS,g]);
      if(scene.current.mobile)focusRack(10);else highlightRack(10);
    }catch{setLoadError(true);}finally{setAdding(false);}
  };
  const title = collection[selected]?.name;
  const fallbackView=mode==='product'?mobileProductView(collection[selected]??{},frame.width,frame.height):mobileRackView(collection.map(g=>g.pivot),rackPosition,frame.width,frame.height);
  const fallbackStyle=mobile?{transform:`translate(${(-fallbackView.x/W*100*fallbackView.zoom).toFixed(3)}%,${(fallbackView.y/W*frame.width/frame.height*100*fallbackView.zoom).toFixed(3)}%) scale(${fallbackView.zoom})`}:undefined;
  return (
    <main className="world">
      <div className={`wardrobe ${mode === 'product' ? 'is-product' : ''} ${mode === 'about' || mode === 'contact' ? 'is-text' : ''}`} ref={panel}>
        <div className="wall" aria-hidden="true" />
        <header className="header" inert={mode!=='rack'}>
          <button onClick={() => { scene.current.mode='about';setMode('about'); }} className="text-button">ABOUT</button>
          <button className="brand" aria-label="Batch Merch home" onClick={close}><NextImage src="/brand.webp" alt="Batch Merch" width={200} height={119} unoptimized priority /></button>
          <button onClick={() => { scene.current.mode='contact';setMode('contact'); }} className="text-button">CONTACT</button>
        </header>
        <canvas ref={canvas} className={`rack-canvas ${hover >= 0 ? 'has-hover' : ''}`} onPointerMove={move} onPointerLeave={leave} onPointerDown={e=>{scene.current.dragX=e.clientX;scene.current.dragStartSpin=scene.current.spin;scene.current.dragRackStart=scene.current.rackPosition;scene.current.dragging=false;if(mode==='product'||scene.current.mobile)e.currentTarget.setPointerCapture(e.pointerId);}}
          onPointerUp={()=>{if(scene.current.mobile&&mode==='rack'&&scene.current.dragging)focusRack(Math.round(scene.current.rackPosition));}}
          onPointerCancel={()=>{if(scene.current.mobile&&mode==='rack')focusRack(Math.round(scene.current.rackPosition));scene.current.dragging=false;}}
          onClick={(e) => { if(scene.current.dragging){scene.current.dragging=false;return;}if (mode === 'rack') { const i=targetAt(e as unknown as React.PointerEvent); if(i>=0)openProduct(i); } }}
          aria-label={mobile?'Interactive clothing rack. Swipe or use the slider to browse; tap a garment to inspect it.':'Interactive clothing rack. Hover or use the rack arrows to browse; click a garment to inspect it.'} />
        {loadError && <div className="poster-window"><NextImage className="static-poster" style={fallbackStyle} src={garmentAssetUrl(`/posters/${mode==='product'?(collection[selected]?.id||'flowers'):hoodie?'rack-hoodie':'rack'}.webp`)} alt="Static garment preview" width={1456} height={810} unoptimized priority /></div>}
        {!ready&&!loadError && <div className="loading-garments" aria-live="polite"><span />Preparing the collection</div>}
        {loadError && <div className="renderer-note" role="status">3D unavailable · showing static preview <button onClick={()=>location.reload()}>RETRY 3D</button></div>}
        <div className="garment-accessibility" aria-label="Collection">
          {collection.map((g,i) => <button key={g.id} disabled={!ready&&!loadError} aria-label={`View ${g.name}`} onFocus={() => mobile?focusRack(i):highlightRack(i)} onBlur={leave} onClick={() => openProduct(i)} style={{left:`${g.pivot*100}%`}}>{g.name}</button>)}
        </div>
        {mode==='rack' && <nav className="rack-navigation" aria-label="Browse the clothing rack" onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();browseRack(e.key==='ArrowLeft'?-1:1);}}}>
          <button className="round-button rack-previous" aria-label="Previous garment on rack" disabled={(!ready&&!loadError)||(mobile&&hover<=0)} onClick={()=>browseRack(-1)}><span aria-hidden="true">←</span></button>
          {mobile&&<input className="rack-slider" type="range" aria-label="Rack position" aria-valuetext={`${Math.round(rackPosition)+1} of ${collection.length}: ${collection[Math.round(rackPosition)]?.name}`} min={0} max={collection.length-1} step={.01} value={rackPosition} disabled={!ready&&!loadError} onChange={e=>focusRack(Number(e.currentTarget.value))} onPointerUp={()=>focusRack(Math.round(scene.current.rackPosition))} onPointerCancel={()=>focusRack(Math.round(scene.current.rackPosition))} />}
          <button className="round-button rack-next" aria-label="Next garment on rack" disabled={(!ready&&!loadError)||(mobile&&hover>=collection.length-1)} onClick={()=>browseRack(1)}><span aria-hidden="true">→</span></button>
          <output className="sr-only" aria-live="polite" aria-atomic="true">{hover>=0?`${hover+1} of ${collection.length}: ${collection[hover]?.name}`:''}</output>
        </nav>}
        {mode==='rack' && hover>=0 && <div className="hover-label" style={{left:`${(collection[hover]?.pivot || .5)*100}%`}}>{collection[hover]?.name}</div>}
        <button className="availability" disabled={!ready&&!loadError} onClick={() => mode==='product'?setAvailability(true):openProduct(hover>=0?hover:selected)}>SEE AVAILABILITY</button>
        <div className="ticker" aria-label="New designs daily, subscribe to our newsletter" aria-hidden={mode!=='rack'}>
          <div className="ticker-track">{Array.from({length:8},(_,i)=><span key={i}>NEW DESIGNS DAILY <b>•</b> SUBSCRIBE TO OUR NEWSLETTER <b>•</b></span>)}</div>
        </div>
        {availability && <section className="availability-panel" role="dialog" aria-modal="true" aria-label="Availability"><button autoFocus className="close-button text-button" onClick={()=>setAvailability(false)}>CLOSE</button><h2>{title}</h2><p>This collection is a visual recreation. Live stock and checkout are not connected.</p><button className="outline-button" onClick={()=>setAvailability(false)}>BACK TO GARMENT</button></section>}
        {mode==='product' && <section className="product-controls" role="dialog" aria-modal="true" aria-label={title}>
          <button className="close-button text-button" onClick={close} autoFocus>CLOSE</button>
          <button className="round-button previous" aria-label="Previous garment" onClick={() => pick(selected-1)}><span aria-hidden="true">←</span></button>
          <button className="round-button next" aria-label="Next garment" onClick={() => pick(selected+1)}><span aria-hidden="true">→</span></button>
          <div className="product-caption" aria-live="polite"><span className="product-count">{String(selected+1).padStart(2,'0')} / {String(collection.length).padStart(2,'0')}</span><h1>{title}</h1></div>
        </section>}
        {(mode==='about'||mode==='contact') && <section className="text-panel">
          <button className="close-button text-button" onClick={close} autoFocus>CLOSE</button>
          <NextImage className="panel-brand" src="/brand.webp" alt="Batch Merch" width={200} height={119} unoptimized />
          {mode==='about'?<><h1>Made to be seen.</h1><p>A collection of independent graphics, everyday tees, and heavyweight essentials.</p><button className="outline-button" onClick={close}>EXPLORE THE COLLECTION</button></>:<><h1>Let’s make something.</h1><p>Explore the collection and find your next favorite piece.</p><button className="outline-button" onClick={() => openProduct(selected)}>VIEW THE COLLECTION</button></>}
        </section>}
        <button className="drawer-handle" disabled={!ready&&!loadError} aria-label="Garment options" aria-expanded={showTools} onClick={()=>setShowTools(v=>!v)} />
      </div>
      {showTools && <div className="collection-tools"><button className={hoodie?'active':''} onClick={addHoodie} disabled={adding}>{adding?'Loading hoodie':hoodie?'Remove hoodie':'Add hoodie'}</button><button disabled={loadError||!ready} onClick={()=>{scene.current.demo=!demo;scene.current.demoStart=performance.now();setDemo(!demo);if(demo&&scene.current.mobile)focusRack(scene.current.active>=0?scene.current.active:scene.current.rackPosition,false);}}>{demo?'Stop replay':'Replay reference motion'}</button><button aria-label="Close garment options" onClick={()=>setShowTools(false)}>×</button></div>}
    </main>
  );
}
