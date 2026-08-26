import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx?v=3';
import './index.css?v=3';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
