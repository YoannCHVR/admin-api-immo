// Couverture filtres × scrapers
//  - Référence (Miro) : matrice curée extrait/dispo/nok + méthode d'acquisition (GET /scrapers/coverage)
//  - Réel (base)      : taux de couverture calculé depuis canonical_ads, actualisable (GET /scrapers/coverage/live)

(() => {
  const $ = (id) => document.getElementById(id);

  let data = null;        // matrice curée
  let live = null;        // évaluation réelle
  let mode = 'ref';       // 'ref' | 'live'
  let state = '';         // filtre état (mode ref) : '' | extrait | dispo | nok

  const METHOD = {
    field:       ['F', 'Champ dédié'],
    description: ['D', 'Parsé depuis la description'],
    image:       ['I', 'Depuis image / OCR'],
    computed:    ['C', 'Calculé / dérivé'],
    na:          ['',  'Non disponible'],
    unknown:     ['?', 'À renseigner'],
  };
  const STATUS_LABEL = { extrait: 'Extrait', dispo: 'Disponible (non extrait)', nok: 'Non disponible', unknown: 'Indéterminé (page non récupérable)' };

  // ── Config / health ──

  function initConfig() {
    const cfg = loadConfig();
    $('apiUrl').value = cfg.apiUrl || 'http://localhost:8000';
    $('adminToken').value = cfg.adminToken || '';
    $('saveConfig').addEventListener('click', () => {
      saveConfig({ ...loadConfig(), apiUrl: $('apiUrl').value.trim(), adminToken: $('adminToken').value.trim() });
      toast('Config sauvée', 'success');
      pingHealth();
      load();
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

  async function load() {
    if (!getAdminToken()) { $('matrix').innerHTML = '<div class="sc-empty">Configure le token admin.</div>'; return; }
    $('matrix').innerHTML = '<div class="sc-empty">Chargement…</div>';
    try {
      data = await fetchAdmin('/scrapers/coverage');
      populateSourceFilter();
      renderOverall();
      renderLegend();
      if (mode === 'live') { await loadLive(); } else { renderMatrix(); }
    } catch (e) {
      $('matrix').innerHTML = `<div class="sc-empty" style="color:var(--danger)">${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadLive() {
    $('matrix').innerHTML = '<div class="sc-empty">Calcul depuis la base…</div>';
    try {
      live = await fetchAdmin('/scrapers/coverage/live');
      $('liveMeta').textContent = `Réel calculé ${relTime(live.generated_at)} · seuil n ≥ ${live.min_sample}`;
      renderLegend();
      renderMatrix();
    } catch (e) {
      $('matrix').innerHTML = `<div class="sc-empty" style="color:var(--danger)">${escapeHtml(e.message)}</div>`;
    }
  }

  function populateSourceFilter() {
    const sel = $('fSource');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Toutes sources</option>' +
      data.scrapers.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    sel.value = cur;
  }

  // ── Totaux & légende ──

  function bar(t) {
    const u = t.unknown || 0;
    const total = (t.extrait + t.dispo + t.nok + u) || 1;
    const pct = n => (100 * n / total).toFixed(1);
    return `<span class="cov-bar" title="Extrait ${t.extrait} · Dispo ${t.dispo} · NOK ${t.nok} · Indét. ${u}">
      <span class="cov-bar-seg cov-bg-extrait" style="width:${pct(t.extrait)}%"></span>
      <span class="cov-bar-seg cov-bg-dispo" style="width:${pct(t.dispo)}%"></span>
      <span class="cov-bar-seg cov-bg-nok" style="width:${pct(t.nok)}%"></span>
      <span class="cov-bar-seg cov-bg-unknown" style="width:${pct(u)}%"></span>
    </span>`;
  }

  function renderOverall() {
    const t = data.totals.overall;
    const u = t.unknown || 0;
    const total = t.extrait + t.dispo + t.nok + u;
    $('covOverall').innerHTML = `
      <div class="cov-overall-nums">
        <span class="cov-chip cov-bg-extrait">${t.extrait} extrait</span>
        <span class="cov-chip cov-bg-dispo">${t.dispo} dispo</span>
        <span class="cov-chip cov-bg-nok">${t.nok} nok</span>
        ${u ? `<span class="cov-chip cov-bg-unknown">${u} indét.</span>` : ''}
        <span class="cov-overall-tot">/ ${total} cellules</span>
      </div>
      ${bar(t)}`;
  }

  function renderLegend() {
    if (mode === 'live') {
      $('legend').innerHTML = `
        <div class="cov-leg-row"><span class="cov-leg-title">Taux réel (base)</span>
          <span class="cov-leg-item"><span class="cov-dot cov-rate-hi"></span>≥ 80 %</span>
          <span class="cov-leg-item"><span class="cov-dot cov-rate-mid"></span>20–80 %</span>
          <span class="cov-leg-item"><span class="cov-dot cov-rate-lo"></span>&lt; 20 %</span>
          <span class="cov-leg-item"><span class="cov-dot cov-cell-insuf"></span>pas assez de données</span>
          <span class="cov-leg-item"><span class="cov-dot cov-cell-na"></span>non mesurable (pas de champ)</span>
        </div>`;
      return;
    }
    const st = data.legend.status, me = data.legend.method;
    const states = ['extrait', 'dispo', 'nok', 'unknown'].map(k =>
      `<span class="cov-leg-item"><span class="cov-dot cov-bg-${k}"></span>${escapeHtml(st[k] || k)}</span>`).join('');
    const methods = Object.entries(me).map(([k, label]) =>
      `<span class="cov-leg-item"><span class="cov-glyph">${METHOD[k] ? (METHOD[k][0] || '·') : '·'}</span>${escapeHtml(label)}</span>`).join('');
    $('legend').innerHTML = `
      <div class="cov-leg-row"><span class="cov-leg-title">État (réf. Miro)</span>${states}</div>
      <div class="cov-leg-row"><span class="cov-leg-title">Méthode d'acquisition</span>${methods}</div>`;
  }

  // ── Matrice ──

  function filters() {
    return { source: $('fSource').value, crit: $('fCrit').value.trim().toLowerCase() };
  }

  function renderMatrix() {
    if (!data) return;
    const f = filters();
    const cols = data.scrapers.filter(s => !f.source || s === f.source);
    let rows = data.criteria.filter(c => !f.crit || (`${c.key} ${c.label}`).toLowerCase().includes(f.crit));

    // Filtre d'état : mode Référence uniquement
    if (mode === 'ref' && state) {
      rows = rows.filter(c => cols.some(s => cell(c.key, s).status === state));
    }
    if (!rows.length || !cols.length) {
      $('matrix').innerHTML = '<div class="sc-empty">Aucune ligne ne correspond aux filtres.</div>';
      return;
    }

    const head = `<thead><tr><th class="cov-th-crit">Critère</th>${cols.map(colHeader).join('')}</tr></thead>`;
    const body = '<tbody>' + rows.map(c => rowHtml(c, cols)).join('') + '</tbody>';
    $('matrix').innerHTML = `<table class="cov-table">${head}${body}</table>`;
  }

  function colHeader(s) {
    if (mode === 'live') {
      const src = live ? live.sources[s] : null;
      const n = src ? src.n : 0;
      const tip = src && src.evaluable ? `${s} — n=${n}` : `${s} — n=${n} (pas assez de données)`;
      return `<th class="cov-th-src" title="${escapeHtml(tip)}">
        <span class="cov-th-name">${escapeHtml(s)}</span>
        <span class="cov-th-pct${src && src.evaluable ? '' : ' cov-th-insuf'}">n=${n}</span>
      </th>`;
    }
    const t = data.totals.by_scraper[s] || { extrait: 0, dispo: 0, nok: 0, unknown: 0 };
    const tot = t.extrait + t.dispo + t.nok + (t.unknown || 0);
    return `<th class="cov-th-src" title="${escapeHtml(s)} — extrait ${t.extrait} / dispo ${t.dispo} / nok ${t.nok} / indét. ${t.unknown || 0}">
      <span class="cov-th-name">${escapeHtml(s)}</span>
      <span class="cov-th-pct">${t.extrait}<small>/${tot}</small></span>
    </th>`;
  }

  function rowHtml(c, cols) {
    const cells = cols.map(s => mode === 'live' ? liveCellHtml(c.key, s) : refCellHtml(c, s)).join('');
    let rightChip;
    if (mode === 'live') {
      const measurable = live && live.measurable.includes(c.key);
      rightChip = measurable ? '' : '<span class="cov-crit-count cov-crit-na">non mesurable</span>';
    } else {
      const bc = data.totals.by_criterion[c.key] || { extrait: 0, dispo: 0, nok: 0, unknown: 0 };
      rightChip = `<span class="cov-crit-count" title="Extrait par ${bc.extrait} source(s)">${bc.extrait}/${bc.extrait + bc.dispo + bc.nok + (bc.unknown || 0)}</span>`;
    }
    return `<tr>
      <th class="cov-th-crit cov-row-crit" title="${escapeHtml(c.label)}">
        <span class="cov-crit-key">${escapeHtml(c.key)}</span>${rightChip}
      </th>
      ${cells}
    </tr>`;
  }

  function refCellHtml(c, s) {
    const cl = cell(c.key, s);
    const [glyph, mLabel] = METHOD[cl.method] || ['', cl.method];
    const dim = state && cl.status !== state ? ' cov-dim' : '';
    const title = `${s} · ${c.key} — ${STATUS_LABEL[cl.status] || cl.status} · ${mLabel}`;
    return `<td class="cov-cell cov-bg-${cl.status}${dim}" title="${escapeHtml(title)}"><span class="cov-glyph">${glyph}</span></td>`;
  }

  function liveCellHtml(critKey, s) {
    if (!live || !live.measurable.includes(critKey)) {
      return `<td class="cov-cell cov-cell-na" title="Pas de champ en base pour ce critère"><span class="cov-cell-val">n/a</span></td>`;
    }
    const src = live.sources[s];
    if (!src || !src.evaluable) {
      const n = src ? src.n : 0;
      return `<td class="cov-cell cov-cell-insuf" title="${escapeHtml(`${s} · ${critKey} — pas assez de données (n=${n}, seuil ${live.min_sample})`)}"><span class="cov-cell-val">—</span></td>`;
    }
    const r = src.rates[critKey];
    const cnt = src.counts[critKey];
    const cls = r >= 80 ? 'cov-rate-hi' : (r >= 20 ? 'cov-rate-mid' : 'cov-rate-lo');
    return `<td class="cov-cell ${cls}" title="${escapeHtml(`${s} · ${critKey} — ${cnt}/${src.n} (${r}%)`)}"><span class="cov-cell-val">${r}%</span></td>`;
  }

  function cell(critKey, scraper) {
    const row = data.coverage[critKey] || {};
    return row[scraper] || { status: 'nok', method: 'na' };
  }

  // ── Wiring ──

  $('refreshBtn').addEventListener('click', () => { load(); });
  $('fSource').addEventListener('change', renderMatrix);
  $('fCrit').addEventListener('input', debounce(renderMatrix, 200));

  $('stateSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.cov-seg-btn'); if (!btn) return;
    state = btn.dataset.state;
    $('stateSeg').querySelectorAll('.cov-seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderMatrix();
  });

  $('modeSeg').addEventListener('click', async (e) => {
    const btn = e.target.closest('.cov-seg-btn'); if (!btn) return;
    mode = btn.dataset.mode;
    $('modeSeg').querySelectorAll('.cov-seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    $('stateSeg').style.display = mode === 'live' ? 'none' : '';
    $('liveMeta').style.display = mode === 'live' ? '' : 'none';
    renderLegend();
    if (mode === 'live') { if (!live) { await loadLive(); } else { renderMatrix(); } }
    else { renderMatrix(); }
  });

  // ── Boot ──
  $('liveMeta').style.display = 'none';
  initConfig();
  pingHealth();
  load();
})();
