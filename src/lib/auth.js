import {createClient} from '@supabase/supabase-js';
import {isProjectUrl,isPublicKey} from './public-config.mjs';

const projectUrl=import.meta.env.VITE_SUPABASE_URL;
const publicKey=import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase=isProjectUrl(projectUrl)&&isPublicKey(publicKey)?createClient(projectUrl,publicKey):null;
// Keep email confirmation and recovery callbacks inside the Pages repository path.
export const authRedirectUrl=new URL(import.meta.env.BASE_URL,window.location.origin).href;

export function authMessage(error){
  const code=error?.code;
  if(code==='invalid_credentials') return 'Email or password is incorrect. Please try again.';
  if(code==='email_not_confirmed') return 'Please confirm your email before signing in.';
  if(code==='weak_password') return 'Choose a stronger password and try again.';
  if(code==='over_request_rate_limit'||code==='over_email_send_rate_limit'||error?.status===429) return 'Too many attempts. Please wait a moment and try again.';
  if(code==='otp_expired'||code==='bad_code_verifier'||code==='flow_state_expired') return 'This link has expired or is invalid. Please request a new password reset link.';
  if(code==='same_password') return 'Choose a password different from your current password.';
  if(error instanceof TypeError||!navigator.onLine) return 'You appear to be offline. Check your connection and try again.';
  return 'We couldn’t complete that request. Please try again. If it continues, contact the studio owner.';
}
