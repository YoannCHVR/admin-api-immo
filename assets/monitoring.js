// Monitoring & Logs — Gestionnaire Hub

(() => {
  const $ = (id) => document.getElementById(id);

  // ── Config ──
  function initConfig() {
    const cfg = loadConfig();
    $('apiUrl').value = cfg.apiUrl || 'http://localhost:8000';
    $('adminToken').value = cfg.adminToken || '';
    $('saveConfig').addEventListener('click', () => {
      saveConfig({
        ...loadConfig(),
        apiUrl: $('apiUrl').value.trim(),
        adminToken: $('adminToken').value.trim(),
      });
      toast('Configuration sauvée', 'success');
      pingHealth();
      loadAll();
    });
  }

  async function pingHealth() {
    const dot = document.querySelector('.mon-health-dot');
    const text = $('healthText');
    try {
      const t0 = performance.now();
      const res = await fetch(getApiUrl() + '/health');
      const ms = Math.round(performance.now() - t0);
      dot.className = res.ok ? 'mon-health-dot ok' : 'mon-health-dot ko';
      text.textContent = res.ok ? `API healthy · ${ms}ms` : 'Erreur';
    } catch {
      dot.className = 'mon-health-dot ko';
      text.textContent = 'Injoignable';
    }
  }

  // ── Tab navigation ──
  function initTabs() {
    document.querySelectorAll('.mon-nav-link[data-tab]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = link.dataset.tab;
        document.querySelectorAll('.mon-nav-link[data-tab]').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        $('tabMonitoring').hidden = tab !== 'monitoring';
        $('tabRaw').hidden = tab !== 'raw';
      });
    });
  }

  // ── Sparkline SVG ──
  function sparklineSvg(values, color) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${94 - ((v - min) / range) * 88}`).join(' ');
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
      <polyline points="0,100 ${pts} 100,100" fill="${color}" opacity="0.1"/>
    </svg>`;
  }

  // ── KPI cards ──
  function renderKpis(sources, schedulerStatus) {
    const totalSources = sources.length;
    const validated = sources.filter(s => s.config_status === 'validated').length;
    const errSources = sources.filter(s => s.config_status === 'rejected').length;
    const running = schedulerStatus.running;

    const kpis = [
      {
        label: 'Sources validées',
        val: `${validated} / ${totalSources}`,
        delta: running ? 'Scheduler actif' : 'Scheduler arrêté',
        deltaGood: running,
        accent: 'var(--success)',
        series: [40, 55, 48, 70, 62, 85, 72, validated / totalSources * 100],
      },
      {
        label: 'Intervalle global',
        val: `${Math.round((schedulerStatus.global_interval_seconds || schedulerStatus.global_interval_minutes * 60 || 600) / 60)} min`,
        delta: schedulerStatus.jobs?.length ? `${schedulerStatus.jobs.length} job(s)` : 'Aucun job',
        deltaGood: true,
        accent: 'var(--ink-0)',
        series: [60, 65, 70, 68, 72, 80, 82, 88],
      },
      {
        label: 'Sources rejetées',
        val: String(errSources),
        delta: errSources === 0 ? 'Tout va bien' : 'À vérifier',
        deltaGood: errSources === 0,
        accent: errSources > 0 ? 'var(--warning)' : 'var(--ink-0)',
        series: [20, 18, 25, 30, 15, 12, 8, errSources],
      },
      {
        label: 'Prochain cycle',
        val: schedulerStatus.jobs?.[0]?.next_run
          ? new Date(schedulerStatus.jobs[0].next_run).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          : '—',
        delta: running ? 'Planifié' : 'Arrêté',
        deltaGood: running,
        accent: 'var(--ink-0)',
        series: [50, 52, 48, 55, 60, 58, 62, 65],
      },
    ];

    $('kpiGrid').innerHTML = kpis.map(k => {
      const sparkColor = k.accent === 'var(--warning)' ? 'var(--warning)' : k.accent === 'var(--success)' ? 'var(--success)' : 'var(--accent-700)';
      return `
        <div class="mon-kpi-card">
          <div class="mon-kpi-label">${escapeHtml(k.label)}</div>
          <div class="mon-kpi-row">
            <div class="mon-kpi-value" style="color:${k.accent}">${escapeHtml(k.val)}</div>
            <div class="mon-kpi-delta ${k.deltaGood ? 'good' : 'neutral'}">${escapeHtml(k.delta)}</div>
          </div>
          <div class="mon-kpi-spark">${sparklineSvg(k.series, sparkColor)}</div>
        </div>
      `;
    }).join('');
  }

  // ── Jobs panel ──
  function renderJobs(schedulerStatus) {
    const jobs = schedulerStatus.jobs || [];
    $('jobsMeta').textContent = jobs.length ? `${jobs.length} job(s) planifié(s)` : 'Aucun job actif';

    if (!jobs.length) {
      $('jobsList').innerHTML = '<div style="padding:20px 14px;color:var(--ink-4);font-size:12px;text-align:center;">Aucun job en cours. Le scheduler est ' + (schedulerStatus.running ? 'actif — prochain cycle bientôt.' : 'arrêté.') + '</div>';
      return;
    }

    $('jobsList').innerHTML = jobs.map(j => `
      <div class="mon-job-row">
        <span class="mon-job-id">${escapeHtml(j.id)}</span>
        <div>
          <div class="mon-job-name">${escapeHtml(j.name)}</div>
        </div>
        <span class="mon-job-stage">—</span>
        <span class="mon-job-eta">${j.next_run ? new Date(j.next_run).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
        <span class="mon-pill mon-pill-ok"><span class="mon-pill-dot"></span>planifié</span>
      </div>
    `).join('');
  }

  // ── Logs panel (simulated from real events) ──
  const MOCK_LOGS = [
    { ts: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), lvl: 'info', src: 'pipeline', msg: 'Monitoring page loaded — données en direct depuis l\'API', code: 'MON_INIT' },
  ];
  let logFilter = 'all';

  function renderLogs() {
    const logs = logFilter === 'all' ? MOCK_LOGS : MOCK_LOGS.filter(l => l.lvl === logFilter);
    $('logStream').innerHTML = logs.length
      ? logs.map(l => `
        <div class="mon-log-line" style="border-left:2px solid ${l.lvl === 'error' ? '#f87a7a' : l.lvl === 'warn' ? '#f0c542' : 'rgba(255,255,255,0.2)'}">
          <span class="mon-log-ts">${escapeHtml(l.ts)}</span>
          <span class="mon-log-lvl mon-log-lvl-${l.lvl}">${l.lvl}</span>
          <span class="mon-log-msg"><span class="mon-log-src">[${escapeHtml(l.src)}]</span> ${escapeHtml(l.msg)} <span class="mon-log-code">·${escapeHtml(l.code)}</span></span>
        </div>
      `).join('')
      : '<div style="padding:20px 14px;color:rgba(255,255,255,0.4);font-size:11px;text-align:center;">Aucun log pour ce filtre.</div>';
  }

  function addLog(lvl, src, msg, code) {
    MOCK_LOGS.unshift({
      ts: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      lvl, src, msg, code,
    });
    if (MOCK_LOGS.length > 50) MOCK_LOGS.pop();
    renderLogs();
  }

  function initLogFilters() {
    $('logFilters').addEventListener('click', (e) => {
      const btn = e.target.closest('.mon-log-btn');
      if (!btn) return;
      logFilter = btn.dataset.lvl;
      document.querySelectorAll('.mon-log-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderLogs();
    });
  }

  // ── Source health table ──
  function renderSourceHealth(sources) {
    const TIER_COLORS = { 1: 'var(--tier-1)', 2: 'var(--tier-2)', 3: 'var(--tier-3)', 4: 'var(--tier-4)' };
    const tierNum = (cls) => {
      const t = cls?.tier || cls?.TIER || 0;
      return t;
    };

    $('sourceHealthRows').innerHTML = sources.map(s => {
      const tier = s.tier || 0;
      const tierColor = TIER_COLORS[tier] || 'var(--ink-4)';
      const status = s.config_status || 'no_config';
      const method = s.scraping_method || 'html';
      const methodLabel = { api: 'API', html: 'HTML', html_json: 'HTML/JSON', js_rendering: 'JS Rendering' }[method] || method;
      const validatedAt = s.validated_at ? new Date(s.validated_at).toLocaleString('fr-FR') : '—';

      let pillClass = 'mon-pill-info';
      let pillLabel = status;
      if (status === 'validated') { pillClass = 'mon-pill-ok'; pillLabel = 'validé'; }
      else if (status === 'rejected') { pillClass = 'mon-pill-err'; pillLabel = 'rejeté'; }
      else if (status === 'pending_review') { pillClass = 'mon-pill-warn'; pillLabel = 'en attente'; }

      return `
        <div class="mon-health-row">
          <span class="mon-health-source">${escapeHtml(s.name)}</span>
          <span>${tier ? `<span class="mon-health-tier" style="background:${tierColor}">T${tier}</span>` : '<span style="color:var(--ink-4)">—</span>'}</span>
          <span class="mon-health-mono">${escapeHtml(methodLabel)}</span>
          <span class="mon-health-mono">${status === 'validated' ? '✓' : '—'}</span>
          <span class="mon-health-muted">${validatedAt}</span>
          <span class="mon-pill ${pillClass}"><span class="mon-pill-dot"></span>${pillLabel}</span>
        </div>
      `;
    }).join('');
  }

  // ── Load all data ──
  async function loadAll() {
    if (!getAdminToken()) {
      $('kpiGrid').innerHTML = '';
      $('jobsList').innerHTML = '<div class="mon-empty">Configure le token admin.</div>';
      return;
    }
    try {
      const [sourcesData, statusData] = await Promise.all([
        fetchAdmin('/scrapers/sources'),
        fetchAdmin('/scrapers/scheduler/status'),
      ]);
      const sources = sourcesData.sources || [];
      renderKpis(sources, statusData);
      renderJobs(statusData);
      renderSourceHealth(sources);
      addLog('info', 'monitoring', `Données chargées — ${sources.length} sources`, 'DATA_OK');
    } catch (e) {
      addLog('error', 'monitoring', `Erreur chargement : ${e.message}`, 'LOAD_ERR');
      toast(e.message, 'error');
    }
  }

  // ── Refresh ──
  $('refreshBtn').addEventListener('click', () => {
    addLog('info', 'monitoring', 'Refresh manuel déclenché', 'REFRESH');
    pingHealth();
    loadAll();
  });

  // ── Init ──
  initConfig();
  initTabs();
  initLogFilters();
  renderLogs();
  pingHealth();
  loadAll();

  // Auto-refresh every 60s
  setInterval(() => {
    if (!document.hidden) {
      pingHealth();
      loadAll();
    }
  }, 60_000);
})();
