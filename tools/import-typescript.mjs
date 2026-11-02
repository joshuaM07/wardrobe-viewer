// Import production TypeScript in offline Node QA, resolving the bundler's extensionless imports.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const cache=new Map();
export function moduleURL(file){
  if(cache.has(file))return cache.get(file);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const resolved=source.replace(/from (['"])([^'"]+)\1/g,(_,quote,specifier)=>{
    const target=specifier.startsWith('.')?moduleURL(path.resolve(path.dirname(file),specifier.endsWith('.ts')?specifier:specifier+'.ts')):import.meta.resolve(specifier);
    return `from ${quote}${target}${quote}`;
  });
  const url='data:text/javascript;base64,'+Buffer.from(resolved).toString('base64');cache.set(file,url);return url;
}
