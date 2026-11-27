const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});
const MAGIC = encoder.encode('KPPROT1\n');
export const ITERATIONS = 600_000;
const MAX_PACKET = 48 * 1024 * 1024;

export function canonicalCredentials(login, password) {
  if (typeof login !== 'string' || typeof password !== 'string' || !login || !password || login.length > 128 || password.length > 512 || login.includes('\0') || password.includes('\0')) throw new Error('Invalid credentials');
  // Case folding is an explicit requirement for both fields.
  return encoder.encode(login.toLowerCase() + '\0' + password.toLowerCase());
}
const toHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
function fromHex(value, length) {
  if (typeof value !== 'string' || value.length !== length * 2 || !/^[0-9a-f]+$/.test(value)) throw new Error('Invalid envelope');
  return Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte,16));
}
async function derive(login, password, salt, iterations, usage) {
  const material = canonicalCredentials(login,password);
  try {
    const base = await crypto.subtle.importKey('raw',material,'PBKDF2',false,['deriveKey']);
    return await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,[usage]);
  } finally {material.fill(0);}
}
export function parseEnvelope(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 64 || bytes.length > MAX_PACKET || !MAGIC.every((byte,i)=>bytes[i]===byte)) throw new Error('Invalid envelope');
  const length = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8,false);
  if (length < 50 || length > 1024 || 12 + length + 16 >= bytes.length) throw new Error('Invalid envelope');
  const header = JSON.parse(decoder.decode(bytes.subarray(12,12+length)));
  if (header.version!==1 || header.iterations!==ITERATIONS || header.compression!=='gzip') throw new Error('Unsupported envelope');
  return {bytes,header,salt:fromHex(header.salt,32),iv:fromHex(header.iv,12),additionalData:bytes.subarray(0,12+length),ciphertext:bytes.subarray(12+length)};
}
export async function sealPayload(input, login, password) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = encoder.encode(JSON.stringify({version:1,iterations:ITERATIONS,compression:'gzip',salt:toHex(salt),iv:toHex(iv)}));
  const prefix = new Uint8Array(12+header.length);
  prefix.set(MAGIC);new DataView(prefix.buffer).setUint32(8,header.length,false);prefix.set(header,12);
  const key = await derive(login,password,salt,ITERATIONS,'encrypt');
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:prefix,tagLength:128},key,input));
  const packet = new Uint8Array(prefix.length+cipher.length);packet.set(prefix);packet.set(cipher,prefix.length);
  return packet;
}
export async function openPayload(input, login, password) {
  const envelope = parseEnvelope(input);
  const key = await derive(login,password,envelope.salt,envelope.header.iterations,'decrypt');
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:envelope.iv,additionalData:envelope.additionalData,tagLength:128},key,envelope.ciphertext));
}

export function validateWorkspace(value) {
  if (!value || value.version!==1 || !Array.isArray(value.files) || value.files.length<1 || value.files.length>300) throw new Error('Invalid workspace');
  const seen = new Set();
  let total = 0;
  for (const file of value.files) {
    if (!file || typeof file.path!=='string' || !/^(site|tests)\/[a-zA-Z0-9_./-]+$/.test(file.path) || file.path.split('/').some(part=>!part || part==='.' || part==='..') || seen.has(file.path) || typeof file.data!=='string' || file.data.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw new Error('Invalid workspace path');
    total += file.data.length;
    if(total>64*1024*1024)throw new Error('Workspace too large');
    seen.add(file.path);
  }
  if(!seen.has('site/index.html'))throw new Error('Missing entry page');
  return value;
}
