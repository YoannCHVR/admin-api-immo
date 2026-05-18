// Registre des placeholders URL

(() => {
  const $ = (id) => document.getElementById(id);
  let allPlaceholders = [];

  // ---------- Config ----------

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
      load();
    });
  }

  async function pingHealth() {
    const dot = $('healthDot');
    dot.className = 'health-dot pending';
    try {
      const res = await fetch(getApiUrl() + '/health');
      dot.className = res.ok ? 'health-dot ok' : 'health-dot ko';
    } catch { dot.className = 'health-dot ko'; }
  }

  // ---------- Load ----------

  async function load() {
    if (!getAdminToken()) {
      $('resultsContainer').innerHTML = '<div class="empty">Renseigne le <code>X-Admin-Token</code>.</div>';
      return;
    }
    $('resultsContainer').innerHTML = '<div class="loading">Chargement…</div>';
    try {
      const data = await fetchAdmin('/scrapers/placeholders');
      allPlaceholders = data.placeholders || [];
      render();
    } catch (e) {
      $('resultsContainer').innerHTML = `<div class="error">Erreur : ${escapeHtml(e.message)}</div>`;
    }
  }

  // ---------- Render ----------

  function render() {
    updateStats();
    if (!allPlaceholders.length) {
      $('resultsContainer').innerHTML = '<div class="empty">Aucun placeholder enregistré.</div>';
      return;
    }

    const rows = allPlaceholders.map(p => {
      const typeClass = `badge-type-${p.type}`;
      const builtinTag = p.is_builtin ? '<span class="tag tag-builtin">builtin</span>' : '';
      const mappingInfo = p.type === 'mapping'
        ? `<span class="text-muted">${p.mapping_size} entrée${p.mapping_size !== 1 ? 's' : ''}</span>`
        : '';
      const formulaInfo = p.type === 'formula' && p.formula
        ? `<code class="url-pattern">${escapeHtml(p.formula)}</code>`
        : '';

      return `
        <tr>
          <td class="col-name"><strong>{${escapeHtml(p.name)}}</strong> ${builtinTag}</td>
          <td><span class="badge ${typeClass}">${escapeHtml(p.type)}</span></td>
          <td>${escapeHtml(p.description || '—')}</td>
          <td>${formulaInfo}${mappingInfo}</td>
          <td>${p.example_input ? `<code>${escapeHtml(p.example_input)}</code> → <code>${escapeHtml(p.example_output || '?')}</code>` : '—'}</td>
          <td class="col-actions">
            <button class="btn btn-sm btn-secondary" data-action="edit" data-name="${escapeHtml(p.name)}">Modifier</button>
            ${p.type === 'mapping' ? `<button class="btn btn-sm btn-primary" data-action="mapping" data-name="${escapeHtml(p.name)}">Mapping</button>` : ''}
            ${!p.is_builtin ? `<button class="btn btn-sm btn-ghost" data-action="delete" data-name="${escapeHtml(p.name)}">Suppr.</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');

    $('resultsContainer').innerHTML = `
      <div class="table-wrap">
        <table class="sv-table">
          <thead>
            <tr>
              <th>Placeholder</th>
              <th>Type</th>
              <th>Description</th>
              <th>Formule / Mapping</th>
              <th>Exemple</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    wireRowActions();
  }

  function updateStats() {
    const builtins = allPlaceholders.filter(p => p.is_builtin).length;
    const mappings = allPlaceholders.filter(p => p.type === 'mapping').length;
    $('statsTotal').textContent = `Placeholders : ${allPlaceholders.length}`;
    $('statsBuiltin').textContent = `Builtins : ${builtins}`;
    $('statsMapping').textContent = `Mappings : ${mappings}`;
  }

  function wireRowActions() {
    $('resultsContainer').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const name = btn.dataset.name;
      if (action === 'edit') openEditModal(name);
      else if (action === 'mapping') openMappingModal(name);
      else if (action === 'delete') doDelete(name);
    });
  }

  // ---------- Edit modal ----------

  let editingName = null;

  function openEditModal(name) {
    const isNew = !name;
    editingName = name;
    $('editTitle').textContent = isNew ? 'Nouveau placeholder' : `Modifier {${name}}`;
    $('editName').value = name || '';
    $('editName').disabled = !isNew;

    if (name) {
      const p = allPlaceholders.find(x => x.name === name);
      if (p) {
        $('editType').value = p.type;
        $('editDesc').value = p.description || '';
        $('editFormula').value = p.formula || '';
        $('editExInput').value = p.example_input || '';
        $('editExOutput').value = p.example_output || '';
      }
    } else {
      $('editType').value = 'direct';
      $('editDesc').value = '';
      $('editFormula').value = '';
      $('editExInput').value = '';
      $('editExOutput').value = '';
    }

    toggleFormulaGroup();
    $('editModal').hidden = false;
  }

  function toggleFormulaGroup() {
    $('formulaGroup').style.display = $('editType').value === 'formula' ? 'block' : 'none';
  }
  $('editType').addEventListener('change', toggleFormulaGroup);

  function closeEditModal() {
    $('editModal').hidden = true;
    editingName = null;
  }

  async function doSaveEdit() {
    const name = $('editName').value.trim();
    if (!name) { toast('Nom requis', 'warn'); return; }
    const qs = new URLSearchParams({
      placeholder_type: $('editType').value,
    });
    const desc = $('editDesc').value.trim();
    if (desc) qs.set('description', desc);
    const formula = $('editFormula').value.trim();
    if (formula) qs.set('formula', formula);
    const exIn = $('editExInput').value.trim();
    if (exIn) qs.set('example_input', exIn);
    const exOut = $('editExOutput').value.trim();
    if (exOut) qs.set('example_output', exOut);

    try {
      await fetchAdmin(`/scrapers/placeholders/${encodeURIComponent(name)}?${qs}`, { method: 'PUT' });
      toast(`Placeholder {${name}} sauvé`, 'success');
      closeEditModal();
      load();
    } catch (e) {
      toast(`Erreur : ${e.message}`, 'error');
    }
  }

  $('editCancel').addEventListener('click', closeEditModal);
  $('editSave').addEventListener('click', doSaveEdit);
  $('editModal').addEventListener('click', (e) => { if (e.target === $('editModal')) closeEditModal(); });

  // ---------- Mapping modal ----------

  let mappingTarget = null;

  async function openMappingModal(name) {
    mappingTarget = name;
    $('mappingName').textContent = name;
    $('mappingEntries').value = '';

    // Fetch full mapping
    try {
      const data = await fetchAdmin(`/scrapers/placeholders/${encodeURIComponent(name)}`);
      const mapping = data.mapping || {};
      const entries = Object.entries(mapping).sort((a, b) => a[0].localeCompare(b[0]));
      if (entries.length) {
        $('mappingCurrent').innerHTML =
          `<h4>Mapping actuel (${entries.length} entrées)</h4>` +
          '<div class="mapping-grid">' +
          entries.map(([k, v]) => `<span class="mapping-key">${escapeHtml(k)}</span><span class="mapping-val">${escapeHtml(v)}</span>`).join('') +
          '</div>';
      } else {
        $('mappingCurrent').innerHTML = '<p class="text-muted">Mapping vide.</p>';
      }
    } catch (e) {
      $('mappingCurrent').innerHTML = `<p class="text-muted">Erreur chargement : ${escapeHtml(e.message)}</p>`;
    }

    $('mappingModal').hidden = false;
  }

  function closeMappingModal() {
    $('mappingModal').hidden = true;
    mappingTarget = null;
  }

  async function doSaveMapping() {
    if (!mappingTarget) return;
    const raw = $('mappingEntries').value.trim();
    if (!raw) { toast('Aucune entrée à ajouter', 'warn'); return; }

    const entries = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 1) { toast(`Ligne invalide : "${trimmed}" — format attendu : clé=valeur`, 'warn'); return; }
      entries[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }

    try {
      await fetchAdmin(`/scrapers/placeholders/${encodeURIComponent(mappingTarget)}/mapping`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entries),
      });
      toast(`${Object.keys(entries).length} entrée(s) ajoutée(s) à {${mappingTarget}}`, 'success');
      closeMappingModal();
      load();
    } catch (e) {
      toast(`Erreur : ${e.message}`, 'error');
    }
  }

  $('mappingCancel').addEventListener('click', closeMappingModal);
  $('mappingSave').addEventListener('click', doSaveMapping);
  $('mappingModal').addEventListener('click', (e) => { if (e.target === $('mappingModal')) closeMappingModal(); });

  // ---------- Delete ----------

  async function doDelete(name) {
    try {
      await fetchAdmin(`/scrapers/placeholders/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast(`Placeholder {${name}} supprimé`, 'success');
      load();
    } catch (e) {
      toast(`Erreur : ${e.message}`, 'error');
    }
  }

  // ---------- Resolve ----------

  const MODIFIER_DESCRIPTIONS = {
    dash: 'espaces/underscores → tirets',
    underscore: 'espaces/tirets → underscores',
    lower: 'minuscules',
    upper: 'majuscules',
    title: 'majuscule par mot',
    capitalize: '1re lettre majuscule',
    nospace: 'supprime espaces/tirets/underscores',
  };

  async function loadModifiersInfo() {
    try {
      const data = await fetchAdmin('/scrapers/sources');
      const mods = data.available_modifiers || [];
      const container = $('resolveModifiers');
      if (!mods.length) { container.innerHTML = ''; return; }
      container.innerHTML =
        '<span class="modal-hint">Modifiers disponibles :</span><div class="ph-chips">' +
        mods.map(m => {
          const desc = MODIFIER_DESCRIPTIONS[m] || m;
          return `<span class="modifier-chip modifier-chip-info"><span class="modifier-chip-label">|${escapeHtml(m)}</span><span class="ph-tooltip"><strong>|${escapeHtml(m)}</strong><br>${escapeHtml(desc)}</span></span>`;
        }).join('') +
        '</div>';
    } catch { /* silent */ }
  }

  async function doResolve() {
    const dept = $('resolveDept').value.trim();
    if (!dept) { toast('Code département requis', 'warn'); return; }

    const pattern = $('resolvePattern').value.trim();
    $('resolveResult').hidden = false;
    $('resolveResult').textContent = 'Résolution en cours…';

    try {
      let data;
      if (pattern) {
        const qs = new URLSearchParams({ pattern, department: dept, page: '1', transaction: 'achat', property_type: 'appartement' });
        data = await fetchAdmin(`/scrapers/placeholders/resolve-pattern?${qs}`, { method: 'POST' });
        // Show resolved URL prominently
        let html = '';
        if (data.resolved_url) {
          const url = data.resolved_url;
          const isUrl = url.startsWith('http://') || url.startsWith('https://');
          html += isUrl
            ? `URL résolue :\n<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:#60a5fa">${escapeHtml(url)}</a>\n\n`
            : `URL résolue :\n${escapeHtml(url)}\n\n`;
        }
        if (data.values_used) html += `Valeurs utilisées :\n${JSON.stringify(data.values_used, null, 2)}\n`;
        if (data.errors && data.errors.length) html += `\nErreurs :\n${data.errors.join('\n')}`;
        $('resolveResult').innerHTML = html;
      } else {
        data = await fetchAdmin(`/scrapers/placeholders/resolve?department=${encodeURIComponent(dept)}`);
        $('resolveResult').textContent = JSON.stringify(data, null, 2);
      }
    } catch (e) {
      $('resolveResult').textContent = `Erreur : ${e.message}`;
    }
  }

  $('resolveBtn').addEventListener('click', doResolve);
  $('resolveDept').addEventListener('keydown', (e) => { if (e.key === 'Enter') doResolve(); });
  $('resolvePattern').addEventListener('keydown', (e) => { if (e.key === 'Enter') doResolve(); });

  // ---------- Toolbar ----------

  $('addBtn').addEventListener('click', () => openEditModal(null));
  $('reloadBtn').addEventListener('click', load);

  // ---------- Init ----------

  initConfig();
  pingHealth();
  load();
  loadModifiersInfo();
})();
