import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '#App.tsx';
import { browserEnv } from '#lib/env.ts';
import { applyTheme, loadTheme } from '#lib/theme.ts';
import './fonts.css';
import './styles.css';

// Antes do primeiro render: evita o flash do tema errado.
applyTheme(loadTheme());

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App env={browserEnv()} />
    </StrictMode>,
  );
}
