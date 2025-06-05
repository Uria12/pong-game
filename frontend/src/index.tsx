import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

// StrictMode is disabled to prevent double mounting in development
// which causes socket connection issues and connection loops
root.render(
  <App />
);

// Note: If you need StrictMode for other development benefits,
// you can enable it but expect connection issues in development mode