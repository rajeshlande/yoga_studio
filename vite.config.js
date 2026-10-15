import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {isPublicKey,isProjectUrl} from './src/lib/public-config.mjs';

const {version}=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8'));

export default defineConfig(({mode})=>{
  const values=loadEnv(mode,process.cwd(),'VITE_');
  if(values.VITE_SUPABASE_ANON_KEY&&!isPublicKey(values.VITE_SUPABASE_ANON_KEY))throw new Error('Refusing to bundle a privileged or invalid key. Use a publishable/anon public key only.');
  if(values.VITE_SUPABASE_URL&&!isProjectUrl(values.VITE_SUPABASE_URL))throw new Error('Invalid authentication project URL. Configure an HTTPS endpoint without credentials.');
  return {
  define:{__APP_VERSION__:JSON.stringify(version)},
  cacheDir:process.env.TEST_CACHE_DIR||'node_modules/.vite',
  plugins:[react(),{
    name:'version-service-worker',
    configurePreviewServer(server){
      server.middlewares.use((req,res,next)=>{
        if(req.url==='/'&&server.config.base!=='/'){res.writeHead(302,{Location:server.config.base});res.end();}else next();
      });
    },
    writeBundle(options,bundle){
      // Asset filenames change with their content; each build gets its own offline cache.
      const path=resolve(options.dir||'dist','sw.js');
      const version=createHash('sha256').update(Object.keys(bundle).sort().join('|')).update(readFileSync(path)).update(readFileSync(resolve(options.dir||'dist','manifest.webmanifest'))).digest('hex').slice(0,12);
      writeFileSync(path,readFileSync(path,'utf8').replace('__BUILD_ID__',version));
    }
  }],
  server:{host:'0.0.0.0',allowedHosts:true},
  preview:{host:'0.0.0.0',allowedHosts:true}
};
});
