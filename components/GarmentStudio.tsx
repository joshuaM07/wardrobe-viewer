'use client';

import Image from 'next/image';
import { useRef, useState, useEffect } from 'react';
import { CLOTHING_TYPES, COLOR_SWATCHES, fitArtwork, printArea, prepareArtwork, type GarmentDesign, type PrintSide } from '@/lib/garment-design';
import type { Garment } from '@/lib/wardrobe-three';

export default function GarmentStudio({ garment, design, onChange, onClose, onRotate, onTypeChange, onRemove, onDownload, busy, downloading, error, saveStatus }: {
  garment: Garment; design: GarmentDesign; onChange: (design: GarmentDesign) => void;
  onClose: () => void; onRotate: (side: PrintSide) => void; onTypeChange: (type:string) => void;
  onRemove?: () => void; onDownload:()=>void; busy: boolean; downloading:boolean; error: string; saveStatus: string;
}) {
  const [side,setSide]=useState<PrintSide>(()=>!design.front&&design.back?'back':'front');
  const [section,setSection]=useState<'design'|'fabric'>('design');
  const [uploading,setUploading]=useState(false),[uploadError,setUploadError]=useState(''),[dragOver,setDragOver]=useState(false);
  const color=design.color??garment.fabricColor??'#e8e3d8';
  const [hexDraft,setHexDraft]=useState<{source:string;value:string}|null>(null);
  const hex=hexDraft?.source===color?hexDraft.value:color;
  const setHex=(value:string)=>setHexDraft({source:color,value});
  const fileInput=useRef<HTMLInputElement>(null),alive=useRef(true),currentDesign=useRef(design);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{currentDesign.current=design;},[design]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{onRotate(side);},[side,onRotate]);
  useEffect(()=>{const id=requestAnimationFrame(()=>heading.current?.focus({preventScroll:true}));return()=>cancelAnimationFrame(id);},[]);
  const artwork=design[side],area=printArea(garment.type,side);
  const label=CLOTHING_TYPES.find(t=>t.type===garment.type)?.label??'garment';
  const setColor=(color:string)=>{setHex(color);onChange({...design,color});};
  const upload=async(file?:File)=>{
    if(!file||uploading||busy)return;
    setUploading(true);setUploadError('');
    try{
      const image=fitArtwork(await prepareArtwork(file),garment.type,side,true);
      if(alive.current){const latest=currentDesign.current;onChange({...latest,color:latest.color??garment.fabricColor??'#e8e3d8',originalPrint:side==='front'?false:latest.originalPrint,[side]:image});onRotate(side);}
    }catch(error){if(alive.current)setUploadError(error instanceof Error?error.message:'Could not open this image.');}
    finally{if(alive.current){setUploading(false);if(fileInput.current)fileInput.current.value='';}}
  };
  const setPlacement=(key:'width'|'x'|'y',value:number)=>{
    if(artwork)onChange({...design,[side]:fitArtwork({...artwork,[key]:value},garment.type,side)});
  };
  return <aside className="garment-studio" aria-label="Customize garment" aria-busy={busy}>
    <div className="studio-heading"><div><span className="studio-eyebrow">YOUR DESIGN STUDIO</span><h2 ref={heading} tabIndex={-1}>Your {label.toLowerCase()}.</h2></div><button className="studio-close" aria-label="Close customization" onClick={onClose}>×</button></div>
    <div className="studio-scroll">
      <label className="studio-type"><span>Clothing type</span><select aria-label="Clothing type" value={garment.type} disabled={busy||uploading} onChange={e=>{onRotate(side);onTypeChange(e.target.value);}}>{CLOTHING_TYPES.map(choice=><option key={choice.type} value={choice.type}>{choice.label}</option>)}</select></label>
      {(busy||!garment.sourceId)&&<p className="studio-hint">{busy?'Preparing the new garment…':'Choose another type to create a blank with your artwork.'}</p>}
      <div className="studio-section-tabs" role="tablist" aria-label="Customize side or fabric" onKeyDown={e=>{
        if(busy||uploading)return;
        const options=['front','back','fabric'] as const,current=section==='fabric'?'fabric':side;
        let index=options.indexOf(current);
        if(e.key==='ArrowRight')index=(index+1)%3;else if(e.key==='ArrowLeft')index=(index+2)%3;else if(e.key==='Home')index=0;else if(e.key==='End')index=2;else return;
        e.preventDefault();e.stopPropagation();const value=options[index];
        if(value==='fabric')setSection('fabric');else{setSection('design');setSide(value);onRotate(value);}
        (e.currentTarget.querySelector(`#studio-tab-${value}`) as HTMLButtonElement)?.focus();
      }}>{(['front','back','fabric'] as const).map(value=>{
        const selected=value==='fabric'?section==='fabric':section==='design'&&side===value;
        return <button key={value} id={`studio-tab-${value}`} role="tab" aria-selected={selected} aria-controls="studio-panel" tabIndex={selected?0:-1} disabled={busy||uploading} onClick={()=>{if(value==='fabric')setSection('fabric');else{setSection('design');setSide(value);onRotate(value);}}}>{value==='fabric'?'Fabric colour':value==='front'?'Front':'Back'}{value!=='fabric'&&design[value]&&<span className="side-has-art" aria-label="has artwork"/>}</button>;
      })}</div>
      {section==='design'?<fieldset className="studio-section" id="studio-panel" role="tabpanel" aria-labelledby={`studio-tab-${side}`} disabled={busy}>
        <legend className="sr-only">Artwork</legend>
        <div className="artwork-panel">
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={`Upload ${side} artwork`} tabIndex={-1} disabled={uploading} onChange={e=>void upload(e.target.files?.[0])} />
          <button className={`artwork-upload ${dragOver?'is-drag-over':''} ${artwork?'has-artwork':''}`} disabled={uploading} onClick={()=>fileInput.current?.click()} onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);void upload(e.dataTransfer.files[0]);}}>
            {artwork?<Image src={artwork.dataUrl} alt={`${side} artwork preview`} width={56} height={56} unoptimized/>:<span className="upload-symbol" aria-hidden="true">↑</span>}<strong>{uploading?'Preparing artwork…':artwork?'Replace artwork':`Upload ${side} artwork`}</strong><span>PNG, JPG, WebP · up to 15 MB</span>
          </button>
          <p className="studio-hint">{garment.type==='hoodie'&&side==='front'?'Artwork fits above the pocket.':'Your artwork fits the garment automatically.'} Transparent PNGs work best.</p>
          {artwork&&<><div className="artwork-file"><span title={artwork.name}>{artwork.name}</span><button onClick={()=>onChange({...design,[side]:undefined})} aria-label={`Remove ${side} artwork`}>Remove</button></div>
            <label className="studio-slider"><span>Size <output>{Math.round(artwork.width/area.width*100)}%</output></span><input type="range" aria-label={`${side} artwork size`} min={Math.min(12,(area.bottom-area.top)*artwork.aspect)} max={Math.min(area.width,(area.bottom-area.top)*artwork.aspect)} step=".5" value={artwork.width} onChange={e=>setPlacement('width',Number(e.target.value))}/></label>
            <label className="studio-slider"><span>Left / right</span><input type="range" aria-label={`${side} artwork left / right`} min={-(area.width-artwork.width)/2} max={(area.width-artwork.width)/2} step=".5" value={artwork.x} disabled={area.width-artwork.width<1} onChange={e=>setPlacement('x',Number(e.target.value))}/></label>
            <label className="studio-slider"><span>Up / down</span><input type="range" aria-label={`${side} artwork up / down`} min={area.top+artwork.width/artwork.aspect/2} max={area.bottom-artwork.width/artwork.aspect/2} step=".5" value={artwork.y} disabled={area.bottom-area.top-artwork.width/artwork.aspect<1} onChange={e=>setPlacement('y',Number(e.target.value))}/></label>
            <button className="studio-link" onClick={()=>onChange({...design,[side]:fitArtwork(artwork,garment.type,side,true)})}>Fit and centre artwork</button>
          </>}
          {side==='front'&&!garment.sourceId&&<label className="original-print"><input type="checkbox" checked={design.originalPrint} onChange={e=>onChange({...design,originalPrint:e.target.checked})} /> Keep original graphic</label>}
        </div>
      </fieldset>:<fieldset className="studio-section" id="studio-panel" role="tabpanel" aria-labelledby="studio-tab-fabric" disabled={busy}>
        <legend>Choose your fabric colour</legend>
        <div className="color-swatches">{COLOR_SWATCHES.map(color=><button key={color} style={{background:color}} title={color} aria-label={`Fabric colour ${color}`} aria-pressed={(design.color??garment.fabricColor)?.toLowerCase()===color} onClick={()=>setColor(color)} />)}</div>
        <div className="custom-color"><label><input type="color" aria-label="Custom fabric colour" value={color} onChange={e=>setColor(e.target.value)} /> Any colour</label><input className="hex-input" aria-label="Hex colour" value={hex} spellCheck={false} autoComplete="off" autoCapitalize="characters" maxLength={7} onChange={e=>{const value=e.target.value;setHex(value);if(/^#[0-9a-f]{6}$/i.test(value))onChange({...design,color:value});}} onBlur={()=>setHex(color)} /></div>
        <p className="studio-hint">The same colour covers the front, back and sleeves.</p>
      </fieldset>}
      {(uploadError||error)&&<p className="studio-error" role="alert">{uploadError||error}</p>}
      <button className="studio-download" onClick={onDownload} disabled={busy||uploading||downloading}>{downloading?'Preparing PNG…':'Download PNG'}<span aria-hidden="true">↓</span></button>
      <div className="studio-reset"><button disabled={busy||uploading} onClick={()=>onChange(garment.sourceId?{color:'#e8e3d8',originalPrint:false}:{originalPrint:true})}>Reset this piece</button>{onRemove&&<button disabled={busy||uploading} onClick={onRemove}>Remove piece</button>}</div>
    </div>
    <div className={`studio-footer ${saveStatus.startsWith('Could')?'save-error':''}`} role="status"><span className="save-dot" aria-hidden="true" />{saveStatus}<span>Drag to rotate · edit either side</span></div>
  </aside>;
}
