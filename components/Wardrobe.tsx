'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import NextImage from 'next/image';
import rawGarments from '@/lib/garments.json';
import { clamp, dragMotion, sampleDrag, releaseVelocity, stepGlide } from '@/lib/motion';
import { garmentAssetUrl } from '@/lib/garment-assets';
import { WardrobeRenderer, type Garment, type Mode } from '@/lib/wardrobe-three';
import { MOBILE_RACK_QUERY, RACK_WIDTH, mobileRackView, mobileProductView } from '@/lib/rack-view';
import GarmentStudio from './GarmentStudio';
import CreatePiece from './CreatePiece';
import { arrangeRack, blankDesign, CLOTHING_TYPES, defaultDesign, fitDesign, readSavedWardrobe, saveWardrobe, MAX_PIECES, type GarmentDesign, type PrintSide } from '@/lib/garment-design';

const W = 2912;
const PRODUCTS = rawGarments as Garment[];
let hoodieTemplate: Promise<Garment> | undefined;
async function getTemplate(source:string):Promise<Garment> {
  const existing=PRODUCTS.find(g=>g.id===source);if(existing)return existing;
  if(source!=='hoodie')throw new Error('Unknown garment type');
  hoodieTemplate??=fetch('/garments/hoodie.json').then(async response=>{
    if(!response.ok)throw new Error('Hoodie unavailable');
    return await response.json() as Garment;
  }).catch(error=>{hoodieTemplate=undefined;throw error;});
  return hoodieTemplate;
}
const TIMELINE:[number,number,Mode][]=[[0,-1,'rack'],[.970017,1,'rack'],[2.5,2,'rack'],[3.583333,3,'rack'],[5.016667,4,'rack'],[6.366667,5,'rack'],[7.2,6,'rack'],[8.45,6,'product'],[10.1,5,'product'],[10.72,4,'product'],[11.29,3,'product'],[12.21,2,'product'],[13.55,-1,'rack'],[14.333333,8,'rack'],[15.02,5,'rack'],[15.34,2,'rack'],[16.81,1,'rack'],[17.95,-1,'rack']];

