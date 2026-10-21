import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { Overlay } from './ui/overlay/Overlay';
import './ui/styles.css';

const isOverlay = new URLSearchParams(window.location.search).has('overlay');
if (isOverlay) document.body.classList.add('overlay-body');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isOverlay ? <Overlay /> : <App />}
  </React.StrictMode>,
);
