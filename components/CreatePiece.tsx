'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { blankDesign, CLOTHING_TYPES, fitArtwork, prepareArtwork, type Artwork, type ClothingType, type GarmentDesign, type PrintSide } from '@/lib/garment-design';
import GarmentTypeIcon from './GarmentTypeIcon';

export default function CreatePiece({onClose,onCreate,busy,error}:{onClose:()=>void;onCreate:(type:ClothingType,design:GarmentDesign)=>Promise<void>;busy:boolean;error:string}) {
  const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),alive=useRef(true),uploadVersion=useRef(0);
  const [type,setType]=useState<ClothingType>('tee'),[side,setSide]=useState<PrintSide>('front');
  const [artwork,setArtwork]=useState<Artwork>(),[preparing,setPreparing]=useState(false),[uploadError,setUploadError]=useState(''),[dragOver,setDragOver]=useState(false);
  useEffect(()=>{
    alive.current=true;const previous=document.activeElement as HTMLElement|null;
    dialog.current?.showModal();
    return()=>{alive.current=false;if(previous?.isConnected)previous.focus();};
  },[]);
  const upload=async(file?:File)=>{
    if(!file)return;const version=++uploadVersion.current;setPreparing(true);setUploadError('');
    try{const image=await prepareArtwork(file);if(alive.current&&version===uploadVersion.current)setArtwork(image);}
    catch(error){if(alive.current&&version===uploadVersion.current)setUploadError(error instanceof Error?error.message:'Could not open this image.');}
    finally{if(alive.current&&version===uploadVersion.current){setPreparing(false);if(input.current)input.current.value='';}}
  };
  const label=CLOTHING_TYPES.find(t=>t.type===type)!.label;
  return <dialog ref={dialog} className="create-dialog" aria-labelledby="create-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}} onClick={e=>{if(e.target===e.currentTarget&&!busy)onClose();}} onKeyDown={e=>{
    if(e.key!=='Tab')return;
    const controls=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button,input,select,a[href]')).filter(el=>!el.matches(':disabled')&&el.tabIndex>=0&&el.getClientRects().length>0&&(!(el instanceof HTMLInputElement)||el.type!=='radio'||el.checked));
    const first=controls[0],last=controls.at(-1);
    if(!first){e.preventDefault();return;}
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }}>
    <div className="create-content">
      <header className="create-heading"><div><span className="studio-eyebrow">YOUR OWN PIECE</span><h2 id="create-title">Start with your garment.</h2><p>Choose a style. Make it yours in 3D.</p></div><button className="studio-close" aria-label="Close create piece" disabled={busy} onClick={onClose}>×</button></header>
      <div className="create-scroll">
      <fieldset className="create-types" disabled={busy}><legend>1. Choose your clothing type</legend><div className="type-options">{CLOTHING_TYPES.map(choice=><label key={choice.type} className={type===choice.type?'is-selected':''}><input type="radio" name="clothing-type" value={choice.type} checked={type===choice.type} onChange={()=>setType(choice.type)}/><GarmentTypeIcon type={choice.type}/><span>{choice.label}</span></label>)}</div></fieldset>
      <div className="create-artwork"><div className="create-artwork-heading"><h3>2. Add your design</h3><span>Optional</span></div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="Choose design file" onChange={e=>void upload(e.target.files?.[0])} disabled={busy||preparing}/>
        <button className={`artwork-upload ${dragOver?'is-drag-over':''}`} disabled={busy||preparing} onClick={()=>input.current?.click()} onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);if(!busy)void upload(e.dataTransfer.files[0]);}}>
          {artwork?<Image src={artwork.dataUrl} alt="Your uploaded design" width={72} height={72} unoptimized className="create-artwork-preview"/>:<span className="upload-symbol" aria-hidden="true">↑</span>}
          <strong>{preparing?'Preparing your image…':artwork?artwork.name:'Upload your artwork'}</strong><span>{artwork?'Choose another file':'PNG, JPG or WebP · up to 15 MB'}</span>
        </button>
        <div className="create-print-side"><span>Print on</span><div role="group" aria-label="Initial print side">{(['front','back'] as const).map(value=><button key={value} disabled={busy} aria-pressed={side===value} onClick={()=>setSide(value)}>{value==='front'?'Front':'Back'}</button>)}</div>{artwork&&<button className="studio-link" disabled={busy} onClick={()=>setArtwork(undefined)}>Remove design</button>}</div>
        <p className="create-note">You can change the colour, position and print side in the editor. Your design stays on this device.</p>
      </div>
      {(uploadError||error)&&<p className="studio-error" role="alert">{uploadError||error}</p>}
      </div>
      <footer className="create-footer"><button className="create-submit" disabled={busy||preparing} onClick={()=>void onCreate(type,{...blankDesign(),...(artwork?{[side]:fitArtwork(artwork,type,side,true)}:{})})}>{busy?'Preparing your piece…':`Create ${label}` }<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m6 18 12-12M6 6h12v12"/></svg></button></footer>
    </div>
  </dialog>;
}
