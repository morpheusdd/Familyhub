import {hubStorage} from './hub.js';
const storageKey='haushaltszentrale-avatars-v1';
const imageData=/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i;

export function readAvatars(){
  const data=JSON.parse(hubStorage.getItem(storageKey));
  return Object.fromEntries(Object.entries(data??{}).filter(([,url])=>typeof url==='string'&&url.length<100000&&imageData.test(url)));
}

export async function writeAvatars(avatars){
  await hubStorage.setItem(storageKey,JSON.stringify(avatars));
}

export async function avatarFromFile(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024){
    throw Error('Wähle ein JPG-, PNG- oder WebP-Bild bis 15 MB.');
  }
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();
    image.src=url;
    await image.decode();
    const size=Math.min(image.naturalWidth,image.naturalHeight);
    if(!size)throw Error('Das Bild konnte nicht gelesen werden.');
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=112;
    const context=canvas.getContext('2d');
    context.fillStyle='#172334';
    context.fillRect(0,0,112,112);
    context.drawImage(image,(image.naturalWidth-size)/2,(image.naturalHeight-size)/2,size,size,0,0,112,112);
    return canvas.toDataURL('image/jpeg',0.85);
  }finally{
    URL.revokeObjectURL(url);
  }
}
