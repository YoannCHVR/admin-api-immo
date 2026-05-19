// Gestionnaire Real Estate — helpers communs (config, env, fetch admin, toast)

const STORAGE_KEY = 'gre_config';

// ── Environment presets ──

const ENV_PRESETS = {
  dev: {
    label: 'DEV',
    apiUrl: 'http://localhost:8000',
    outilUrl: 'http://localhost:3005',
  },
  prod: {
    label: 'PROD',
    apiUrl: 'https://api.apimmo.fr',
    outilUrl: 'https://app.apimmo.fr',
  },
};

function getEnv() {
  return loadConfig().env || 'dev';
}

function setEnv(env) {
  const preset = ENV_PRESETS[env];
  if (!preset) return;
  const cfg = loadConfig();
  cfg.env = env;
  cfg.apiUrl = preset.apiUrl;
  cfg.outilUrl = preset.outilUrl;
  // Keep adminToken across env switches
  saveConfig(cfg);
}

function getEnvPresets() {
  return ENV_PRESETS;
}

// ── Config ──

function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

function getApiUrl() {
  const cfg = loadConfig();
  const url = (cfg.apiUrl || ENV_PRESETS[cfg.env || 'dev'].apiUrl).trim();
  return url.replace(/\/+$/, '');
}

function getAdminToken() {
  return (loadConfig().adminToken || '').trim();
}

// ── Fetch ──

async function fetchAdmin(path, opts = {}) {
  const token = getAdminToken();
  if (!token) {
    throw new Error('Token admin manquant — renseigne-le dans la barre de config');
  }
  const res = await fetch(getApiUrl() + path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      'X-Admin-Token': token,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Toast ──

function toast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// ── Utils ──

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
