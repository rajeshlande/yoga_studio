// Test-only network fixtures. These are not imported by the application or shipped in dist/.
export const account={id:'84d3cc36-9a33-4a66-8ea0-ef6395dccaf0',aud:'authenticated',role:'authenticated',email:'qa@example.test',email_confirmed_at:'2026-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{full_name:'Test Member',bio:''}};
export function accessToken(){
 const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 return `${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:account.id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})}.test-signature`;
}
export async function mockAuth(page){
 let user=structuredClone(account);
 const calls=[];
 await page.route('https://auth.yoga-studio.test/auth/v1/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  const data=request.postDataJSON()||{};
  calls.push({path:url.pathname,method:request.method(),data});
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(url.pathname.endsWith('/token')){
   if(data.password==='incorrect-password')return reply({code:'invalid_credentials',error_code:'invalid_credentials',msg:'Internal provider details that must not be echoed'},400);
   return reply({access_token:accessToken(),refresh_token:'test-only-refresh-token',expires_in:3600,token_type:'bearer',user});
  }
  if(url.pathname.endsWith('/signup'))return reply({...user,email:data.email,user_metadata:data.data});
  if(url.pathname.endsWith('/recover'))return reply({});
  if(url.pathname.endsWith('/logout'))return route.fulfill({status:204});
  if(url.pathname.endsWith('/user')){
   if(request.method()==='PUT'&&data.data)user={...user,user_metadata:{...user.user_metadata,...data.data}};
   return reply(user);
  }
  return reply({message:'Unexpected test endpoint'},400);
 });
 return calls;
}
export async function signIn(page){
 await page.getByLabel('Email address').fill(account.email);
 await page.getByLabel('Password',{exact:true}).fill('valid-test-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('heading',{name:'Welcome back, Test.'}).waitFor();
}
