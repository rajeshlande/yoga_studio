import {test,expect} from '@playwright/test';

test('only authentication is visible before sign-in; signup and forgot password work',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#dashboard');
 await expect(page.getByRole('heading',{name:'Welcome to your flow.'})).toBeVisible();
 await expect(page.getByRole('navigation')).toHaveCount(0);
 await page.getByRole('button',{name:'Create an account',exact:true}).click();
 await expect(page.getByLabel('Full name')).toBeVisible();
 await page.getByLabel('Full name').fill('Maya Patel');
 await page.getByLabel('Email address').fill('maya@example.com');
 await page.getByLabel('Password',{exact:true}).fill('password123');
 await page.getByRole('button',{name:'Create your account'}).click();
 await expect(page.getByRole('alert')).toContainText('No credentials have been saved');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Forgot password?'}).click();
 await expect(page.getByRole('heading',{name:'A little help getting back.'})).toBeVisible();
 await page.getByLabel('Email address').fill('maya@example.com');
 await page.getByRole('button',{name:'Send reset link'}).click();
 await expect(page.getByRole('alert')).toContainText('Supabase public key');
 expect(await page.evaluate(()=>Object.values(localStorage).some(value=>value.includes('password123')))).toBeFalsy();
 expect(errors).toEqual([]);
});

test('demo sign-in gates dashboard, profile saves, settings and sign-out work',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Sign in to demo'}).click();
 await expect(page.getByRole('heading',{name:/Welcome back, Alex/})).toBeVisible();
 await expect(page.getByRole('button',{name:'My classes'})).toHaveCount(0);
 await page.getByRole('button',{name:'Profile',exact:true}).click();
 await page.getByLabel('Full name').fill('Maya Patel');
 await page.getByLabel('A little about you').fill('A mindful new beginning.');
 await page.getByRole('button',{name:'Save changes'}).click();
 await page.reload();
 await expect(page.getByRole('heading',{name:/Welcome back, Maya/})).toBeVisible();
 await page.getByRole('button',{name:'Profile',exact:true}).click();
 await expect(page.getByLabel('Full name')).toHaveValue('Maya Patel');
 await expect(page.getByLabel('A little about you')).toHaveValue('A mindful new beginning.');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your settings'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Reset password'})).toBeDisabled();
 await page.getByRole('button',{name:'Install app'}).click();
 await expect(page.getByRole('dialog',{name:'Install yoga_studio'})).toBeVisible();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Sign out',exact:true}).first().click();
 await expect(page.getByRole('heading',{name:'Welcome to your flow.'})).toBeVisible();
 await page.reload();
 await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('mobile auth and protected pages have no horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await expect(page.getByRole('heading',{name:'Welcome to your flow.'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'Sign in to demo'}).click();
 await expect(page.getByRole('button',{name:'Open menu'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'Open menu'}).click();
 await page.getByRole('button',{name:'Profile',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your profile'})).toBeVisible();
 await page.setViewportSize({width:320,height:740});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'Open menu'}).click();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your settings'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('blank signup names are rejected and installation dialog traps/restores focus',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Create an account',exact:true}).click();
 await page.getByLabel('Full name').fill('   ');
 await page.getByLabel('Email address').fill('qa@example.test');
 await page.getByLabel('Password',{exact:true}).fill('test-password-123');
 await page.getByRole('button',{name:'Create your account'}).click();
 await expect(page.getByRole('alert')).toHaveText('Please enter your name.');
 await page.getByRole('button',{name:'Sign in to demo'}).click();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const install=page.getByRole('button',{name:'Install app'});
 await install.click();
 const close=page.getByRole('button',{name:'Close installation help'});
 await expect(close).toBeFocused();
 await page.keyboard.press('Tab');
 await expect(close).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(install).toBeFocused();
});
