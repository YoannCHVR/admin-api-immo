// Validation des sources scraping

(() => {
  const $ = (id) => document.getElementById(id);
  let allSources = [];

  // ---------- Config bar ----------

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
    } catch {
      dot.className = 'health-dot ko';
    }
  }

  // ---------- Load sources ----------

  async function load() {
    if (!getAdminToken()) {
      $('resultsContainer').innerHTML =
        '<div class="empty">Renseigne le <code>X-Admin-Token</code> en haut à droite.</div>';
      return;
    }
    $('resultsContainer').innerHTML = '<div class="loading">Chargement…</div>';
    try {
      const data = await fetchAdmin('/scrapers/sources');
      allSources = (data.sources || []).sort((a, b) => a.name.localeCompare(b.name));
      render();
    } catch (e) {
      $('resultsContainer').innerHTML = `<div class="error">Erreur : ${escapeHtml(e.message)}</div>`;
      toast(e.message, 'error');
    }
  }

  // ---------- Render ----------

  function render() {
    updateStats();

    if (!allSources.length) {
      $('resultsContainer').innerHTML = '<div class="empty">Aucune source enregistrée.</div>';
      return;
    }

    const rows = allSources.map(s => {
      const status = s.config_status || 'no_config';
      const method = s.scraping_method || 'html';
      const methodLabel = { api: 'API', html: 'HTML', html_json: 'HTML/JSON', js_rendering: 'JS Rendering' }[method] || method;
      const propTypes = (s.property_types || []).join(', ') || '—';
      const validatedAt = s.validated_at ? new Date(s.validated_at).toLocaleString('fr-FR') : '—';

      // URL pattern
      const urlDisplay = s.url_pattern
        ? `<code class="url-pattern" title="${escapeHtml(s.url_pattern)}">${escapeHtml(truncate(s.url_pattern, 60))}</code>`
        : '<span class="text-muted">aucun pattern</span>';

      // Agent URL / Admin URL — only link if it's a real URL
      const isUrl = (v) => v && (v.startsWith('http://') || v.startsWith('https://'));
      let urlLinks = '';
      if (s.agent_url) {
        if (isUrl(s.agent_url)) {
          urlLinks += `<a href="${escapeHtml(s.agent_url)}" target="_blank" rel="noopener" class="sv-url-link" title="${escapeHtml(s.agent_url)}">agent</a>`;
        } else {
          urlLinks += `<span class="sv-url-text" title="${escapeHtml(s.agent_url)}">${escapeHtml(truncate(s.agent_url, 40))}</span>`;
        }
      }
      if (s.admin_url) {
        if (isUrl(s.admin_url)) {
          urlLinks += `${urlLinks ? ' · ' : ''}<a href="${escapeHtml(s.admin_url)}" target="_blank" rel="noopener" class="sv-url-link sv-url-admin" title="${escapeHtml(s.admin_url)}">admin</a>`;
        } else {
          urlLinks += `${urlLinks ? ' · ' : ''}<span class="sv-url-text">${escapeHtml(truncate(s.admin_url, 40))}</span>`;
        }
      }

      // Notes enriched with native dept info
      let notesText = s.notes ? escapeHtml(truncate(s.notes, 50)) : '';
      if (s.supports_department_native) {
        notesText += `${notesText ? ' · ' : ''}<span class="tag tag-native-small">dept natif</span>`;
      }
      if (!notesText) notesText = '—';

      return `
        <tr data-source="${escapeHtml(s.name)}" data-status="${status}">
          <td class="col-name"><strong>${escapeHtml(s.name)}</strong></td>
          <td><span class="badge badge-${status}">${status}</span></td>
          <td><span class="badge badge-method-${escapeHtml(method)}">${escapeHtml(methodLabel)}</span></td>
          <td class="col-url">${urlDisplay}${urlLinks ? `<div class="sv-url-links">${urlLinks}</div>` : ''}</td>
          <td class="col-props">${escapeHtml(propTypes)}</td>
          <td>${validatedAt}</td>
          <td class="col-notes">${notesText}</td>
          <td class="col-actions">
            ${status !== 'validated' ? `<button class="btn btn-sm btn-success" data-action="validate" data-source="${escapeHtml(s.name)}">Valider</button>` : ''}
            ${status !== 'rejected' ? `<button class="btn btn-sm btn-danger" data-action="reject" data-source="${escapeHtml(s.name)}">Rejeter</button>` : ''}
            <button class="btn btn-sm btn-secondary" data-action="edit" data-source="${escapeHtml(s.name)}">Modifier</button>
            ${status !== 'no_config' ? `<button class="btn btn-sm btn-ghost" data-action="delete" data-source="${escapeHtml(s.name)}">Suppr.</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');

    $('resultsContainer').innerHTML = `
      <div class="table-wrap">
        <table class="sv-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Statut</th>
              <th>Méthode</th>
              <th>URL pattern / liens</th>
              <th>Property types</th>
              <th>Validé le</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

  }

  function updateStats() {
    const counts = { no_config: 0, pending_review: 0, validated: 0, rejected: 0 };
    for (const s of allSources) counts[s.config_status || 'no_config']++;
    $('statsTotal').textContent = `Sources : ${allSources.length}`;
    $('statsValidated').textContent = `Validated : ${counts.validated}`;
    $('statsPending').textContent = `Pending : ${counts.pending_review}`;
    $('statsNoConfig').textContent = `No config : ${counts.no_config}`;
    $('statsRejected').textContent = `Rejected : ${counts.rejected}`;
  }

  function truncate(s, max) {
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  // ---------- Row actions ----------

  function wireRowActions() {
    $('resultsContainer').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const source = btn.dataset.source;

      if (action === 'validate') doValidate(source);
      else if (action === 'reject') openRejectModal(source);
      else if (action === 'edit') openEditModal(source);
      else if (action === 'delete') doDelete(source);
    });
  }

  // ---------- Actions API ----------

  async function doValidate(source) {
    try {
      await fetchAdmin(`/scrapers/config/${encodeURIComponent(source)}/validate`, { method: 'PATCH' });
      toast(`${source} validé`, 'success');
      load();
    } catch (e) {
      toast(`Erreur validation : ${e.message}`, 'error');
    }
  }

  async function doDelete(source) {
    try {
      await fetchAdmin(`/scrapers/config/${encodeURIComponent(source)}`, { method: 'DELETE' });
      toast(`Config ${source} supprimée`, 'success');
      load();
    } catch (e) {
      toast(`Erreur suppression : ${e.message}`, 'error');
    }
  }

  async function doAutoGenerate() {
    $('autoGenBtn').disabled = true;
    $('autoGenBtn').textContent = 'Génération…';
    try {
      const data = await fetchAdmin('/scrapers/config/auto-generate', { method: 'POST' });
      const msg = `Généré : ${data.generated || 0}, déjà existant : ${data.already_exists || 0}`;
      toast(msg, 'success');
      load();
    } catch (e) {
      toast(`Erreur auto-generate : ${e.message}`, 'error');
    } finally {
      $('autoGenBtn').disabled = false;
      $('autoGenBtn').textContent = 'Auto-générer les configs';
    }
  }

  // ---------- Reject modal ----------

  let rejectTarget = null;

  function openRejectModal(source) {
    rejectTarget = source;
    $('rejectSourceName').textContent = source;
    $('rejectReason').value = '';
    $('rejectModal').hidden = false;
  }

  function closeRejectModal() {
    $('rejectModal').hidden = true;
    rejectTarget = null;
  }

  async function doReject() {
    if (!rejectTarget) return;
    const reason = $('rejectReason').value.trim();
    const qs = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    try {
      await fetchAdmin(`/scrapers/config/${encodeURIComponent(rejectTarget)}/reject${qs}`, { method: 'PATCH' });
      toast(`${rejectTarget} rejeté`, 'success');
      closeRejectModal();
      load();
    } catch (e) {
      toast(`Erreur rejet : ${e.message}`, 'error');
    }
  }

  $('rejectCancel').addEventListener('click', closeRejectModal);
  $('rejectConfirm').addEventListener('click', doReject);
  $('rejectModal').addEventListener('click', (e) => {
    if (e.target === $('rejectModal')) closeRejectModal();
  });

  // ---------- Edit modal ----------

  let editTarget = null;
  let cachedPlaceholders = null;
  let cachedModifiers = null;

  async function loadPlaceholders() {
    if (cachedPlaceholders) return cachedPlaceholders;
    try {
      const data = await fetchAdmin('/scrapers/placeholders');
      cachedPlaceholders = data.placeholders || [];
    } catch {
      cachedPlaceholders = [];
    }
    return cachedPlaceholders;
  }

  async function loadModifiers() {
    if (cachedModifiers) return cachedModifiers;
    try {
      const data = await fetchAdmin('/scrapers/sources');
      cachedModifiers = data.available_modifiers || [];
    } catch {
      cachedModifiers = [];
    }
    return cachedModifiers;
  }

  const MODIFIER_DESCRIPTIONS = {
    dash: 'espaces/underscores → tirets',
    underscore: 'espaces/tirets → underscores',
    lower: 'minuscules',
    upper: 'majuscules',
    title: 'majuscule par mot',
    capitalize: '1re lettre majuscule',
    nospace: 'supprime espaces/tirets/underscores',
  };

  function renderPlaceholderTags(placeholders) {
    const container = $('editPlaceholderTags');
    if (!placeholders.length) {
      container.innerHTML = '<span class="modal-hint">Aucun placeholder enregistré</span>';
      return;
    }
    const tags = placeholders.map(p => {
      const typeClass = p.type === 'mapping' ? 'ph-chip-mapping'
        : p.type === 'formula' ? 'ph-chip-formula'
        : 'ph-chip-direct';
      const typeLabel = p.type === 'mapping' ? 'Mapping (clé → valeur)'
        : p.type === 'formula' ? 'Formule calculée'
        : 'Direct (passé tel quel)';
      let tooltipLines = `<strong>{${escapeHtml(p.name)}}</strong> — <em>${escapeHtml(typeLabel)}</em>`;
      if (p.description) tooltipLines += `<br>${escapeHtml(p.description)}`;
      if (p.example_input) tooltipLines += `<br><span class="tt-example">ex : ${escapeHtml(p.example_input)} → ${escapeHtml(p.example_output || '?')}</span>`;
      if (p.type === 'mapping' && p.mapping_size != null) tooltipLines += `<br><span class="tt-meta">${p.mapping_size} entrée${p.mapping_size !== 1 ? 's' : ''} dans le mapping</span>`;
      if (p.type === 'formula' && p.formula) tooltipLines += `<br><code class="tt-formula">${escapeHtml(p.formula)}</code>`;
      return `<button type="button" class="ph-chip ${typeClass}" data-ph="${escapeHtml(p.name)}"><span class="ph-chip-label">{${escapeHtml(p.name)}}</span><span class="ph-tooltip">${tooltipLines}</span></button>`;
    }).join('');
    container.innerHTML =
      '<span class="modal-hint">Placeholders disponibles (clic pour insérer) :</span><div class="ph-chips">' + tags + '</div>';

    container.querySelectorAll('.ph-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const input = $('editUrlPattern');
        const tag = `{${chip.dataset.ph}}`;
        const pos = input.selectionStart ?? input.value.length;
        input.value = input.value.slice(0, pos) + tag + input.value.slice(pos);
        input.focus();
        input.setSelectionRange(pos + tag.length, pos + tag.length);
      });
    });
  }

  function renderModifierTags(modifiers) {
    const container = $('editModifierTags');
    if (!modifiers.length) {
      container.innerHTML = '';
      return;
    }
    const chips = modifiers.map(m => {
      const desc = MODIFIER_DESCRIPTIONS[m] || m;
      return `<button type="button" class="modifier-chip" data-mod="${escapeHtml(m)}"><span class="modifier-chip-label">|${escapeHtml(m)}</span><span class="ph-tooltip"><strong>|${escapeHtml(m)}</strong><br>${escapeHtml(desc)}</span></button>`;
    }).join('');
    container.innerHTML =
      '<span class="modal-hint">Modifiers (clic pour insérer <code>|modifier</code>) :</span><div class="ph-chips">' + chips + '</div>';

    container.querySelectorAll('.modifier-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const input = $('editUrlPattern');
        const tag = `|${chip.dataset.mod}`;
        const pos = input.selectionStart ?? input.value.length;
        input.value = input.value.slice(0, pos) + tag + input.value.slice(pos);
        input.focus();
        input.setSelectionRange(pos + tag.length, pos + tag.length);
      });
    });
  }

  async function doTestPattern() {
    const pattern = $('editUrlPattern').value.trim();
    if (!pattern) { toast('Pattern requis', 'warn'); return; }
    const dept = prompt('Code département pour le test (ex: 37) :');
    if (!dept) return;
    const preview = $('editPatternPreview');
    preview.hidden = false;
    preview.innerHTML = '<span class="text-muted">Résolution…</span>';
    try {
      const qs = new URLSearchParams({ pattern, department: dept, page: '1', transaction: 'achat', property_type: 'appartement' });
      const data = await fetchAdmin(`/scrapers/placeholders/resolve-pattern?${qs}`, { method: 'POST' });
      if (data.errors && data.errors.length) {
        toast(data.errors.join(' | '), 'error');
      }
      const url = data.resolved_url || '';
      const isUrl = url.startsWith('http://') || url.startsWith('https://');
      preview.innerHTML =
        `<span class="preview-label">URL résolue (dept ${escapeHtml(dept)}) :</span>` +
        (isUrl
          ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="preview-url">${escapeHtml(url)}</a>`
          : `<code class="preview-url">${escapeHtml(url)}</code>`);
      if (data.values_used) {
        const vals = Object.entries(data.values_used).map(([k, v]) => `${k}=${v}`).join(', ');
        preview.innerHTML += `<span class="preview-values">${escapeHtml(vals)}</span>`;
      }
    } catch (e) {
      preview.innerHTML = `<span class="text-muted">Erreur : ${escapeHtml(e.message)}</span>`;
    }
  }

  async function openEditModal(source) {
    editTarget = source;
    const s = allSources.find(x => x.name === source);
    $('editSourceName').textContent = source;
    $('editUrlPattern').value = s?.url_pattern || '';
    $('editAdminUrl').value = s?.admin_url || '';
    $('editNotes').value = s?.notes || '';
    $('editPlaceholderTags').innerHTML = '<span class="modal-hint">Placeholders : chargement…</span>';
    $('editModifierTags').innerHTML = '<span class="modal-hint">Modifiers : chargement…</span>';
    $('editPatternPreview').hidden = true;
    $('editModal').hidden = false;
    $('editUrlPattern').focus();

    const [placeholders, modifiers] = await Promise.all([loadPlaceholders(), loadModifiers()]);
    renderPlaceholderTags(placeholders);
    renderModifierTags(modifiers);
  }

  function closeEditModal() {
    $('editModal').hidden = true;
    editTarget = null;
  }

  async function doEdit() {
    if (!editTarget) return;
    const urlPattern = $('editUrlPattern').value.trim();
    const notes = $('editNotes').value.trim();
    if (!urlPattern) {
      toast('URL pattern requis', 'warn');
      return;
    }
    const qs = new URLSearchParams({ url_pattern: urlPattern });
    if (notes) qs.set('notes', notes);
    try {
      await fetchAdmin(`/scrapers/config/${encodeURIComponent(editTarget)}?${qs}`, { method: 'PUT' });
      toast(`Config ${editTarget} mise à jour (pending_review)`, 'success');
      closeEditModal();
      load();
    } catch (e) {
      toast(`Erreur modification : ${e.message}`, 'error');
    }
  }

  async function doSubmitAdminUrl() {
    if (!editTarget) return;
    const url = $('editAdminUrl').value.trim();
    if (!url) { toast('URL admin requise', 'warn'); return; }
    try {
      await fetchAdmin(`/scrapers/config/${encodeURIComponent(editTarget)}/admin-url?url=${encodeURIComponent(url)}`, { method: 'PATCH' });
      toast(`Lien admin soumis pour ${editTarget}`, 'success');
      load();
    } catch (e) {
      toast(`Erreur : ${e.message}`, 'error');
    }
  }

  $('editCancel').addEventListener('click', closeEditModal);
  $('editSave').addEventListener('click', doEdit);
  $('editTestBtn').addEventListener('click', doTestPattern);
  $('editAdminUrlSave').addEventListener('click', doSubmitAdminUrl);
  $('editModal').addEventListener('click', (e) => {
    if (e.target === $('editModal')) closeEditModal();
  });

  // ---------- Toolbar ----------

  $('autoGenBtn').addEventListener('click', doAutoGenerate);
  $('reloadBtn').addEventListener('click', load);

  // ---------- Init ----------

  initConfig();
  wireRowActions();
  pingHealth();
  load();
})();
