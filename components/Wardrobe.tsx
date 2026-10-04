'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import NextImage from 'next/image';
import rawGarments from '@/lib/garments.json';
import { clamp, ease, spring, stepSpring } from '@/lib/motion';

type Garment = {
  id: string; name: string; type: string; pivot: number; asset: string; rest: string; front: string;
  columns: number; frames: number; cellWidth: number; cellHeight: number;
  widths: number[]; reference: boolean; detailScale?:number; detailY?:number; detailX?:number; detailHookHeight?:number;
};
type Loaded = { garment: Garment; atlas: HTMLImageElement; front: HTMLImageElement; rest: HTMLImageElement; masks: Uint8ClampedArray; head?:HTMLImageElement };
type Hit = { index:number; x:number; y:number; scale:number; frame:number; roll:number };
const makeMasks = (atlas:HTMLImageElement,g:Garment) => {
  const c=document.createElement('canvas'); c.width=g.columns*64;c.height=Math.ceil(g.frames/g.columns)*81;
  const ctx=c.getContext('2d')!;ctx.drawImage(atlas,0,0,c.width,c.height);return ctx.getImageData(0,0,c.width,c.height).data;
};
type Mode = 'rack' | 'product' | 'about' | 'contact';
const W = 2912, H = 1620, GARMENT_Y = 418;
const PRODUCTS = rawGarments as Garment[];
const image = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = src;
});

