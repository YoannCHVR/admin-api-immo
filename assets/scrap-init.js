// SCRAP INIT — launch + live tracking

(() => {
  const $ = (id) => document.getElementById(id);
  let pollTimer = null;
  let validatedSources = [];

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
      loadSources();
    });
  }

  async function pingHealth() {
    const dot = $('healthDot');
    const text = $('healthText');
    try {
      const t0 = performance.now();
      const res = await fetch(getApiUrl() + '/health');
      const ms = Math.round(performance.now() - t0);
      dot.className = res.ok ? 'mon-health-dot ok' : 'mon-health-dot ko';
      text.textContent = res.ok ? `${ms}ms` : 'Erreur';
    } catch {
      dot.className = 'mon-health-dot ko';
      text.textContent = 'Injoignable';
    }
  }

  // ── Load validated sources for checkboxes ──

  async function loadSources() {
    if (!getAdminToken()) return;
    try {
      const data = await fetchAdmin('/scrapers/sources');
      validatedSources = (data.sources || []).filter(s => s.config_status === 'validated').sort((a, b) => a.name.localeCompare(b.name));
      renderSourceCheckboxes();
    } catch { /* silent */ }
  }

  function renderSourceCheckboxes() {
    const container = $('sourcesCheckboxes');
    if (!validatedSources.length) {
      container.innerHTML = '<span style="color:var(--ink-4);font-size:12px">Aucune source validée</span>';
      return;
    }
    container.innerHTML = validatedSources.map(s =>
      `<label class="si-check-label"><input type="checkbox" value="${escapeHtml(s.name)}" class="si-source-check"> ${escapeHtml(s.name)}</label>`
    ).join('');
  }

  function getSelectedSources() {
    const checked = [...document.querySelectorAll('.si-source-check:checked')].map(c => c.value);
    return checked.length ? checked.join(',') : null;
  }

  // ── Launch ──

  async function launchInit() {
    const dept = $('initDept').value.trim();
    if (!dept) { toast('Département requis', 'warn'); return; }

    const sources = getSelectedSources();
    const propertyTypes = $('initPropertyTypes').value;

    $('launchBtn').disabled = true;
    $('launchBtn').textContent = 'Lancement…';

    try {
      const qs = new URLSearchParams({ department: dept, property_types: propertyTypes });
      if (sources) qs.set('sources', sources);

      const data = await fetchAdmin(`/scrapers/init?${qs}`, { method: 'POST' });

      $('launchResult').hidden = false;
      $('launchResult').innerHTML =
        `<div class="si-result-ok">` +
        `<strong>SCRAP INIT lancé</strong> — dept ${escapeHtml(dept)}<br>` +
        `Sources validées : ${(data.validated_sources || []).join(', ')}<br>` +
        (data.pending_review?.length ? `<span style="color:var(--warning)">En attente : ${data.pending_review.join(', ')}</span><br>` : '') +
        (data.no_config?.length ? `<span style="color:var(--ink-4)">Sans config : ${data.no_config.join(', ')}</span><br>` : '') +
        `</div>`;

      toast(`SCRAP INIT lancé pour dept ${dept}`, 'success');

      // Auto-fill status dept + start polling
      $('statusDept').value = dept;
      startPolling();

    } catch (e) {
      $('launchResult').hidden = false;
      $('launchResult').innerHTML = `<div class="si-result-err">Erreur : ${escapeHtml(e.message)}</div>`;
      toast(e.message, 'error');
    } finally {
      $('launchBtn').disabled = false;
      $('launchBtn').textContent = 'Lancer SCRAP INIT';
    }
  }

  // ── Status polling ──

  async function loadStatus() {
    if (!getAdminToken()) return;
    const dept = $('statusDept').value.trim();
    try {
      const qs = dept ? `?department=${encodeURIComponent(dept)}` : '';
      const data = await fetchAdmin(`/scrapers/init/status${qs}`);
      renderKpis(data);
      renderProgressBar(data);
      renderSegments(data);
    } catch (e) {
      $('segmentsContainer').innerHTML = `<div class="mon-empty" style="color:var(--danger)">Erreur : ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderKpis(data) {
    const bs = data.by_status || {};
    const kpis = [
      { label: 'Total', value: data.total || 0, color: 'var(--ink-0)' },
      { label: 'Done', value: bs.done || 0, color: 'var(--success)' },
      { label: 'In progress', value: bs.in_progress || 0, color: 'var(--accent-700)' },
      { label: 'Pending', value: bs.pending || 0, color: 'var(--warning)' },
      { label: 'Failed', value: bs.failed || 0, color: 'var(--danger)' },
    ];
    $('kpiStrip').innerHTML = kpis.map(k =>
      `<div class="si-kpi"><div class="si-kpi-value" style="color:${k.color}">${k.value}</div><div class="si-kpi-label">${k.label}</div></div>`
    ).join('');
  }

  function renderProgressBar(data) {
    const total = data.total || 0;
    const done = (data.by_status?.done || 0) + (data.by_status?.failed || 0);
    if (total === 0) { $('globalBar').hidden = true; return; }
    $('globalBar').hidden = false;
    const pct = Math.round((done / total) * 100);
    $('barFill').style.width = `${pct}%`;
    $('barLabel').textContent = `${done} / ${total} segments terminés (${pct}%)`;

    // Stop auto-polling if all done
    if (done >= total && $('autoRefresh').checked) {
      toast('SCRAP INIT terminé !', 'success');
    }
  }

  function renderSegments(data) {
    const segments = data.segments || [];
    if (!segments.length) {
      $('segmentsContainer').innerHTML = '<div class="mon-empty">Aucun segment pour ce département.</div>';
      return;
    }

    const rows = segments.map(s => {
      const statusClass = {
        done: 'mon-pill-ok', in_progress: 'si-pill-progress',
        pending: 'mon-pill-warn', failed: 'mon-pill-err',
      }[s.status] || 'mon-pill-info';
      const statusLabel = {
        done: 'done', in_progress: 'en cours',
        pending: 'attente', failed: 'échec',
      }[s.status] || s.status;
      const lastRun = s.last_run ? new Date(s.last_run).toLocaleString('fr-FR') : '—';

      return `
        <div class="si-seg-row">
          <span class="si-seg-source">${escapeHtml(s.source)}</span>
          <span class="si-seg-dept">${escapeHtml(s.department)}</span>
          <span class="mon-pill ${statusClass}"><span class="mon-pill-dot"></span>${statusLabel}</span>
          <span class="si-seg-ads">${s.ads_found}</span>
          <span class="si-seg-time">${lastRun}</span>
        </div>
      `;
    }).join('');

    $('segmentsContainer').innerHTML = `
      <div class="si-seg-header">
        <span>Source</span><span>Dept</span><span>Statut</span><span>Annonces</span><span>Dernier run</span>
      </div>
      ${rows}
    `;
  }

  // ── Polling control ──

  function startPolling() {
    stopPolling();
    loadStatus();
    if ($('autoRefresh').checked) {
      pollTimer = setInterval(() => {
        if (!document.hidden) loadStatus();
      }, 5000);
    }
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  $('autoRefresh').addEventListener('change', () => {
    if ($('autoRefresh').checked) startPolling();
    else stopPolling();
  });

  // ── Wire ──

  $('launchBtn').addEventListener('click', launchInit);
  $('refreshStatusBtn').addEventListener('click', loadStatus);
  $('statusDept').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadStatus(); });

  // ── Init ──

  initConfig();
  pingHealth();
  loadSources();
  loadStatus();
  if ($('autoRefresh').checked) startPolling();
})();
