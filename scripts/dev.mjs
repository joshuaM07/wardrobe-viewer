import {fileURLToPath} from 'node:url';
import {readExecutionProfile} from './execution-profile.mjs';
const args=process.argv.slice(2);
if(readExecutionProfile()==='managed-linux') {
  process.argv=[process.execPath,fileURLToPath(new URL('../node_modules/vite/bin/vite.js',import.meta.url)),...args];
  await import('../node_modules/vite/bin/vite.js');
}else{
  process.argv=[process.execPath,fileURLToPath(new URL('../node_modules/next/dist/bin/next',import.meta.url)),'dev',...args];
  await import('../node_modules/next/dist/bin/next');
}
