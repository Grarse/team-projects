import {readFile} from 'node:fs/promises';
import readline from 'node:readline';
export async function credentials(root){
  let values={};try{const text=await readFile(new URL('.env.local',root),'utf8');for(const line of text.split(/\r?\n/)){const at=line.indexOf('=');if(at>0)values[line.slice(0,at).trim()]=line.slice(at+1);}}catch{}
  let login=process.env.PROPOSAL_LOGIN||values.PROPOSAL_LOGIN,password=process.env.PROPOSAL_PASSWORD||values.PROPOSAL_PASSWORD;
  if(!login||!password){
    if(!process.stdin.isTTY)throw new Error('Set PROPOSAL_LOGIN and PROPOSAL_PASSWORD in an untracked .env.local file or use an interactive terminal.');
    const rl=readline.createInterface({input:process.stdin,output:process.stdout});
    const ask=(prompt,hidden=false)=>new Promise(resolve=>{if(hidden)rl._writeToOutput=()=>{};process.stdout.write(prompt);rl.question('',answer=>{if(hidden)process.stdout.write('\n');resolve(answer);});});
    if(!login)login=await ask('Логин: ');if(!password)password=await ask('Пароль: ',true);rl.close();
  }
  return {login,password};
}
