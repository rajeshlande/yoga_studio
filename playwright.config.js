import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',
  use:{headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
  reporter:'list',
  workers:1,
  projects:[
    {name:'auth-ui',testMatch:'app.spec.js',use:{baseURL:'http://127.0.0.1:5175'}},
    {name:'unconfigured',testMatch:'unconfigured.spec.js',use:{baseURL:'http://127.0.0.1:5176'}},
    {name:'erp-local',testMatch:'erp-local.spec.js',use:{baseURL:'http://127.0.0.1:5176'}}
  ],
  webServer:[
    {command:'npm run dev -- --port 5175 --strictPort',url:'http://127.0.0.1:5175',reuseExistingServer:false,env:{TEST_CACHE_DIR:'node_modules/.vite-auth-tests',VITE_SUPABASE_URL:'https://auth.yoga-studio.test',VITE_SUPABASE_ANON_KEY:'sb_publishable_browser_test_only'}},
    {command:'npm run dev -- --port 5176 --strictPort',url:'http://127.0.0.1:5176',reuseExistingServer:false,env:{TEST_CACHE_DIR:'node_modules/.vite-unconfigured-tests',VITE_SUPABASE_ANON_KEY:''}}
  ]
});
