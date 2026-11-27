import http from 'node:http';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),allowed=new Set(['index.html','access.css','access.mjs','protection.mjs','renderer.mjs','favicon.svg','proposal.enc']);
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',mjs:'text/javascript; charset=utf-8',svg:'image/svg+xml',enc:'application/octet-stream'};
http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;const name=pathname==='/'?'index.html':pathname.slice(1);if(!allowed.has(name)){res.writeHead(404).end('Not found');return;}const body=await readFile(new URL(name,root));res.writeHead(200,{'Content-Type':types[name.split('.').at(-1)]||'application/octet-stream','Cache-Control':'no-store'}).end(body);}catch{res.writeHead(404).end('Not found');}}).listen(4175,'127.0.0.1',()=>console.log('Protected preview: http://127.0.0.1:4175/'));
