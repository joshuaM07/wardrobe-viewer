'use client';

import { useRef, useState, useEffect } from 'react';
import { CLOTHING_TYPES, COLOR_SWATCHES, prepareArtwork, type GarmentDesign, type PrintSide } from '@/lib/garment-design';
import type { Garment } from '@/lib/wardrobe-three';

export default function GarmentStudio({ garment, design, onChange, onClose, onRotate, onAdd, onRemove, busy, error, saveStatus }: {
  garment: Garment; design: GarmentDesign; onChange: (design: GarmentDesign) => void;
  onClose: () => void; onRotate: (side: PrintSide) => void;
  onAdd: (type: string) => void; onRemove?: () => void;
  busy: boolean; error: string; saveStatus: string;
}) {
  const [side,setSide]=useState<PrintSide>('front');
  const [uploading,setUploading]=useState(false);
  const [uploadError,setUploadError]=useState('');
  const [dragOver,setDragOver]=useState(false);
  const color=design.color??garment.fabricColor??'#e8e3d8';
  const [hexDraft,setHexDraft]=useState<{source:string;value:string}|null>(null);
  const hex=hexDraft?.source===color?hexDraft.value:color;
  const setHex=(value:string)=>setHexDraft({source:color,value});
  const fileInput=useRef<HTMLInputElement>(null);
  const alive=useRef(true);
  const currentDesign=useRef(design);
  useEffect(()=>{currentDesign.current=design;},[design]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const artwork=design[side];
  const setColor=(color:string)=>{setHex(color);onChange({...design,color});};
  const upload=async(file?:File)=>{
    if(!file||uploading)return;
    setUploading(true);setUploadError('');
    try{
      const image=await prepareArtwork(file);
      if(alive.current){const latest=currentDesign.current;onChange({...latest,color:latest.color??garment.fabricColor??'#e8e3d8',originalPrint:side==='front'?false:latest.originalPrint,[side]:image});}
    }catch(error){if(alive.current)setUploadError(error instanceof Error?error.message:'Could not open this image.');}
    finally{if(alive.current){setUploading(false);if(fileInput.current)fileInput.current.value='';}}
  };
  return <aside className="garment-studio" aria-label="Customize garment">
    <div className="studio-heading"><div><span className="studio-eyebrow">YOUR DESIGN</span><h2>Make it yours.</h2></div><button className="studio-close" aria-label="Close customization" onClick={onClose}>×</button></div>
    <div className="studio-scroll">
      <p className="studio-piece">{garment.name}</p>
      <fieldset className="studio-section"><legend>Fabric colour</legend>
        <div className="color-swatches">{COLOR_SWATCHES.map(color=><button key={color} style={{background:color}} title={color} aria-label={`Fabric colour ${color}`} aria-pressed={(design.color??garment.fabricColor)?.toLowerCase()===color} onClick={()=>setColor(color)} />)}</div>
        <div className="custom-color"><label><input type="color" aria-label="Custom fabric colour" value={design.color??garment.fabricColor??'#e8e3d8'} onChange={e=>setColor(e.target.value)} /> Any colour</label><input className="hex-input" aria-label="Hex colour" value={hex} spellCheck={false} maxLength={7} onChange={e=>{const value=e.target.value;setHex(value);if(/^#[0-9a-f]{6}$/i.test(value))onChange({...design,color:value});}} onBlur={()=>setHex(design.color??garment.fabricColor??'#e8e3d8')} /></div>
      </fieldset>
      <fieldset className="studio-section"><legend>Artwork</legend>
        <div className="studio-tabs" role="tablist" aria-label="Print side" onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();const next=side==='front'?'back':'front';setSide(next);onRotate(next);(e.currentTarget.querySelector(`#print-${next}`) as HTMLButtonElement)?.focus();}}}>{(['front','back'] as const).map(value=><button key={value} role="tab" tabIndex={side===value?0:-1} aria-selected={side===value} aria-controls="artwork-panel" id={`print-${value}`} onClick={()=>{setSide(value);onRotate(value);}}>{value==='front'?'Front':'Back'}</button>)}</div>
        <div id="artwork-panel" role="tabpanel" aria-labelledby={`print-${side}`}>
          {side==='front'&&<label className="original-print"><input type="checkbox" checked={design.originalPrint} onChange={e=>onChange({...design,originalPrint:e.target.checked})} /> Keep original graphic</label>}
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={`Upload ${side} artwork`} tabIndex={-1} onChange={e=>void upload(e.target.files?.[0])} />
          <button className={`artwork-upload ${dragOver?'is-drag-over':''}`} disabled={uploading} onClick={()=>fileInput.current?.click()} onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);void upload(e.dataTransfer.files[0]);}}>
            <span className="upload-symbol" aria-hidden="true">↑</span><strong>{uploading?'Preparing artwork…':artwork?'Replace artwork':'Upload your artwork'}</strong><span>PNG, JPG, WebP · drop or choose a file</span>
          </button>
          <p className="studio-hint">Transparent PNGs blend best with the fabric.</p>
          {artwork&&<><div className="artwork-file"><span title={artwork.name}>{artwork.name}</span><button onClick={()=>onChange({...design,[side]:undefined})} aria-label={`Remove ${side} artwork`}>Remove</button></div>
            {([['width','Size',12,Math.min(330,340*artwork.aspect)],['x','Left / right',-85,85],['y','Up / down',150,550]] as const).map(([key,label,min,max])=><label className="studio-slider" key={key}><span>{label}</span><input type="range" aria-label={`${side} artwork ${label.toLowerCase()}`} min={min} max={max} step={1} value={artwork[key]} onChange={e=>onChange({...design,[side]:{...artwork,[key]:Number(e.target.value)}})} /></label>)}
            <button className="studio-link" onClick={()=>onChange({...design,[side]:{...artwork,x:0,y:300,width:Math.min(240,280*artwork.aspect)}})}>Centre artwork</button>
          </>}
        </div>
      </fieldset>
      <div className="studio-section studio-new"><span className="studio-legend">Add a blank piece</span><div>{CLOTHING_TYPES.map(({type,label})=><button disabled={busy} key={type} onClick={()=>onAdd(type)}>+ {label}</button>)}</div></div>
      <div className="studio-reset"><button onClick={()=>onChange(garment.sourceId?{color:'#e8e3d8',originalPrint:false}:{originalPrint:true})}>Reset this piece</button>{onRemove&&<button onClick={onRemove}>Remove piece</button>}</div>
      {(uploadError||error)&&<p className="studio-error" role="alert">{uploadError||error}</p>}
    </div>
    <div className="studio-footer"><span className="save-dot" aria-hidden="true" />{saveStatus}<span>Drag the garment to rotate</span></div>
  </aside>;
}
