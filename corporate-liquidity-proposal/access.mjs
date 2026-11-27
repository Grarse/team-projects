import {openPayload,validateWorkspace} from './protection.mjs';
import {compileWorkspace} from './renderer.mjs';
const $=id=>document.getElementById(id);
let packet=null,compiled=null,busy=false;
function status(text){$('login-status').textContent=text;}
function error(text){$('login-error').textContent=text;$('login-error').hidden=!text;}
$('show-password').addEventListener('click',()=>{
  const visible=$('password').type==='password';$('password').type=visible?'text':'password';
  $('show-password').setAttribute('aria-pressed',String(visible));$('show-password').setAttribute('aria-label',visible?'Скрыть пароль':'Показать пароль');
});
async function inflate(bytes){
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader=stream.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>64*1024*1024){await reader.cancel();throw new Error('Workspace too large');}chunks.push(value);}
  return await new Blob(chunks).text();
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;error('');$('open-button').disabled=true;$('login-form').setAttribute('aria-busy','true');
  let plain=null;
  try {
    if(!crypto?.subtle || typeof DecompressionStream==='undefined')throw new Error('unsupported');
    if(!packet){status('Загружаем защищённые материалы…');const response=await fetch('./proposal.enc',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('network');packet=new Uint8Array(await response.arrayBuffer());}
    status('Открываем предложение…');
    try {plain=await openPayload(packet,$('login').value,$('password').value);}catch{throw new Error('credentials');}
    const workspace=validateWorkspace(JSON.parse(await inflate(plain)));
    compiled=compileWorkspace(workspace);
    const frame=$('proposal-frame');frame.srcdoc=compiled.html;
    $('password').value='';$('password').type='password';$('show-password').setAttribute('aria-pressed','false');$('show-password').setAttribute('aria-label','Показать пароль');
    $('gate').hidden=true;$('proposal').hidden=false;document.title='Индивидуальное предложение';status('');
    frame.addEventListener('load',()=>{try{frame.contentWindow.focus();}catch{/* Focus is optional. */}},{once:true});
  } catch(cause) {
    compiled?.revoke();compiled=null;status('');
    error(cause.message==='credentials'?'Логин или пароль не подходят. Проверьте данные и попробуйте ещё раз.':cause.message==='unsupported'?'Откройте страницу в современном браузере по защищённой ссылке HTTPS.':'Не удалось открыть материалы. Обновите страницу и повторите попытку.');
    if(cause.message==='credentials'){$('password').value='';$('password').focus();}
  } finally {plain?.fill(0);busy=false;$('open-button').disabled=false;$('login-form').setAttribute('aria-busy','false');}
});
$('lock-proposal').addEventListener('click',()=>{
  $('proposal-frame').removeAttribute('srcdoc');$('proposal').hidden=true;$('gate').hidden=false;
  compiled?.revoke();compiled=null;$('password').value='';error('');status('');document.title='Индивидуальное предложение · Вход';$('password').focus();
});
// Credentials and decryption keys are never persisted or sent to a server.
