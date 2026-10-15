import {readFileSync,readdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const build=process.argv.includes('--build');
const walk=directory=>readdirSync(directory).flatMap(name=>{const path=`${directory}/${name}`;return statSync(path).isDirectory()?walk(path):[path];});
const files=build?walk('dist'):execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const checks=[
  ['GitHub access token',/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}/g],
  ['Supabase secret key',/sb_secret_[A-Za-z0-9_-]{15,}/g],
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['database credential URL',/postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/g]
];
let count=0;
for(const file of files){
  let text;try{text=readFileSync(file,'utf8');}catch{continue;}
  for(const [label,pattern] of checks){
    if(pattern.test(text)){console.error(`${file}: detected ${label}; value suppressed`);count++;}
    pattern.lastIndex=0;
  }
  for(const token of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)){
    let role;try{role=JSON.parse(Buffer.from(token[0].split('.')[1],'base64url').toString()).role;}catch{}
    // An anon JWT is public in the browser, but no real JWT belongs in committed source.
    if(!build||role!=='anon'){console.error(`${file}: detected a disallowed JWT; value suppressed`);count++;}
  }
  if(!build&&/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(text)){console.error(`${file}: hardcoded project identifier; value suppressed`);count++;}
}
if(count){console.error(`Security pattern check failed: ${count} finding(s).`);process.exit(1);}
console.log(`${build?'Built assets':'Committed files'}: no matching privileged credentials${build?'':' or hardcoded project identifiers'} detected. Pattern checks are not a complete security audit.`);
