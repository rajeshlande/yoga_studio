import {test,expect} from '@playwright/test';
import {mockAuth,signIn,accessToken} from './auth-fixture';
import pkg from '../package.json' with {type:'json'};

test.beforeEach(async({page})=>{await mockAuth(page)});

test('real session path gates dashboard; profile persists through mocked provider; logout closes access',async({page})=>{
 await page.goto('/#dashboard');
 await expect(page.getByRole('navigation')).toHaveCount(0);
 await expect(page.getByText(/demo/i)).toHaveCount(0);
 await signIn(page);
 await page.getByRole('button',{name:'Profile',exact:true}).click();
 await page.getByLabel('Full name').fill('Updated Member');
 await page.getByLabel('A little about you').fill('Updated profile biography.');
 await page.getByRole('button',{name:'Save changes'}).click();
 await expect(page.getByRole('status')).toContainText('updated');
 await page.reload();
 await expect(page.getByRole('heading',{name:'Welcome back, Updated.'})).toBeVisible();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByLabel('App version')).toHaveText(`v${pkg.version}`);
 await expect(page.getByRole('heading',{name:'Yoga Studio',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Sign out',exact:true}).first().click();
 await expect(page.getByRole('heading',{name:'Welcome to your flow.'})).toBeVisible();
 await page.reload();
 await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('signup validates names; login errors are safe; forgot password calls provider',async({page})=>{
 await page.goto('/');
 await page.getByLabel('Email address').fill('qa@example.test');
 await page.getByLabel('Password',{exact:true}).fill('incorrect-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect. Please try again.');
 await page.getByRole('button',{name:'Create an account',exact:true}).click();
 await page.getByLabel('Full name').fill('   ');
 await page.getByLabel('Email address').fill('qa@example.test');
 await page.getByLabel('Password',{exact:true}).fill('valid-test-password');
 await page.getByRole('button',{name:'Create your account'}).click();
 await expect(page.getByRole('alert')).toHaveText('Please enter your name.');
 await page.getByLabel('Full name').fill('New Member');
 await page.getByRole('button',{name:'Create your account'}).click();
 await expect(page.getByRole('heading',{name:'Your space is almost ready.'})).toBeVisible();
 await page.getByRole('button',{name:'Back to sign in',exact:true}).click();
 await page.getByRole('button',{name:'Forgot password?'}).click();
 await page.getByLabel('Email address').fill('qa@example.test');
 await page.getByRole('button',{name:'Send reset link'}).click();
 await expect(page.getByRole('heading',{name:'Check your inbox.'})).toBeVisible();
 expect(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('valid-test-password')))).toBeFalsy();
});

test('recovery session updates password through provider, with mismatch validation',async({page})=>{
 await page.goto(`/#access_token=${accessToken()}&refresh_token=test-only-refresh-token&expires_in=3600&token_type=bearer&type=recovery`);
 await expect(page.getByRole('heading',{name:'A fresh start for your password.'})).toBeVisible();
 await page.getByLabel('New password',{exact:true}).fill('new-test-password');
 await page.getByLabel('Confirm new password').fill('mismatch-password');
 await page.getByRole('button',{name:'Update password'}).click();
 await expect(page.getByRole('alert')).toContainText('don’t match');
 await page.getByLabel('Confirm new password').fill('new-test-password');
 await page.getByRole('button',{name:'Update password'}).click();
 await expect(page.getByRole('heading',{name:'Welcome back, Test.'})).toBeVisible();
});

test('mobile navigation and installation dialog preserve focus without overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');await signIn(page);
 await page.getByRole('button',{name:'Open menu'}).click();
 await page.getByRole('button',{name:'Profile',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your profile'})).toBeVisible();
 await page.setViewportSize({width:320,height:740});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'Open menu'}).click();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 const install=page.getByRole('button',{name:'Install app'});
 await install.click();
 await expect(page.getByRole('dialog',{name:'Install Yoga Studio'})).toBeVisible();
 const close=page.getByRole('button',{name:'Close installation help'});
 await expect(close).toBeFocused();await page.keyboard.press('Tab');await expect(close).toBeFocused();
 await page.keyboard.press('Escape');await expect(install).toBeFocused();
});
