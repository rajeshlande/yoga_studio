import {test,expect} from '@playwright/test';
import pkg from '../package.json' with {type:'json'};

test('no key means no private access; previous sample storage is deleted without affecting unrelated keys',async({page})=>{
 page.on('pageerror',error=>console.error('Browser page error:',error.message));
 await page.addInitScript(()=>{
  localStorage.setItem('yoga-profile',JSON.stringify({name:'Legacy Sample',email:'legacy@example.test'}));
  localStorage.setItem('ys-tasks','[]');
  sessionStorage.setItem('yoga-demo-session','true');
  localStorage.setItem('unrelated-project-data','preserve');
 });
 await page.goto('/#dashboard');
 await expect(page.getByRole('heading',{name:'Welcome to your flow.'})).toBeVisible();
 await expect(page.getByRole('navigation')).toHaveCount(0);
 await expect(page.getByText(/demo/i)).toHaveCount(0);
 await expect(page.getByText(`© ${new Date().getFullYear()} Yoga Studio · v${pkg.version}`)).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('yoga-profile'))).toBeNull();
 expect(await page.evaluate(()=>sessionStorage.getItem('yoga-demo-session'))).toBeNull();
 expect(await page.evaluate(()=>localStorage.getItem('unrelated-project-data'))).toBe('preserve');
 await page.getByLabel('Email address').fill('qa@example.test');
 await page.getByLabel('Password',{exact:true}).fill('valid-test-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('contact the studio owner');
 await expect(page.getByRole('navigation')).toHaveCount(0);
});
