import type { ClothingType } from '@/lib/garment-design';

export default function GarmentTypeIcon({type}:{type:ClothingType}) {
  return <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
    {type==='hoodie'?<><path d="M29 23C29 8 51 8 51 23L61 29L72 57L60 62L54 47V70H26V47L20 62L8 57L19 29Z"/><path d="M29 23L40 32L51 23M34 29V42M46 29V42M32 51H48L51 62H29Z"/></>:
    type==='tee'?<><path d="M29 17L15 23L4 39L18 48L26 39V69H54V39L62 48L76 39L65 23L51 17C48 28 32 28 29 17Z"/><path d="M29 17C30 30 50 30 51 17M26 63H54"/></>:
    <><path d="M29 17L17 22L5 62L19 67L26 43V70H54V43L61 67L75 62L63 22L51 17C48 27 32 27 29 17Z"/><path d={type==='crewneck'?'M29 17C30 30 50 30 51 17M26 64H54M6 57L20 62M60 62L74 57':'M29 17C31 26 49 26 51 17M26 67H54'}/></>}
  </svg>;
}
