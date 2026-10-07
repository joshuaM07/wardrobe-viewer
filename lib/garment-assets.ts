// Keep cached GLBs, their atlases and fallback posters on the same mesh revision.
const GARMENT_ASSET_REVISION = 'dynamic-fabric-v9';

export function garmentAssetUrl(url: string) {
  if (/^(data|blob):/.test(url) || url.includes('garmentRevision=')) return url;
  return `${url}${url.includes('?')?'&':'?'}garmentRevision=${GARMENT_ASSET_REVISION}`;
}
