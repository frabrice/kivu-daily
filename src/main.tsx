import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import DebugOs from './DebugOs'; // DEBUG TEMP

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {sessionStorage.getItem('debugos') ? <DebugOs /> : <App />}{/* DEBUG TEMP */}
  </StrictMode>
);