export default function Wardrobe() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const loaded = useRef<Loaded[]>([]);
  const hits = useRef<Hit[]>([]);
  const [loadError,setLoadError]=useState(false);
  const [availability,setAvailability]=useState(false);
  const [adding,setAdding]=useState(false);
  const scene = useRef({ active: -1, selected: 6, mode: 'rack' as Mode, hoodie: false, demo: false, demoStart: 0, reduced: false, dragging: false, dragX: 0, spin: 0 });
  const [mode, setMode] = useState<Mode>('rack');
  const [hover, setHover] = useState(-1);
  const [selected, setSelected] = useState(6);
  const [ready, setReady] = useState(false);
  const [hoodie, setHoodie] = useState(false);
  const [collection,setCollection]=useState<Garment[]>(PRODUCTS);
  const [showTools, setShowTools] = useState(false);
  const [demo, setDemo] = useState(false);
  const lastFocus = useRef<HTMLElement | null>(null);
  const pick = useCallback((i: number) => {
    const count = loaded.current.length || 10;
    i = (i + count) % count;
    scene.current.selected = i; setSelected(i);
  }, []);
  const openProduct = useCallback((i: number) => {
    lastFocus.current = document.activeElement as HTMLElement;
    setAvailability(false); pick(i); scene.current.mode = 'product'; scene.current.demo = false;
    setDemo(false); setMode('product');
  }, [pick]);
  const close = useCallback(() => {
    setAvailability(false);const active=scene.current.mode==='product'&&scene.current.selected<loaded.current.length?scene.current.selected:-1;scene.current.mode='rack';scene.current.active=active;setHover(active);setMode('rack');
    requestAnimationFrame(() => lastFocus.current?.focus());
  }, []);

  useEffect(() => {
    let stopped = false, raf = 0;
    const focus = PRODUCTS.map(() => spring());
    const expand = spring(), center = spring();
    let lastDraw='';
    let previous = performance.now(), rail: HTMLImageElement, hook:HTMLImageElement;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    scene.current.reduced = mq.matches;
    const applyMotion = () => { scene.current.reduced = mq.matches; };
    mq.addEventListener('change', applyMotion);
    const render = (now: number) => {
      if (stopped) return;
      const el = canvas.current, container = panel.current;
      if (!el || !container) return;
      const ctx = el.getContext('2d', { alpha: true }); if (!ctx) return;
      const bounds = container.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2.5);
      const iw = Math.round(bounds.width * dpr), ih = Math.round(bounds.height * dpr);
      if (el.width !== iw || el.height !== ih) { el.width = iw; el.height = ih; }
      
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      const dt = Math.min((now - previous) / 1000, .04); previous = now;
      const s = scene.current;
      if (s.demo) {
        const t = (now - s.demoStart) / 1000;
        const timeline: [number, number, Mode][] = [[0,-1,'rack'],[.95,1,'rack'],[2.42,2,'rack'],[3.48,3,'rack'],[4.95,4,'rack'],[6.27,5,'rack'],[7.18,6,'rack'],[8.45,6,'product'],[10.1,5,'product'],[10.72,4,'product'],[11.29,3,'product'],[12.21,2,'product'],[13.55,6,'rack'],[14.25,8,'rack'],[15.02,5,'rack'],[15.34,2,'rack'],[16.81,1,'rack'],[17.95,-1,'rack']];
        let entry = timeline[0]; for (const e of timeline) if (t >= e[0]) entry = e;
        if (s.mode !== entry[2]) { s.mode = entry[2]; setMode(entry[2]); }
        if (entry[2] === 'product') {
          if (s.selected !== entry[1]) { s.selected = entry[1]; setSelected(entry[1]); }
        } else if (s.active !== entry[1]) { s.active = entry[1]; setHover(entry[1]); }
        if (t > 18.9333) { s.demo = false; setDemo(false); }
      }
      const modalTarget = s.mode === 'product' ? 1 : 0;
      if (s.reduced) { expand.value = modalTarget; center.value = modalTarget; }
      else { stepSpring(expand, modalTarget, dt, 110, 22); stepSpring(center, modalTarget, dt, 95, 21); }
      const p = clamp(expand.value), c = ease(clamp(center.value));
      const active = s.mode === 'product' ? s.selected : s.active;
      const items = loaded.current;
      for (let i = 0; i < items.length; i++) {
        const target = i === active ? 1 : 0;
        if (!focus[i]) focus[i] = spring();
        if (s.reduced) focus[i].value = target; else stepSpring(focus[i], target, dt);
      }
      const stamp=[iw,ih,s.mode,s.active,s.selected,items.length].join(':');
      const settled=focus.every((v,i)=>Math.abs(v.velocity)<.0003&&Math.abs(v.value-(i===active?1:0))<.0003)&&Math.abs(expand.value-modalTarget)<.0003&&Math.abs(center.value-modalTarget)<.0003;
      if(!s.demo&&stamp===lastDraw&&settled){raf=requestAnimationFrame(render);return;}
      lastDraw=stamp;
      ctx.setTransform(iw/W,0,0,ih/H,0,0);ctx.clearRect(0,0,W,H);
      if (rail?.complete) {
        ctx.globalAlpha = 1 - p * .92;
        ctx.filter = p > .05 ? `blur(${p * 9}px)` : 'none';
        ctx.drawImage(rail, 352, 382, 2190, 112); ctx.filter = 'none';
      }
      // Paint the selected garment last. No depth-sorted DOM flicker.
      hits.current=[];
      const order = items.map((_, i) => i).filter(i => i !== active);
      if (active >= 0 && items[active]) order.push(active);
      for (const i of order) {
        const item = items[i], g = item.garment, f = clamp(focus[i].value);
        let x = g.pivot * W;
        for (let j = 0; j < items.length; j++) {
          if (j === i) continue;
          const distance = i - j;
          x += Math.sign(distance) * 182 * Math.pow(.60, Math.abs(distance) - 1) * clamp(focus[j].value);
        }
        const selectedInModal = i === s.selected;
        let y = GARMENT_Y, scale = 1;
        const foreground = p * (selectedInModal ? 1 : 0);
        if (selectedInModal) { x += (W / 2+(g.detailX||0) - x) * c; y += ((g.detailY??276)-y)*c; scale += ((g.detailScale??1.36)-1)*c; }
        const alpha = selectedInModal ? 1 : 1 - .94 * p;
        ctx.globalAlpha = alpha;
        ctx.filter = !selectedInModal && p > .04 ? `blur(${p * 13}px)` : 'none';
        ctx.save(); ctx.translate(x, y);
        // Low-amplitude rigid hanger follow-through, the fabric shape is fixed.
        const roll = s.reduced ? 0 : clamp(focus[i].velocity, -.8, .8) * -.015 * (1 - p);
        ctx.rotate(roll);
        let n = 0;
        if (g.frames > 1 && f > .002) {
          // Match visible width to the observed angle samples rather than time.
          const max = Math.max(...g.widths), min = g.widths.find(v => v > 0) || max * .25;
          const wanted = min + (max - min) * Math.sin(f * Math.PI / 2);
          let error = Infinity;
          for (let k = 1; k < g.frames; k++) {
            const e = Math.abs((g.widths[k] || max) - wanted);
            if (e < error) { error = e; n = k; }
          }
          if (f > .985) n = g.frames - 1;
        }
        if (foreground > .95) n = g.frames - 1;
        const sw = g.cellWidth, sh = g.cellHeight;
        const displayWidth = 640 * scale, displayHeight = 810 * scale;
        if(g.reference && hook?.complete) {
          ctx.save();ctx.scale(scale,scale);
          if(selectedInModal && p>.01) {
            const hookHeight=g.detailHookHeight??80;
            ctx.globalAlpha=alpha*p;ctx.drawImage(hook,-40/scale,58-hookHeight/scale,80/scale,hookHeight/scale);
          }
          ctx.globalAlpha=alpha*(selectedInModal?1-p:1);
          if(item.head)ctx.drawImage(item.head,-40,-36,80,40);
          const metal=ctx.createLinearGradient(-2,0,2,0);metal.addColorStop(0,'#66655f');metal.addColorStop(.45,'#f4f4eb');metal.addColorStop(1,'#7d7872');
          ctx.strokeStyle=metal;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(0,7);ctx.lineTo(0,62);ctx.stroke();
          ctx.restore();
        }
        hits.current.push({index:i,x,y,scale,frame:n,roll});
        if(s.mode==='product'&&selectedInModal)ctx.drawImage(item.front,-displayWidth/2,0,displayWidth,displayHeight);
        else ctx.drawImage(item.atlas, (n % g.columns) * sw, Math.floor(n / g.columns) * sh, sw, sh, -displayWidth / 2, 0, displayWidth, displayHeight);
        ctx.restore(); ctx.filter = 'none';
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(render);
    };
    Promise.all([Promise.all(PRODUCTS.map(async garment => {
      const [atlas, front, rest, head] = await Promise.all([image(garment.asset), image(garment.front), image(garment.rest),image(`/hooks/${garment.id}.webp`)]);
      return { garment, atlas, front, rest, head, masks:makeMasks(atlas,garment) };
    })), image('/rail.webp'),image('/detail-hook.webp')]).then(([data, r, h]) => {
      if (stopped) return; loaded.current = data; rail = r;hook=h;setLoadError(false); setReady(true); raf = requestAnimationFrame(render);
    }).catch(() => { if (!stopped) {setReady(false);setLoadError(true);} });
    return () => { stopped = true; cancelAnimationFrame(raf); mq.removeEventListener('change', applyMotion); };
  }, []);

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
    register({name:'list_garments',description:'Read the garment collection and the current selected garment.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({garments:loaded.current.map(({garment:g})=>({id:g.id,name:g.name,type:g.type})),selected:loaded.current[scene.current.selected]?.garment.id,mode:scene.current.mode})});
    register({name:'open_garment',description:'Open a garment in the visible product viewer.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:unknown)=>{const id=(input as {id?:unknown})?.id;if(typeof id!=='string')throw new Error('A garment id is required.');const index=loaded.current.findIndex(({garment:g})=>g.id===id);if(index<0)throw new Error('Unknown garment id.');openProduct(index);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return{selected:id,mode:'product'};}});
    register({name:'close_garment',description:'Close the garment viewer and return to the clothing rail.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute:async()=>{close();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return{mode:'rack'};}});
    return()=>{cancelAnimationFrame(hydration);lifecycle.abort();};
  }, [openProduct, close, pick]);

  useEffect(()=>{
    const container=panel.current;if(!container)return;
    const resize=new ResizeObserver(()=>{
      const track=container.querySelector<HTMLElement>('.ticker-track');
      if(track)track.style.animationDuration=`${track.scrollWidth*.25/(76*container.clientWidth/W)}s`;
    });resize.observe(container);return()=>resize.disconnect();
  },[]);

  const targetAt = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const px=(e.clientX-r.left)/r.width*W,py=(e.clientY-r.top)/r.height*H;
    for(let j=hits.current.length-1;j>=0;j--) {
      const h=hits.current[j],item=loaded.current[h.index],g=item.garment;
      const dx=px-h.x,dy=py-h.y;
      const x=(dx*Math.cos(h.roll)+dy*Math.sin(h.roll))/h.scale+320;
      const y=(-dx*Math.sin(h.roll)+dy*Math.cos(h.roll))/h.scale;
      if(x<0||x>=640||y<54||y>=810)continue;
      const mx=Math.floor(x/10)+(h.frame%g.columns)*64,my=Math.floor(y/10)+Math.floor(h.frame/g.columns)*81;
      if(item.masks[(my*g.columns*64+mx)*4+3]>45)return h.index;
    }
    if(e.pointerType==='touch'&&py>.29*H&&py<.78*H){
      const closest=hits.current.reduce<Hit|undefined>((a,h)=>!a||Math.abs(px-h.x)<Math.abs(px-a.x)?h:a,undefined);
      if(closest&&Math.abs(px-closest.x)<140)return closest.index;
    }
    return -1;
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if(e.buttons===1&&Math.abs(e.clientX-scene.current.dragX)>5)scene.current.dragging=true;
    if (scene.current.demo || e.pointerType === 'touch' || mode !== 'rack') return;
    const i = targetAt(e); if (scene.current.active !== i) { scene.current.active=i; setHover(i); }
  };
  const leave = () => { if (!scene.current.demo) { scene.current.active = -1; setHover(-1); } };
  const addHoodie = async () => {
    if(adding)return;setAdding(true);
    try {
    if (hoodie) {
      loaded.current = loaded.current.filter(item => item.garment.id !== 'hoodie');
      scene.current.hoodie=false; setHoodie(false);setCollection(PRODUCTS); close(); return;
    }
    const res = await fetch('/garments/hoodie.json'); const g: Garment = await res.json();
    const [atlas,front,rest] = await Promise.all([image(g.asset),image(g.front),image(g.rest)]);
    loaded.current = [...loaded.current,{garment:g,atlas,front,rest,masks:makeMasks(atlas,g)}];
    scene.current.hoodie=true; setHoodie(true);setCollection([...PRODUCTS,g]); scene.current.active=10; setHover(10);
    }catch{setLoadError(true);}finally{setAdding(false);}
  };
  const title = collection[selected]?.name;
  return (
    <main className="world">
      <div className={`wardrobe ${mode === 'product' ? 'is-product' : ''} ${mode === 'about' || mode === 'contact' ? 'is-text' : ''}`} ref={panel}>
        <div className="wall" aria-hidden="true" />
        <header className="header" inert={mode!=='rack'}>
          <button onClick={() => { scene.current.mode='about';setMode('about'); }} className="text-button">ABOUT</button>
          <button className="brand" aria-label="Batch Merch home" onClick={close}><NextImage src="/brand.webp" alt="Batch Merch" width={200} height={119} unoptimized priority /></button>
          <button onClick={() => { scene.current.mode='contact';setMode('contact'); }} className="text-button">CONTACT</button>
        </header>
        <canvas ref={canvas} className={`rack-canvas ${hover >= 0 ? 'has-hover' : ''}`} onPointerMove={move} onPointerLeave={leave} onPointerDown={e=>{scene.current.dragX=e.clientX;scene.current.dragging=false;}}
          onClick={(e) => { if(scene.current.dragging){scene.current.dragging=false;return;}if (mode === 'rack') { const i=targetAt(e as unknown as React.PointerEvent); if(i>=0)openProduct(i); } }}
          aria-label="Interactive clothing rack. Tab to choose a garment; use arrow keys in the viewer." />
        {!ready && <div className="loading-garments" aria-live="polite"><span />{loadError?'Could not load the collection. Please refresh.':'Preparing the collection'}</div>}
        <div className="garment-accessibility" aria-label="Collection">
          {collection.map((g,i) => <button key={g.id} disabled={!ready} aria-label={`View ${g.name}`} onFocus={() => { scene.current.active=i;setHover(i); }} onBlur={leave} onClick={() => openProduct(i)} style={{left:`${g.pivot*100}%`}}>{g.name}</button>)}
        </div>
        {mode==='rack' && hover>=0 && <div className="hover-label" style={{left:`${(collection[hover]?.pivot || .5)*100}%`}}>{collection[hover]?.name}</div>}
        <button className="availability" disabled={!ready} onClick={() => mode==='product'?setAvailability(true):openProduct(hover>=0?hover:selected)}>SEE AVAILABILITY</button>
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
        <button className="drawer-handle" disabled={!ready} aria-label="Garment options" aria-expanded={showTools} onClick={()=>setShowTools(v=>!v)} />
      </div>
      {showTools && <div className="collection-tools"><button className={hoodie?'active':''} onClick={addHoodie} disabled={adding}>{adding?'Loading hoodie':hoodie?'Remove hoodie':'Add hoodie'}</button><button onClick={()=>{scene.current.demo=!demo;scene.current.demoStart=performance.now();setDemo(!demo);}}>{demo?'Stop replay':'Replay reference motion'}</button><button aria-label="Close garment options" onClick={()=>setShowTools(false)}>×</button></div>}
    </main>
  );
}
