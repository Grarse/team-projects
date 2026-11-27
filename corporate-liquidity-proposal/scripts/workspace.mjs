import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {openPayload,sealPayload,validateWorkspace} from '../protection.mjs';
import {credentials} from './credentials.mjs';
const root=new URL('../',import.meta.url),workspaceRoot=new URL('.workspace/',root);
const target=path.resolve(fileURLToPath(workspaceRoot)),{login,password}=await credentials(root),command=process.argv[2];
if(command==='unlock'){
  try{if((await readdir(workspaceRoot)).length)throw new Error('Workspace already exists. Keep or move your changes before unlocking another version.');}catch(error){if(error.code!=='ENOENT')throw error;}
  let compressed;try{compressed=await openPayload(await readFile(new URL('proposal.enc',root)),login,password);}catch{throw new Error('Логин или пароль не подходят.');}
  const workspace=validateWorkspace(JSON.parse(gunzipSync(compressed,{maxOutputLength:64*1024*1024}).toString('utf8')));
  for(const file of workspace.files){const filename=path.resolve(target,...file.path.split('/'));if(!filename.startsWith(target+path.sep))throw new Error('Invalid extraction path');await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,Buffer.from(file.data,'base64'));}
  compressed.fill(0);console.log('Исходники открыты в .workspace/. Эта папка исключена из Git.');
}else if(command==='seal'){
  const files=[];
  async function collect(relative){for(const entry of (await readdir(new URL(relative,workspaceRoot),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const child=relative+entry.name;if(entry.isSymbolicLink())throw new Error('Symbolic links are not packaged');if(entry.isDirectory())await collect(child+'/');else if(entry.isFile())files.push({path:child,data:(await readFile(new URL(child,workspaceRoot))).toString('base64')});}}
  await collect('site/');await collect('tests/');
  const source=validateWorkspace({version:1,files});
  const packet=await sealPayload(gzipSync(JSON.stringify(source),{level:9}),login,password);
  await writeFile(new URL('proposal.enc',root),packet);
  console.log(`Зашифрованный пакет обновлён: ${files.length} файлов. Изменения готовы к коммиту.`);
}else throw new Error('Use: npm run unlock / npm run seal');
