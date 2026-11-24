import {initialize} from './hub.js';
try{
  await initialize();
  await import('./app.js');
}catch(error){
  const app=document.getElementById('app');
  app.textContent='Familyhub konnte nicht geladen werden: '+error.message;
}
