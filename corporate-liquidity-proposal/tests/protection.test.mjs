import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {sealPayload,openPayload,validateWorkspace,parseEnvelope} from '../protection.mjs';
import {localPath,rewriteModule} from '../renderer.mjs';
const message=gzipSync('Private demonstration content');
let packet;
test('Encrypted content opens with different cases in both credentials',async()=>{
  packet=await sealPayload(message,'DemoUser','DemoPassword!');
  const plain=await openPayload(packet,'dEmOuSeR','dEMOpASSWORD!');
  assert.equal(gunzipSync(plain).toString(),'Private demonstration content');
  assert.equal(new TextDecoder().decode(packet).includes('Private demonstration content'),false);
});
test('Wrong login, wrong password and modified ciphertext cannot open the content',async()=>{
  const encrypted=await sealPayload(message,'DemoUser','DemoPassword!');
  await assert.rejects(openPayload(encrypted,'SomeoneElse','DemoPassword!'));
  await assert.rejects(openPayload(encrypted,'DemoUser','Incorrect'));
  const modified=encrypted.slice();modified[modified.length-20]^=1;
  await assert.rejects(openPayload(modified,'DemoUser','DemoPassword!'));
  const second=await sealPayload(message,'DemoUser','DemoPassword!');
  assert.notDeepEqual(encrypted,second);
});
test('Envelope parameters and extracted paths reject malformed or escaping content',()=>{
  assert.throws(()=>parseEnvelope(new Uint8Array(80)));
  const good={version:1,files:[{path:'site/index.html',data:Buffer.from('<h1>Demo</h1>').toString('base64')}]};
  assert.equal(validateWorkspace(good),good);
  for(const path of ['../file','site/../secret','site//file','C:/secret','site/file\\escape'])assert.throws(()=>validateWorkspace({version:1,files:[...good.files,{path,data:''}]}));
  assert.throws(()=>validateWorkspace({version:1,files:[good.files[0],good.files[0]]}));
});
test('Module references and site-root assets remain local in a GitHub Pages subdirectory',()=>{
  assert.equal(localPath('/fonts/font.woff2','glass.css'),'fonts/font.woff2');
  assert.equal(localPath('./data.mjs','modules/app.mjs'),'modules/data.mjs');
  assert.equal(localPath('https://iss.moex.com/iss','app.mjs'),null);
  assert.equal(localPath('#dynamics','index.html'),null);
  const source="import {x} from './data.mjs'; import './effects.mjs'; const lazy=import('./lazy.mjs'); const remote='https://iss.moex.com/';";
  const rewritten=rewriteModule(source,'app.mjs',path=>'blob:'+path);
  assert.ok(rewritten.includes("from 'blob:data.mjs'"));
  assert.ok(rewritten.includes("import 'blob:effects.mjs'"));
  assert.ok(rewritten.includes("import('blob:lazy.mjs')"));
  assert.ok(rewritten.includes('https://iss.moex.com/'));
});
