// ─── barba-init.js — Transições de página e inicialização compartilhada ─────────
//
// Este arquivo é carregado no <head> de AMBAS as páginas (login.html e dashboard.html).
// Ele define as transições barba.js e a função bindLoginForm().

/* ── Bind do formulário de login ─────────────────────────────────────────────── */

window.bindLoginForm = function bindLoginForm() {
  const form = document.getElementById('loginForm');
  if (!form || form._barbaReady) return;
  form._barbaReady = true;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('passwordInput').value;
    const errEl    = document.getElementById('loginError');
    const btn      = form.querySelector('.login-btn');

    errEl.textContent = '';
    if (btn) { btn.disabled = true; btn.textContent = 'AUTENTICANDO...'; }

    try {
      const res  = await fetch('/api/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      });
      const data = await res.json();

      if (data.ok) {
        localStorage.setItem('dash_token', data.token ?? '');
        document.cookie = `dash_token=${encodeURIComponent(data.token ?? '')}; path=/; SameSite=Strict`;
        if (window.barba) {
          barba.go('/');
        } else {
          location.href = '/';
        }
      } else {
        errEl.textContent = '» SENHA INCORRETA';
        if (btn) { btn.disabled = false; btn.textContent = 'ENTRAR ↩'; }
      }
    } catch {
      errEl.textContent = '» ERRO DE CONEXÃO';
      if (btn) { btn.disabled = false; btn.textContent = 'ENTRAR ↩'; }
    }
  });
};

/* ── barba.js — Transições ────────────────────────────────────────────────────── */

(function initBarba() {
  if (!window.barba || window._barbaInitialized) return;
  window._barbaInitialized = true;

  barba.init({
    // Impede barba de interceptar links externos ou de âncora
    prevent: ({ el }) => el.hash?.length > 0,

    transitions: [{
      name: 'terminal-fade',

      leave({ current }) {
        return new Promise(resolve => {
          const el = current.container;
          el.style.transition  = 'opacity 0.2s ease, transform 0.2s ease';
          el.style.opacity     = '0';
          el.style.transform   = 'translateY(-7px) scale(0.995)';
          setTimeout(resolve, 210);
        });
      },

      enter({ next }) {
        return new Promise(resolve => {
          const el = next.container;
          // Estado inicial (antes da animação)
          el.style.transition  = 'none';
          el.style.opacity     = '0';
          el.style.transform   = 'translateY(10px) scale(1.005)';

          // Força reflow e aplica a transição no próximo frame
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              el.style.transition  = 'opacity 0.28s ease, transform 0.28s ease';
              el.style.opacity     = '1';
              el.style.transform   = 'translateY(0) scale(1)';
              setTimeout(resolve, 300);
            });
          });
        });
      },
    }],

    views: [
      {
        namespace: 'login',
        afterEnter() { window.bindLoginForm?.(); },
      },
      {
        namespace: 'dashboard',
        afterEnter() { window.initDashboard?.(); },
      },
    ],
  });
}());
