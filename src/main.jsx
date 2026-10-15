import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './style.css';
// Delete obsolete local sample state without touching Supabase sessions or unrelated site data.
try {
  for(const key of ['yoga-profile','ys-profile','ys-tasks','ys-prefs']) localStorage.removeItem(key);
  sessionStorage.removeItem('yoga-demo-session');
} catch { /* Browsers may restrict storage. Authentication still determines access. */ }
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {scope:import.meta.env.BASE_URL,updateViaCache:'none'}).catch(() => { /* Online use remains available if offline setup fails. */ }));