export default function Wardrobe() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const loaded = useRef<Garment[]>(PRODUCTS);
  const engine = useRef<WardrobeRenderer | null>(null);
  const [loadError,setLoadError]=useState(false);
  const [availability,setAvailability]=useState(false);
  const [adding,setAdding]=useState(false);
  const pendingPiece=useRef(false);
  const [showCreator,setShowCreator]=useState(false);
  const [downloading,setDownloading]=useState(false);
  const scene = useRef({ active: -1, selected: 6, mode: 'rack' as Mode, hoodie: false, demo: false, demoStart: 0, reduced: false, dragging: false, dragX: 0, dragStartSpin: 0, spin: 0, mobile:false,rackPosition:6,dragRackStart:6,studio:false });
  const gesture = useRef(dragMotion(0, 0));
  const pointerDown = useRef(false);
  const suppressClick = useRef(false);
  const rackGlide=useRef(0);
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
  const [showStudio,setShowStudio]=useState(false);
  const [designs,setDesigns]=useState<Record<string,GarmentDesign>>({});
  const designsRef=useRef<Record<string,GarmentDesign>>({});
  const addedRef=useRef<Garment[]>([]);
  const saveHydrated=useRef(false);
  const saveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const saveRevision=useRef(0);
  const saveChain=useRef(Promise.resolve());
  const [saveStatus,setSaveStatus]=useState('Saved on this device');
  const [designError,setDesignError]=useState('');
  const [orientation,setOrientation]=useState<PrintSide|null>('front');
  const persist=useCallback(()=>{
    if(!saveHydrated.current)return;
    const revision=++saveRevision.current;
    clearTimeout(saveTimer.current);setSaveStatus('Saving…');
    saveTimer.current=setTimeout(()=>{
      const snapshot={version:1 as const,designs:designsRef.current,added:addedRef.current};
      const write=saveChain.current.catch(()=>{}).then(()=>saveWardrobe(snapshot));
      saveChain.current=write;
      void write.then(()=>{if(revision===saveRevision.current)setSaveStatus('Saved on this device');})
        .catch(()=>{if(revision===saveRevision.current)setSaveStatus('Could not save on this device');});
    },250);
  },[]);
  const updateDesign=useCallback((id:string,design:GarmentDesign)=>{
    designsRef.current={...designsRef.current,[id]:design};setDesigns(designsRef.current);setDesignError('');
    void engine.current?.applyDesign(id,design).catch(()=>setDesignError('Could not load this design. Try again.'));
    persist();
  },[persist]);
  const rotate=useCallback((side:PrintSide)=>{
    engine.current?.stopMomentum();
    const target=side==='front'?0:Math.PI;
    scene.current.spin+=Math.atan2(Math.sin(target-scene.current.spin),Math.cos(target-scene.current.spin));
    setOrientation(side);engine.current?.invalidate();
  },[]);
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
    const current=Math.min(count>10||s.mobile?Math.round(s.rackPosition):s.active>=0?s.active:rackCursor.current,count-1);
    cancelAnimationFrame(rackGlide.current);focusRack(clamp(current+direction,0,count-1));
  }, [focusRack,ready,loadError]);
  const pick = useCallback((i: number) => {
    cancelAnimationFrame(rackGlide.current);
    engine.current?.stopMomentum();scene.current.dragging=false;pointerDown.current=false;
    const count = loaded.current.length || 10;
    i = (i + count) % count;
    scene.current.selected = i;scene.current.spin=0;setOrientation('front');setDesignError('');setSelected(i);
  }, []);
  const openProduct = useCallback((i: number) => {
    lastFocus.current = document.activeElement as HTMLElement;
    setAvailability(false); scene.current.spin=0; pick(i); scene.current.mode = 'product'; scene.current.demo = false;
    setDemo(false); setMode('product');
  }, [pick]);
  const close = useCallback(() => {
    engine.current?.stopMomentum();scene.current.dragging=false;pointerDown.current=false;
    setShowStudio(false);setAvailability(false);scene.current.spin=0;const active=scene.current.mode==='product'&&scene.current.selected<loaded.current.length?scene.current.selected:-1;scene.current.mode='rack';if(scene.current.mobile||loaded.current.length>10)focusRack(active>=0?active:scene.current.rackPosition,false);else highlightRack(-1);setMode('rack');
    requestAnimationFrame(() => {
      if(lastFocus.current?.closest('.garment-accessibility'))panel.current?.querySelectorAll<HTMLButtonElement>('.garment-accessibility button')[scene.current.selected]?.focus();
      else if(lastFocus.current?.isConnected)lastFocus.current.focus();
      else panel.current?.querySelector<HTMLButtonElement>('.create-piece-button')?.focus();
    });
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
      const fail=()=>{setLoadError(true);setShowStudio(false);setShowCreator(false);engine.current?.dispose();engine.current=null;};
      const renderer=new WardrobeRenderer(canvas.current!,()=>scene.current,tick,fail);
      engine.current=renderer;
      void Promise.all([renderer.load(PRODUCTS),readSavedWardrobe().catch(()=>undefined)]).then(async([,saved])=>{
        if(stopped||engine.current!==renderer)return;
        const extras:Garment[]=[];
        for(const stored of (saved?.added??[]).slice(0,MAX_PIECES-PRODUCTS.length)){
          try{
            const type=CLOTHING_TYPES.find(t=>t.source===stored.sourceId);if(!type)continue;
            const template=await getTemplate(type.source);
            const g={...template,id:stored.id,name:stored.name,sourceId:type.source,reference:false};
            extras.push(g);
          }catch{setDesignError('One saved piece could not be restored.');}
          if(stopped||engine.current!==renderer)return;
        }
        loaded.current=arrangeRack([...PRODUCTS,...extras]);addedRef.current=loaded.current.slice(PRODUCTS.length);
        for(const g of addedRef.current){await renderer.add(g,saved?.designs[g.id]??blankDesign(),true);if(stopped)return;}
        renderer.setGarments(loaded.current,true);
        designsRef.current=Object.fromEntries(Object.entries(saved?.designs??{}).map(([id,design])=>{const g=loaded.current.find(piece=>piece.id===id);return [id,g?fitDesign(design,g.type):design];}));setDesigns(designsRef.current);
        await Promise.all(Object.entries(designsRef.current).map(([id,design])=>renderer.applyDesign(id,design).catch(()=>setDesignError('One saved design could not be restored.'))));
        if(stopped||engine.current!==renderer)return;
        setCollection(loaded.current);setHoodie(extras.some(g=>g.type==='hoodie'));saveHydrated.current=true;setReady(true);setLoadError(false);
      }).catch(()=>{if(!stopped)fail();});
    }catch{queueMicrotask(()=>{if(!stopped)setLoadError(true);});}
    const visible=()=>{if(!document.hidden)engine.current?.invalidate();};
    document.addEventListener('visibilitychange',visible);
    return()=>{stopped=true;engine.current?.dispose();engine.current=null;mq.removeEventListener('change',applyMotion);document.removeEventListener('visibilitychange',visible);};
  }, [highlightRack,focusRack]);

  useEffect(()=>()=>{
    clearTimeout(saveTimer.current);
    if(saveHydrated.current)void saveChain.current.catch(()=>{}).then(()=>saveWardrobe({version:1,designs:designsRef.current,added:addedRef.current})).catch(()=>{});
  },[]);

  useEffect(()=>{engine.current?.invalidate();},[mode,hover,selected,hoodie,demo,mobile,rackPosition]);
  useEffect(()=>{scene.current.studio=showStudio;engine.current?.invalidate();},[showStudio]);
  useEffect(()=>{
    const viewport=window.visualViewport;
    const resize=()=>panel.current?.parentElement?.style.setProperty('--view-height',`${viewport?.height??window.innerHeight}px`);
    resize();viewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);
    return()=>{viewport?.removeEventListener('resize',resize);window.removeEventListener('resize',resize);};
  },[]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if(showCreator)return;
      if (e.key === 'Escape') { if(availability){setAvailability(false);return;}if(showStudio){setShowStudio(false);return;}close(); scene.current.demo = false; setDemo(false); }
      if(e.key==='Tab'&&scene.current.mode==='product') {
        const selector=availability?'.availability-panel button':'.product-controls button,.product-controls input,.drawer-handle';
        const buttons=Array.from(panel.current!.querySelectorAll<HTMLButtonElement>(selector)).filter(element=>!element.disabled&&element.tabIndex>=0);
        const first=buttons[0],last=buttons.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
      const editing=(e.target as HTMLElement).closest('.garment-studio')||['INPUT','TEXTAREA','SELECT'].includes((e.target as HTMLElement).tagName);
      if (!editing&&scene.current.mode === 'product' && e.key === 'ArrowLeft') { e.preventDefault(); pick(scene.current.selected - 1); }
      if (!editing&&scene.current.mode === 'product' && e.key === 'ArrowRight') { e.preventDefault(); pick(scene.current.selected + 1); }
      if (e.key.toLowerCase() === 'h' && !editing) setShowTools(v => !v);
    };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, [close, pick,availability,showStudio,showCreator]);
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

  useEffect(()=>{
    const element=canvas.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{
      if(scene.current.mode!=='rack'||!ready)return;
      event.preventDefault();cancelAnimationFrame(rackGlide.current);
      const bounds=element.getBoundingClientRect(),s=scene.current;
      const zoom=s.mobile?mobileRackView(loaded.current.map(g=>g.pivot),s.rackPosition,bounds.width,bounds.height).zoom:1;
      const gap=(loaded.current.at(-1)!.pivot-loaded.current[0].pivot)*W/Math.max(1,loaded.current.length-1);
      const pixels=(event.deltaX||event.deltaY)*(event.deltaMode===1?16:event.deltaMode===2?bounds.width:1);
      focusRack(s.rackPosition+pixels*W/(bounds.width*zoom*gap));
    };
    element.addEventListener('wheel',wheel,{passive:false});
    return()=>{element.removeEventListener('wheel',wheel);cancelAnimationFrame(rackGlide.current);};
  },[focusRack,ready]);

  const targetAt = (e: {clientX:number;clientY:number;pointerType?:string}) => {
    if(engine.current)return engine.current.hit(e.clientX,e.clientY,e.pointerType==='touch'||scene.current.mobile);
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
    if(pointerDown.current&&Math.abs(e.clientX-s.dragX)>5)s.dragging=true;
    if(mode==='product'&&pointerDown.current&&s.dragging){
      s.spin=s.dragStartSpin+(e.clientX-s.dragX)*.012;setOrientation(null);
      sampleDrag(gesture.current,s.spin,e.timeStamp);
      engine.current?.invalidate();return;
    }
    if(mode==='rack'&&pointerDown.current&&s.dragging){
      const bounds=e.currentTarget.getBoundingClientRect();
      const view=s.mobile?mobileRackView(collection.map(g=>g.pivot),s.rackPosition,bounds.width,bounds.height):{zoom:1};
      const gap=(collection.at(-1)!.pivot-collection[0].pivot)*RACK_WIDTH/(collection.length-1);
      focusRack(s.dragRackStart-(e.clientX-s.dragX)*RACK_WIDTH/(bounds.width*view.zoom*gap));
      sampleDrag(gesture.current,s.rackPosition,e.timeStamp);return;
    }
    if(s.demo||s.mobile||e.pointerType==='touch'||mode!=='rack')return;
    const i=engine.current?.hoverHit(e.clientX,e.clientY)??targetAt(e);
    if(s.active!==i)highlightRack(i);
  };
  const startDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if(e.button!==0||!ready)return;
    const s=scene.current;
    cancelAnimationFrame(rackGlide.current);engine.current?.stopMomentum();
    s.dragX=e.clientX;s.dragRackStart=s.rackPosition;s.dragging=false;
    s.dragStartSpin=mode==='product'?(engine.current?.beginSpinDrag()??s.spin):s.spin;
    gesture.current=dragMotion(mode==='product'?s.dragStartSpin:s.rackPosition,e.timeStamp);
    pointerDown.current=true;suppressClick.current=false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const glideRack=(velocity:number)=>{
    cancelAnimationFrame(rackGlide.current);
    if(scene.current.reduced||Math.abs(velocity)<.05){focusRack(Math.round(scene.current.rackPosition));return;}
    let previous=performance.now(),speed=clamp(velocity,-30,30);
    const tick=(now:number)=>{
      const next=stepGlide(speed,Math.max(0,(now-previous)/1000),4.8);previous=now;speed=next.velocity;
      const position=clamp(scene.current.rackPosition+next.distance,0,loaded.current.length-1);focusRack(position);
      if(Math.abs(speed)>.04&&position>0&&position<loaded.current.length-1)rackGlide.current=requestAnimationFrame(tick);
      else focusRack(Math.round(position));
    };
    rackGlide.current=requestAnimationFrame(tick);
  };
  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>, cancelled=false) => {
    if(!pointerDown.current)return;
    const s=scene.current,wasDragging=s.dragging;
    const velocity=cancelled||s.reduced?0:releaseVelocity(gesture.current,e.timeStamp);
    pointerDown.current=false;s.dragging=false;suppressClick.current=wasDragging;
    if(wasDragging&&mode==='rack')glideRack(velocity);
    if(wasDragging&&mode==='product')engine.current?.releaseSpin(velocity);
    engine.current?.invalidate();
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const leave = () => { if(!pointerDown.current&&!scene.current.demo&&!scene.current.mobile)highlightRack(-1); };
  const selectAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if(suppressClick.current){suppressClick.current=false;return;}
    if(mode!=='rack')return;
    const index=scene.current.mobile?targetAt(e):(engine.current?.hoverHit(e.clientX,e.clientY)??targetAt(e));
    if(index>=0)openProduct(index);
  };
  const addPiece = async (type:string,design:GarmentDesign=blankDesign()) => {
    if(pendingPiece.current||!ready||!engine.current)return false;
    if(loaded.current.length>=MAX_PIECES){setDesignError('The rack holds up to 100 pieces. Remove one to add another.');return false;}
    const choice=CLOTHING_TYPES.find(t=>t.type===type);if(!choice)return false;
    pendingPiece.current=true;setAdding(true);setDesignError('');
    try {
      const template=await getTemplate(choice.source);
      const g:Garment={...template,id:`custom-${crypto.randomUUID()}`,sourceId:choice.source,name:`My ${choice.label}`,reference:false};
      const fitted=fitDesign(design,type);
      const planned=arrangeRack([...PRODUCTS,...addedRef.current,g]);
      await engine.current.add(planned.at(-1)!,fitted);addedRef.current=planned.slice(PRODUCTS.length);
      loaded.current=planned;engine.current.setGarments(loaded.current);
      setCollection(loaded.current);setHoodie(addedRef.current.some(g=>g.type==='hoodie'));
      updateDesign(g.id,fitted);openProduct(loaded.current.length-1);setShowStudio(true);setShowTools(false);
      if(fitted.back&&!fitted.front)rotate('back');
      return true;
    }catch{setDesignError('Could not prepare this piece. Your artwork is still here. Try again.');return false;}
    finally{pendingPiece.current=false;setAdding(false);}
  };
  const changeType=async(type:string)=>{
    const piece=loaded.current[scene.current.selected],choice=CLOTHING_TYPES.find(t=>t.type===type);
    if(!piece||!choice||piece.type===type||pendingPiece.current||!engine.current)return;
    const design=fitDesign({... (designsRef.current[piece.id]??defaultDesign()),color:designsRef.current[piece.id]?.color??piece.fabricColor,originalPrint:false},type);
    if(!piece.sourceId){await addPiece(type,design);return;}
    pendingPiece.current=true;setAdding(true);setDesignError('');
    try{
      const template=await getTemplate(choice.source);
      const next:Garment={...template,id:piece.id,pivot:piece.pivot,sourceId:choice.source,name:`My ${choice.label}`,reference:false};
      await engine.current.replace(piece.id,next,design);
      addedRef.current=addedRef.current.map(g=>g.id===piece.id?next:g);
      loaded.current=arrangeRack([...PRODUCTS,...addedRef.current]);engine.current.setGarments(loaded.current);
      setCollection(loaded.current);setHoodie(addedRef.current.some(g=>g.type==='hoodie'));updateDesign(piece.id,design);
    }catch{setDesignError('Could not switch the garment. Your current piece and artwork are safe. Try again.');}
    finally{pendingPiece.current=false;setAdding(false);}
  };
  const downloadPreview=async()=>{
    if(downloading||!engine.current)return;setDownloading(true);setDesignError('');
    const name=loaded.current[scene.current.selected]?.name??'my-garment';
    try{
      const blob=await engine.current.exportPng(),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.png`;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch{setDesignError('Could not download the preview. Please try again.');}
    finally{setDownloading(false);}
  };
  const removePiece=()=>{
    const g=loaded.current[scene.current.selected];if(!g?.sourceId)return;
    engine.current?.remove(g.id);addedRef.current=addedRef.current.filter(piece=>piece.id!==g.id);
    const next={...designsRef.current};delete next[g.id];designsRef.current=next;setDesigns(next);
    loaded.current=arrangeRack([...PRODUCTS,...addedRef.current]);engine.current?.setGarments(loaded.current);
    setCollection(loaded.current);setHoodie(addedRef.current.some(piece=>piece.type==='hoodie'));
    pick(Math.min(scene.current.selected,loaded.current.length-1));persist();
  };
  const title = collection[selected]?.name;
  const fallbackView=mode==='product'?mobileProductView(collection[selected]??{},frame.width,frame.height):mobileRackView(collection.map(g=>g.pivot),rackPosition,frame.width,frame.height);
  const fallbackStyle=mobile?{transform:`translate(${(-fallbackView.x/W*100*fallbackView.zoom).toFixed(3)}%,${(fallbackView.y/W*frame.width/frame.height*100*fallbackView.zoom).toFixed(3)}%) scale(${fallbackView.zoom})`}:undefined;
  return (
    <main className="world">
      <div className={`wardrobe ${!ready&&!loadError?'is-loading':''} ${mode === 'product' ? 'is-product' : ''} ${showStudio&&mode==='product'?'has-studio':''} ${mode === 'about' || mode === 'contact' ? 'is-text' : ''}`} ref={panel}>
        <div className="wall" aria-hidden="true" />
        <header className="header" inert={mode!=='rack'}>
          <button onClick={() => { scene.current.mode='about';setMode('about'); }} className="text-button">ABOUT</button>
          <button className="brand" aria-label="Batch Merch home" onClick={close}><NextImage src="/brand.webp" alt="Batch Merch" width={200} height={119} unoptimized priority /></button>
          <button onClick={() => { scene.current.mode='contact';setMode('contact'); }} className="text-button">CONTACT</button>
        </header>
        <canvas ref={canvas} className={`rack-canvas ${hover >= 0 ? 'has-hover' : ''}`} onPointerMove={move} onPointerLeave={leave} onPointerDown={startDrag}
          onPointerUp={e=>endDrag(e)} onPointerCancel={e=>endDrag(e,true)} onLostPointerCapture={e=>endDrag(e,true)}
          onClick={selectAt}
          aria-label={mobile?'Interactive clothing rack. Swipe or use the slider to browse; tap a garment to inspect it.':'Interactive clothing rack. Hover or use the rack arrows to browse; click a garment to inspect it.'} />
        {loadError && <div className="poster-window"><NextImage className="static-poster" style={fallbackStyle} src={garmentAssetUrl(`/posters/${mode==='product'?(collection[selected]?.sourceId||collection[selected]?.id||'flowers'):hoodie?'rack-hoodie':'rack'}.webp`)} alt="Static garment preview" width={1456} height={810} unoptimized priority /></div>}
        {!ready&&!loadError && <div className="loading-garments" aria-live="polite"><span />Preparing the collection</div>}
        {loadError && <div className="renderer-note" role="status">3D unavailable · showing static preview <button onClick={()=>location.reload()}>RETRY 3D</button></div>}
        <div className="garment-accessibility" aria-label="Collection">
          {collection.map((g,i) => <button key={g.id} disabled={!ready&&!loadError} aria-label={`View ${g.name}`} onFocus={() => mobile||collection.length>10?focusRack(i):highlightRack(i)} onBlur={()=>{if(!canvas.current?.matches(':hover'))leave();}} onClick={() => openProduct(i)} style={{left:`${g.pivot*100}%`}}>{g.name}</button>)}
        </div>
        {mode==='rack' && <nav className="rack-navigation" aria-label="Browse the clothing rack" onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();browseRack(e.key==='ArrowLeft'?-1:1);}}}>
          <button className="round-button rack-previous" aria-label="Previous garment on rack" disabled={(!ready&&!loadError)||rackPosition<=0} onClick={()=>browseRack(-1)}><span aria-hidden="true">←</span></button>
          <input className="rack-slider" type="range" aria-label="Rack position" aria-valuetext={`${Math.round(rackPosition)+1} of ${collection.length}: ${collection[Math.round(rackPosition)]?.name}`} min={0} max={collection.length-1} step={.01} value={rackPosition} disabled={!ready&&!loadError} onChange={e=>{cancelAnimationFrame(rackGlide.current);focusRack(Number(e.currentTarget.value));}} onPointerUp={()=>focusRack(Math.round(scene.current.rackPosition))} onPointerCancel={()=>focusRack(Math.round(scene.current.rackPosition))} />
          <button className="round-button rack-next" aria-label="Next garment on rack" disabled={(!ready&&!loadError)||rackPosition>=collection.length-1} onClick={()=>browseRack(1)}><span aria-hidden="true">→</span></button>
          <output className="rack-position-label" aria-label="Collection position">{Math.round(rackPosition)+1} / {collection.length}</output>
          <output className="sr-only" aria-live="polite" aria-atomic="true">{hover>=0?`${hover+1} of ${collection.length}: ${collection[hover]?.name}`:''}</output>
        </nav>}
        {mode==='rack' && hover>=0 && <div className="hover-label" style={{left:`${collection.length>10?50:(collection[hover]?.pivot||.5)*100}%`}}>{collection[hover]?.name}</div>}
        {mode==='rack'&&<button className="availability" disabled={!ready&&!loadError} onClick={() => openProduct(hover>=0?hover:selected)}>SEE AVAILABILITY</button>}
        {mode==='rack'&&<button className="create-piece-button" disabled={!ready||loadError||adding} onClick={()=>{setShowCreator(true);setDesignError('');scene.current.demo=false;setDemo(false);setShowTools(false);}}><span aria-hidden="true">＋</span>Create your piece</button>}
        <div className="ticker" aria-label="New designs daily, subscribe to our newsletter" aria-hidden={mode!=='rack'}>
          <div className="ticker-track">{Array.from({length:8},(_,i)=><span key={i}>NEW DESIGNS DAILY <b>•</b> SUBSCRIBE TO OUR NEWSLETTER <b>•</b></span>)}</div>
        </div>
        {availability && <section className="availability-panel" role="dialog" aria-modal="true" aria-label="Availability"><button autoFocus className="close-button text-button" onClick={()=>setAvailability(false)}>CLOSE</button><h2>{title}</h2><p>This collection is a visual recreation. Live stock and checkout are not connected.</p><button className="outline-button" onClick={()=>setAvailability(false)}>BACK TO GARMENT</button></section>}
        {mode==='product' && <section className="product-controls" role="dialog" aria-modal="true" aria-label={title}>
          <button className="close-button text-button" onClick={close} autoFocus>CLOSE</button>
          <button className="round-button previous" aria-label="Previous garment" onClick={() => pick(selected-1)}><span aria-hidden="true">←</span></button>
          <button className="round-button next" aria-label="Next garment" onClick={() => pick(selected+1)}><span aria-hidden="true">→</span></button>
          <div className="product-caption" aria-live="polite"><span className="product-count">{String(selected+1).padStart(2,'0')} / {String(collection.length).padStart(2,'0')}</span><h1>{title}</h1></div>
          <div className="product-actions"><button className="customize-button" disabled={!ready||loadError} aria-expanded={showStudio} onClick={()=>{setShowStudio(v=>!v);setShowTools(false);}}>CUSTOMIZE</button><button disabled={!ready||loadError} aria-pressed={orientation==='front'} onClick={()=>rotate('front')}>FRONT</button><button disabled={!ready||loadError} aria-pressed={orientation==='back'} onClick={()=>rotate('back')}>BACK</button><button className="product-stock" onClick={()=>setAvailability(true)}>AVAILABILITY</button></div>
          {!showStudio&&ready&&<p className="rotation-hint">Drag to rotate · front and back</p>}
          {showStudio&&<GarmentStudio key={collection[selected].id} garment={collection[selected]} design={designs[collection[selected].id]??defaultDesign()} onChange={design=>updateDesign(collection[selected].id,design)} onClose={()=>setShowStudio(false)} onRotate={rotate} onTypeChange={type=>void changeType(type)} onRemove={collection[selected].sourceId?removePiece:undefined} onDownload={()=>void downloadPreview()} downloading={downloading} busy={adding} error={designError} saveStatus={saveStatus} />}
        </section>}
        {(mode==='about'||mode==='contact') && <section className="text-panel">
          <button className="close-button text-button" onClick={close} autoFocus>CLOSE</button>
          <NextImage className="panel-brand" src="/brand.webp" alt="Batch Merch" width={200} height={119} unoptimized />
          {mode==='about'?<><h1>Made to be seen.</h1><p>A collection of independent graphics, everyday tees, and heavyweight essentials.</p><button className="outline-button" onClick={close}>EXPLORE THE COLLECTION</button></>:<><h1>Let’s make something.</h1><p>Explore the collection and find your next favorite piece.</p><button className="outline-button" onClick={() => openProduct(selected)}>VIEW THE COLLECTION</button></>}
        </section>}
        <button className="drawer-handle" disabled={!ready&&!loadError} aria-label="Garment options" aria-expanded={showTools} onClick={()=>setShowTools(v=>!v)} />
      </div>
      {showCreator&&<CreatePiece busy={adding} error={designError} onClose={()=>setShowCreator(false)} onCreate={async(type,design)=>{if(await addPiece(type,design))setShowCreator(false);}}/>}
      {showTools && <div className="collection-tools"><span>Add a blank piece</span>{CLOTHING_TYPES.map(({type,label})=><button key={type} onClick={()=>void addPiece(type)} disabled={adding||!ready||loadError}>+ {label}</button>)}<button disabled={loadError||!ready} onClick={()=>{scene.current.demo=!demo;scene.current.demoStart=performance.now();setDemo(!demo);if(demo&&scene.current.mobile)focusRack(scene.current.active>=0?scene.current.active:scene.current.rackPosition,false);}}>{demo?'Stop replay':'Replay motion'}</button><button aria-label="Close garment options" onClick={()=>setShowTools(false)}>×</button></div>}
    </main>
  );
}
