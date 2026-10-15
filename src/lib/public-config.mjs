// Browser authentication may only use public configuration, never an administrative key.
export function isPublicKey(value){
  if(typeof value!=='string'||!value)return false;
  if(value.startsWith('sb_publishable_'))return true;
  if(value.startsWith('sb_secret_'))return false;
  try{
    const payload=value.split('.')[1];
    const json=typeof atob==='function'?atob(payload.replace(/-/g,'+').replace(/_/g,'/')):Buffer.from(payload,'base64url').toString('utf8');
    return JSON.parse(json).role==='anon';
  }catch{return false;}
}
export function isProjectUrl(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
}
