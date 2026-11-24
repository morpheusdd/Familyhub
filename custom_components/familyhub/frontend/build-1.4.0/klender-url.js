export function klenderUrl(value){
  let url;
  try{url=new URL(String(value).trim().replace(/^webcal:/i,'https:'));}
  catch{throw Error('Bitte füge einen gültigen Klender-ICS-Link ein.');}
  const klenderHost=/(^|\.)klender\.(nl|de|co\.uk)$/i.test(url.hostname);
  if(url.protocol!=='https:'||!klenderHost||url.username||url.password||url.port){
    throw Error('Bitte verwende den HTTPS- oder webcal-Exportlink direkt aus Klender.');
  }
  url.hash='';
  return url;
}
