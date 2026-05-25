// Base d'agences — construction & enrichissement
// Lance les jobs /admin/agencies/discover, suit via /admin/agencies/jobs[/{id}].
// Contrat partagé avec le backend (DiscoveryJob).

(() => {
  const $ = (id) => document.getElementById(id);

  let jobs = [];
  let statsCache = null;
  let busy = false;
  let pollTimer = null;
  let pollingJobId = null;

  // Compteurs suivis dans les deltas before→after
  const COUNT_KEYS = [
    ['brands', 'Marques'],
    ['business_places', 'Établissements'],
    ['with_siret', 'Avec SIRET'],
    ['with_naf', 'Avec NAF'],
  ];

  const STATUS_LABEL = {
    pending: ['En attente', 'sc-pill-warn'],
    running: ['En cours', 'sc-pill-progress'],
    done: ['Terminé', 'sc-pill-ok'],
    failed: ['Échec', 'sc-pill-err'],
  };

  // ── Config / health ──

  function initConfig() {
    const cfg = loadConfig();
    $('apiUrl').value = cfg.apiUrl || 'http://localhost:8000';
    $('adminToken').value = cfg.adminToken || '';
    $('saveConfig').addEventListener('click', () => {
      saveConfig({ ...loadConfig(), apiUrl: $('apiUrl').value.trim(), adminToken: $('adminToken').value.trim() });
      toast('Config sauvée', 'success');
      pingHealth();
      loadAll();
    });
  }

  async function pingHealth() {
    const dot = $('healthDot'), text = $('healthText');
    try {
      const t0 = performance.now();
      const res = await fetch(getApiUrl() + '/health');
      const ms = Math.round(performance.now() - t0);
      dot.className = res.ok ? 'sc-health-dot ok' : 'sc-health-dot ko';
      text.textContent = res.ok ? `${ms}ms` : 'Err';
    } catch { dot.className = 'sc-health-dot ko'; text.textContent = '—'; }
  }

  // ── Chargement ──

  async function loadAll() {
    if (!getAdminToken()) {
      $('jobsContainer').innerHTML = '<div class="sc-empty">Configure le token admin.</div>';
      $('snapshot').innerHTML = '';
      return;
    }
    await Promise.all([loadStats(), loadJobs()]);
  }

  async function loadStats() {
    try { statsCache = await fetchAdmin('/admin/agencies/stats'); }
    catch { statsCache = null; }
    renderSnapshot();
  }

  async function loadJobs() {
    try {
      const data = await fetchAdmin('/admin/agencies/jobs?limit=20');
      jobs = data.items || [];
    } catch (e) {
      $('jobsContainer').innerHTML = `<div class="sc-empty" style="color:var(--danger)">${escapeHtml(e.message)}</div>`;
      return;
    }
    renderJobs();
    renderSnapshot();

    // Détecte un job actif (un seul possible côté backend) → reprend le suivi.
    const active = jobs.find(j => j.status === 'pending' || j.status === 'running');
    if (active) {
      setBusy(true);
      if (pollingJobId !== active.id) startPolling(active.id);
    } else {
      setBusy(false);
      stopPolling();
    }
  }

  // ── Snapshot (état courant) ──

  function renderSnapshot() {
    // Compteurs détaillés depuis le job le plus récent qui en porte (after sinon before).
    const jc = jobs.map(j => j.counts_after || j.counts_before).find(Boolean) || {};
    const total = statsCache ? statsCache.total : (jc.brands ?? null);
    const cells = [
      ['Marques', total],
      ['Établissements', jc.business_places ?? null],
      ['Avec SIRET', jc.with_siret ?? null],
      ['Avec NAF', jc.with_naf ?? null],
      ['Avec site', statsCache ? statsCache.with_website : null],
    ];
    const stat = cells.map(([label, val]) =>
      `<div class="ab-stat"><div class="ab-stat-label">${label}</div><div class="ab-stat-val">${val != null ? Number(val).toLocaleString('fr-FR') : '—'}</div></div>`
    ).join('');
    const cci = statsCache && statsCache.last_cci_import
      ? `<div class="ab-stat-meta">Dernier import CCI : ${relTime(statsCache.last_cci_import)}</div>` : '';
    $('snapshot').innerHTML = `<div class="ab-stat-grid">${stat}</div>${cci}`;
  }

  // ── Lancement d'un job ──

  function payloadFor(jobKey) {
    switch (jobKey) {
      case 'cci': return { sources: ['cci'] };
      case 'fnaim': return { sources: ['fnaim'] };
      case 'snpi': return { sources: ['snpi'] };
      case 'sirene': return { sources: ['sirene'], confirm_destructive: true };
      case 'pipeline': {
        const dept = $('deptInput').value.trim();
        if (!dept) { toast('Renseigne un département (ex: 37)', 'warn'); return null; }
        return { pipeline: true, dept_code: dept };
      }
      default: return null;
    }
  }

  async function launch(jobKey) {
    if (busy) { toast('Un job est déjà en cours', 'warn'); return; }
    const body = payloadFor(jobKey);
    if (!body) return;
    try {
      const res = await fetchAdmin('/admin/agencies/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast(`Job #${res.job_id} lancé (${res.job_type})`, 'success');
      setBusy(true);
      await loadJobs();   // récupère le nouveau job et démarre le polling
    } catch (e) {
      const m = e.message || '';
      if (m.startsWith('409')) { toast('Un job est déjà en cours — réessaie une fois terminé.', 'warn'); loadJobs(); }
      else if (m.startsWith('401') || m.startsWith('403')) { toast('Non autorisé — token admin manquant/invalide', 'error'); }
      else if (m.startsWith('400')) { toast(detailOf(m) || 'Requête invalide', 'error'); }
      else { toast('Erreur : ' + m, 'error'); }
    }
  }

  // ── Polling du job actif ──

  function startPolling(jobId) {
    stopPolling();
    pollingJobId = jobId;
    pollOnce();
  }

  function stopPolling() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    pollingJobId = null;
  }

  async function pollOnce() {
    const id = pollingJobId;
    if (id == null) return;
    let job = null;
    try { job = await fetchAdmin(`/admin/agencies/jobs/${id}`); }
    catch { /* transitoire : on retentera */ }

    if (job) {
      renderLive(job);
      if (job.status === 'done' || job.status === 'failed') {
        const label = job.status === 'done' ? '✅' : '❌';
        toast(`${label} Job #${job.id} (${job.job_type}) — ${STATUS_LABEL[job.status][0].toLowerCase()}`, job.status === 'done' ? 'success' : 'error');
        stopPolling();
        await loadStats();
        await loadJobs();   // rafraîchit l'historique + réactive les boutons
        return;
      }
    }
    pollTimer = setTimeout(pollOnce, 2500);
  }

  // ── Rendu : panneau live ──

  function renderLive(job) {
    const panel = $('liveJob');
    panel.hidden = false;
    const [label, cls] = STATUS_LABEL[job.status] || ['?', 'sc-pill-none'];
    const running = job.status === 'running' || job.status === 'pending';
    const head = `
      <div class="ab-live-head">
        ${running ? '<span class="ab-spinner"></span>' : ''}
        <span class="ab-live-type">${escapeHtml(job.job_type)}</span>
        <span class="sc-pill ${cls}">${label}</span>
        <span class="ab-live-time">${jobTiming(job)}</span>
      </div>`;

    let bodyHtml = '';
    if (running) {
      bodyHtml = `<div class="ab-live-msg">Job #${job.id} en cours… suivi automatique toutes les 2,5 s.</div>`;
    } else if (job.status === 'done') {
      bodyHtml = `<div class="ab-delta-row">${deltaCells(job.counts_before, job.counts_after)}</div>${resultBlock(job.result)}`;
    } else if (job.status === 'failed') {
      bodyHtml = `
        <div class="ab-live-fail">❌ Échec du job #${job.id}.</div>
        <div class="ab-delta-row">${deltaCells(job.counts_before, job.counts_after)}</div>
        ${job.error ? `<pre class="ab-error-pre ab-error-inline">${escapeHtml(String(job.error).slice(-1500))}</pre>` : ''}`;
    }
    panel.innerHTML = `<div class="ab-live-card ab-live-${job.status}">${head}${bodyHtml}</div>`;
  }

  // ── Rendu : historique ──

  function renderJobs() {
    if (!jobs.length) { $('jobsContainer').innerHTML = '<div class="sc-empty">Aucun job pour le moment.</div>'; return; }
    $('jobsContainer').innerHTML = jobs.map(j => {
      const [label, cls] = STATUS_LABEL[j.status] || ['?', 'sc-pill-none'];
      const errBtn = j.status === 'failed'
        ? `<button class="sc-btn sc-btn-sm sc-btn-ghost" data-error-job="${j.id}">Voir l'erreur</button>` : '';
      const delta = (j.counts_before && j.counts_after)
        ? `<div class="ab-delta-row ab-delta-row-sm">${deltaCells(j.counts_before, j.counts_after)}</div>`
        : '<span class="ab-delta-na">—</span>';
      return `
        <div class="ab-job-row ab-job-${j.status}">
          <span class="ab-job-type">${escapeHtml(j.job_type)}</span>
          <span class="sc-pill ${cls}">${label}</span>
          <span class="ab-job-time">${jobTiming(j)}</span>
          <span class="ab-job-delta">${delta}</span>
          <span class="ab-job-actions">${errBtn}</span>
        </div>`;
    }).join('');
  }

  // ── Helpers de rendu ──

  function deltaCells(before, after) {
    if (!before || !after) return '<span class="ab-delta-na">compteurs indisponibles</span>';
    return COUNT_KEYS.map(([k, label]) => {
      const b = before[k] ?? 0, a = after[k] ?? 0, d = a - b;
      const sign = d > 0 ? `+${d.toLocaleString('fr-FR')}` : d.toLocaleString('fr-FR');
      const cls = d > 0 ? 'ab-up' : (d < 0 ? 'ab-down' : 'ab-zero');
      return `<span class="ab-delta">
        <span class="ab-delta-label">${label}</span>
        <span class="ab-delta-val ${cls}">${sign}</span>
        <span class="ab-delta-tot">→ ${a.toLocaleString('fr-FR')}</span>
      </span>`;
    }).join('');
  }

  function resultBlock(result) {
    if (result == null) return '';
    return `<details class="ab-result"><summary>Résultat détaillé</summary><pre class="ab-error-pre">${escapeHtml(JSON.stringify(result, null, 2))}</pre></details>`;
  }

  function jobTiming(j) {
    if (j.status === 'pending') return `créé ${relTime(j.created_at)}`;
    if (j.status === 'running') return `démarré ${relTime(j.started_at || j.created_at)}`;
    if (j.finished_at) {
      const dur = (j.started_at && j.finished_at)
        ? Math.round((new Date(j.finished_at) - new Date(j.started_at)) / 1000) : null;
      return `fini ${relTime(j.finished_at)}${dur != null ? ` · ${fmtDur(dur)}` : ''}`;
    }
    return relTime(j.created_at);
  }

  function fmtDur(s) {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), r = s % 60;
    return `${m}min${r ? ` ${r}s` : ''}`;
  }

  function relTime(iso) {
    if (!iso) return '—';
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 0 || d < 60) return 'à l\'instant';
    if (d < 3600) return `il y a ${Math.floor(d / 60)}min`;
    if (d < 86400) return `il y a ${Math.floor(d / 3600)}h`;
    return `il y a ${Math.floor(d / 86400)}j`;
  }

  function detailOf(m) {
    const i = m.indexOf('—');
    const rest = i >= 0 ? m.slice(i + 1).trim() : m;
    try { return JSON.parse(rest).detail || rest; } catch { return rest; }
  }

  // ── État busy (boutons désactivés pendant un job) ──

  function setBusy(b) {
    busy = b;
    document.querySelectorAll('[data-action-btn]').forEach(el => { el.disabled = b; });
    $('deptInput').disabled = b;
  }

  // ── Modal destructif ──

  function openConfirm() { $('confirmModal').hidden = false; }
  function closeConfirm() { $('confirmModal').hidden = true; }

  // ── Modal erreur ──

  async function showError(jobId) {
    $('errorJobId').textContent = `#${jobId}`;
    $('errorBody').textContent = 'Chargement…';
    $('errorModal').hidden = false;
    try {
      const job = await fetchAdmin(`/admin/agencies/jobs/${jobId}`);
      $('errorBody').textContent = job.error || '(aucun détail d\'erreur)';
    } catch (e) {
      $('errorBody').textContent = e.message;
    }
  }

  // ── Wiring ──

  document.querySelectorAll('[data-action-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const job = btn.dataset.job;
      if (job === 'sirene') openConfirm();   // action destructive → confirmation obligatoire
      else launch(job);
    });
  });

  $('confirmCancel').addEventListener('click', closeConfirm);
  $('confirmRun').addEventListener('click', () => { closeConfirm(); launch('sirene'); });
  $('errorClose').addEventListener('click', () => { $('errorModal').hidden = true; });
  $('refreshBtn').addEventListener('click', loadAll);

  $('jobsContainer').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-error-job]');
    if (btn) showError(btn.dataset.errorJob);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('confirmModal').hidden) closeConfirm();
    if (!$('errorModal').hidden) $('errorModal').hidden = true;
  });

  // ── Boot ──
  initConfig();
  pingHealth();
  loadAll();
})();
