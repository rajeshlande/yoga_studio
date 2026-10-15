import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const origin=process.env.PAGES_TEST_ORIGIN||'http://127.0.0.1:4174';
for(let attempt=0;;attempt++){
 try{const response=await fetch(`${origin}/yoga_studio/`);if(response.ok)break;}catch{}
 if(attempt>=20)throw new Error('Pages preview did not become ready');
 await new Promise(resolve=>setTimeout(resolve,500));
}
const browser=await chromium.launch();
try{
 const context=await browser.newContext();
 const page=await context.newPage();
 const failures=[];
 page.on('pageerror',error=>failures.push(error.message));
 await page.goto(`${origin}/yoga_studio/`);
 await page.getByRole('heading',{name:'Welcome to your flow.'}).waitFor();
 const manifest=await page.evaluate(async()=>await(await fetch(document.querySelector('link[rel="manifest"]').href)).json());
 assert.equal(manifest.start_url,'./');
 assert.equal(manifest.name,'Yoga Studio');
 assert.equal(await page.getByText(/demo/i).count(),0);
 assert.equal(await page.getByRole('navigation').count(),0);
 await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.waitForFunction(()=>navigator.serviceWorker.controller);
 // A different project may share this github.io origin; its cache must survive.
 await page.evaluate(()=>caches.open('another-project-cache'));
 await context.setOffline(true);
 await page.reload();
 await page.getByRole('heading',{name:'Welcome to your flow.'}).waitFor();
 assert((await page.evaluate(()=>caches.keys())).includes('another-project-cache'));
 assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller.scriptURL),`${origin}/yoga_studio/sw.js`);
 assert.deepEqual(failures,[]);
 console.log('Pages /yoga_studio/: login, scoped worker, relative manifest, preserved unrelated cache and offline reload passed.');
}finally{await browser.close();}
