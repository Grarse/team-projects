import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=new URL('../.workspace/tests/',import.meta.url);
const names=['finance.test.mjs','iss.test.mjs','success-fee.test.mjs','history.test.mjs'];
const paths=names.map(name=>fileURLToPath(new URL(name,root)));
try{await Promise.all(paths.map(path=>access(path)));}catch{console.error('Сначала откройте исходники командой npm run unlock. Финансовые тесты не найдены.');process.exit(1);}
const result=spawnSync(process.execPath,['--test',...paths],{stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
