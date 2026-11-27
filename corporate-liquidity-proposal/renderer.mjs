const decoder = new TextDecoder('utf-8',{fatal:true});
export const mimeFor = path => ({html:'text/html',css:'text/css',mjs:'text/javascript',js:'text/javascript',json:'application/json',png:'image/png',jpg:'image/jpeg',svg:'image/svg+xml',pdf:'application/pdf',woff2:'font/woff2',md:'text/plain',txt:'text/plain'})[path.split('.').at(-1)] || 'application/octet-stream';
export function localPath(reference, originPath) {
  if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return null;
  const path = new URL(reference,'https://bundle.invalid/'+originPath).pathname.slice(1);
  return decodeURIComponent(path);
}
export function rewriteModule(source,path,resource) {
  let result=source.replace(/\b(from\s*|import\s*)(['"])(\.{1,2}\/[^'"\n]+)\2/g,(match,prefix,quote,ref)=>`${prefix}${quote}${resource(localPath(ref,path))}${quote}`);
  return result.replace(/\bimport\s*\(\s*(['"])(\.{1,2}\/[^'"\n]+)\1\s*\)/g,(match,quote,ref)=>`import(${quote}${resource(localPath(ref,path))}${quote})`);
}
export function compileWorkspace(workspace) {
  const files = new Map(workspace.files.filter(file=>file.path.startsWith('site/')).map(file=>[file.path.slice(5),Uint8Array.from(atob(file.data),c=>c.charCodeAt(0))]));
  const urls = new Map(), building = new Set();
  function resource(path) {
    if(urls.has(path))return urls.get(path);
    if(!files.has(path) || building.has(path))throw new Error('Missing or circular local resource');
    building.add(path);
    try {
      let content=files.get(path);
      if(/\.(mjs|js)$/.test(path))content=rewriteModule(decoder.decode(content),path,resource);
      if(path.endsWith('.css'))content=decoder.decode(content).replace(/url\(\s*(['"]?)([^)'"\n]+)\1\s*\)/g,(match,quote,ref)=>{
        const local=localPath(ref.trim(),path);return local?`url("${resource(local)}")`:match;
      });
      const url=URL.createObjectURL(new Blob([content],{type:mimeFor(path)}));urls.set(path,url);return url;
    } finally {building.delete(path);}
  }
  function revoke() {for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();files.clear();}
  try {
    const page=new DOMParser().parseFromString(decoder.decode(files.get('index.html')),'text/html');
    for(const element of page.querySelectorAll('[src],[href]'))for(const attr of ['src','href']) {
      const ref=element.getAttribute(attr),local=localPath(ref,'index.html');
      if(local && files.has(local))element.setAttribute(attr,resource(local));
    }
    // A srcdoc frame inherits the shell's base URL. Keep fragment navigation inside
    // the decrypted document instead of navigating back to the login shell.
    const fragmentGuard=`document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(!link)return;const target=document.getElementById(link.getAttribute('href').slice(1));if(target){event.preventDefault();target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}});`;
    const guardURL=URL.createObjectURL(new Blob([fragmentGuard],{type:'text/javascript'}));urls.set('__fragment_guard__',guardURL);
    const guard=page.createElement('script');guard.src=guardURL;page.head.prepend(guard);
    return {html:'<!doctype html>\n'+page.documentElement.outerHTML,revoke};
  } catch(error){revoke();throw error;}
}
