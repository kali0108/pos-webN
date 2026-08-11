import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { startSyncEngine } from './lib/syncEngine';
import './index.css';

// autoUpdate + this call = every branch gets a new deploy within one
// periodic check (below) with no install step, no IT visit, no
// manual refresh instructions to give staff.
const updateSW = registerSW({
  onRegisteredSW(_url, registration) {
    if (registration) {
      setInterval(() => registration.update(), 60 * 60 * 1000); // hourly check
    }
  },
});
void updateSW;

startSyncEngine();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
