/* Hosted exports only. Files selected below stay in this browser; no uploads or model calls. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), MAX_BYTES = 10 * 1024 * 1024;
  const state = { comparison: null, shared: null, preview: false, population: new Map(), scores: new Map() };
  const number = value => typeof value === 'number' && Number.isFinite(value);
  const text = value => typeof value === 'string' && value.length <= 2000;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const key = (split, id) => `${split}\0${id}`;
  const format = (value, digits = 3) => number(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
  const el = (tag, value, className) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (className) node.className = className; return node; };
  const set = (id, value) => { if ($(id)) $(id).textContent = value; };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const modelLabel = experiment => experiment.model === 'sophon' ? 'Sophon (frozen reference)' : experiment.model;
  const label = experiment => `${experiment.team} · ${modelLabel(experiment)} · ${experiment.experiment_id || experiment.feature_set}`;
  const splitNames = ['validation', 'test'];
  let requestGeneration = 0;

  function validate(data) {
    assert(object(data) && data.version === 1 && /^[a-f0-9]{64}$/.test(data.dataset_id || ''), 'Choose a version-1 comparison.json or leaderboard.json export.');
    if (!object(data.leaderboard) || !Array.isArray(data.experiments)) throw new Error('This looks like a team submission. Run the postprocessing step to preview it, or submit the JSON through GitHub for the shared leaderboard.');
    assert(data.experiments.length <= 500 && Array.isArray(data.leaderboard.quality) && Array.isArray(data.leaderboard.efficiency), 'The results export has an invalid experiment or ranking list.');
    const experiments = new Map();
    for (const row of data.experiments) {
      assert(object(row) && text(row.experiment_key) && text(row.team) && text(row.model) && text(row.run_id) && text(row.feature_set) && object(row.metrics) && object(row.timings), 'An experiment is missing its result fields.');
      assert(!experiments.has(row.experiment_key), 'Duplicate experiment identifiers; regenerate the export.');
      assert(Array.isArray(row.evaluated_splits) && row.evaluated_splits.every(split => splitNames.includes(split)), 'An experiment has an unsupported evaluation split.');
      for (const split of row.evaluated_splits) assert(object(row.metrics[split]) && number(row.metrics[split].roc_auc) && row.metrics[split].roc_auc >= 0 && row.metrics[split].roc_auc <= 1, 'A saved ROC-AUC is invalid.');
      assert(number(row.timings.normalized_inference_time) && row.timings.normalized_inference_time > 0 && number(row.timings.training_seconds) && row.timings.training_seconds >= 0 && number(row.timings.per_jet_ms) && row.timings.per_jet_ms > 0, 'An experiment has invalid timing values.');
      assert(row.explanation === undefined || text(row.explanation), 'An experiment explanation is too long.');
      experiments.set(row.experiment_key, row);
    }
    for (const entries of [data.leaderboard.quality, data.leaderboard.efficiency]) {
      assert(entries.length <= 500, 'The ranking list is too large.');
      for (const row of entries) assert(object(row) && text(row.team) && text(row.run_id) && text(row.model) && number(row.rank) && number(row.test_auc) && number(row.normalized_inference_time) && [...experiments.values()].some(experiment => experiment.team === row.team && experiment.run_id === row.run_id && experiment.test_selection === 'final' && experiment.evaluated_splits.includes('test')), 'Rankings must refer to explicit final test selections.');
    }
    if (!('population' in data || 'jets' in data)) return { kind: 'leaderboard', data };
    assert(Array.isArray(data.population) && data.population.length <= 20000 && Array.isArray(data.predictions) && data.predictions.length <= 100000 && Array.isArray(data.jets) && data.jets.length <= 200, 'Comparison arrays are missing or exceed the bounded export size.');
    const population = new Map(), predictions = new Set(), counts = new Map();
    for (const row of data.population) {
      assert(object(row) && text(row.record_id) && splitNames.includes(row.split) && ['signal', 'background'].includes(row.truth_group) && Number.isInteger(row.truth_label) && (row.truth_group === 'signal' ? row.truth_label === 0 : row.truth_label >= 161 && row.truth_label <= 187) && typeof row.in_training_support === 'boolean' && typeof row.particles_truncated === 'boolean', 'A population record is invalid.');
      const id = key(row.split, row.record_id); assert(!population.has(id), 'Duplicate population records.'); population.set(id, row);
    }
    for (const row of data.predictions) {
      assert(object(row) && experiments.has(row.experiment_key) && population.has(key(row.split, row.record_id)) && number(row.signal_score) && row.signal_score >= 0 && row.signal_score <= 1, 'A prediction has an unknown record or invalid score.');
      const id = `${row.experiment_key}\0${key(row.split, row.record_id)}`; assert(!predictions.has(id), 'Duplicate prediction records.'); predictions.add(id);
      const group = key(row.split, row.experiment_key); counts.set(group, (counts.get(group) || 0) + 1);
    }
    for (const experiment of experiments.values()) for (const split of experiment.evaluated_splits) assert(counts.get(key(split, experiment.experiment_key)) === data.population.filter(row => row.split === split).length, 'Predictions do not cover the complete population. Regenerate comparison.json with the postprocessing step.');
    for (const row of data.jets) {
      const source = population.get(key(row.split, row.record_id));
      assert(source && object(row.truth) && row.truth.group === source.truth_group && row.truth.label === source.truth_label && row.particles_truncated === source.particles_truncated && typeof row.in_training_support === 'boolean' && row.in_training_support === source.in_training_support && Array.isArray(row.energy_flow) && row.energy_flow.length > 0 && row.energy_flow.length <= 5000, 'A display jet is inconsistent with the population.');
      assert(row.energy_flow.every(part => object(part) && number(part.deta) && number(part.dphi) && number(part.energy_gev) && part.energy_gev >= 0) && row.energy_flow.some(part => part.energy_gev > 0), 'Particle energy-flow measurements are invalid.');
    }
    return { kind: 'comparison', data };
  }

  function indexComparison() {
    state.population = new Map(); state.scores = new Map();
    for (const row of state.comparison?.population || []) state.population.set(key(row.split, row.record_id), row);
    for (const row of state.comparison?.predictions || []) {
      const id = key(row.split, row.record_id); if (!state.scores.has(id)) state.scores.set(id, new Map());
      state.scores.get(id).set(row.experiment_key, row.signal_score);
    }
  }
  function analysis() {
    const data = state.comparison || state.shared;
    if (!data) return null;
    const experiments = new Map((state.comparison?.experiments || []).map(row => [row.experiment_key, row]));
    if (!state.comparison || state.shared?.dataset_id === state.comparison.dataset_id) {
      for (const row of state.shared?.experiments || []) experiments.set(row.experiment_key, row);
    }
    return { ...data, experiments: [...experiments.values()] };
  }
  const rankingSource = () => state.shared && (!state.comparison || state.shared.dataset_id === state.comparison.dataset_id) ? state.shared : state.comparison;
  const tableRow = values => { const row = el('tr'); for (const value of values) row.append(el('td', value)); return row; };
  function emptyTable(id, columns, message) { const row = el('tr'), cell = el('td', message); cell.colSpan = columns; row.append(cell); $(id)?.append(row); }
  function renderRankings() {
    const board = rankingSource()?.leaderboard, quality = (board?.quality || []).filter(row => row.model !== 'sophon'), efficiency = (board?.efficiency || []).filter(row => row.model !== 'sophon');
    set('quality-winner', quality.length ? `${quality[0].team} · ${quality[0].model} · AUC ${format(quality[0].test_auc, 4)}` : 'Awaiting final test submissions');
    set('efficiency-winner', efficiency.length ? `${efficiency[0].team} · ${efficiency[0].model}` : 'Awaiting an eligible final submission');
    $('rankings')?.replaceChildren();
    for (const row of quality) {
      const efficient = efficiency.find(item => item.team === row.team);
      $('rankings')?.append(tableRow([row.rank, row.team, row.model, format(row.test_auc, 4), format(row.normalized_inference_time, 6), efficient ? efficient.rank : 'Outside quality margin']));
    }
    if (!quality.length) emptyTable('rankings', 6, 'Validation experiments remain exploratory. Final test submissions will appear here.');
  }
  function renderExperiments() {
    const experiments = analysis()?.experiments || []; $('experiments')?.replaceChildren(); $('notes')?.replaceChildren();
    for (const experiment of experiments) {
      for (const split of experiment.evaluated_splits.filter(name => name === ($('split')?.value || 'validation'))) $('experiments')?.append(tableRow([experiment.team, modelLabel(experiment), experiment.feature_set, split === 'test' ? 'Final test' : 'Validation', format(experiment.metrics[split].roc_auc, 4), format(experiment.timings.training_seconds), format(experiment.timings.per_jet_ms, 4)]));
      if (!experiment.explanation || experiment.explanation.startsWith('Replace this with')) continue;
      const note = el($('notes')?.tagName === 'UL' || $('notes')?.tagName === 'OL' ? 'li' : 'article');
      note.append(el('h3', label(experiment)), el('p', experiment.explanation || 'No explanation supplied.')); $('notes')?.append(note);
    }
    if (!$('experiments')?.children.length) emptyTable('experiments', 7, 'No experiment results are available for this evaluation split.');
    set('experiment-count', experiments.length);
  }
  function svgNode(tag, attrs = {}, value) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, item] of Object.entries(attrs)) node.setAttribute(name, String(item));
    if (value !== undefined) node.textContent = value; return node;
  }
  function svgText(svg, x, y, value, attrs = {}) { svg.append(svgNode('text', { x, y, fill: 'currentColor', 'font-size': 11, ...attrs }, value)); }
  function renderTradeoff() {
    const svg = $('tradeoff'); if (!svg) return; svg.replaceChildren();
    const split = $('split')?.value || 'validation';
    const points = (analysis()?.experiments || []).filter(row => row.metrics[split]);
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Saved full-${split} ROC-AUC versus normalized inference cost on a logarithmic horizontal axis. Support filters apply to the explorer below.`);
    if (!points.length) { svgText(svg, 320, 130, `No ${split} results available`, { 'text-anchor': 'middle' }); return; }
    const logs = points.map(row => Math.log10(row.timings.normalized_inference_time));
    const lo = Math.min(...logs) - .3, hi = Math.max(...logs) + .3, x = value => 65 + (Math.log10(value) - lo) / (hi - lo) * 540, y = value => 220 - value * 190;
    for (let i = 0; i <= 4; i++) {
      const score = i / 4; svg.append(svgNode('line', { x1: 65, x2: 605, y1: y(score), y2: y(score), stroke: '#d4d4d4' })); svgText(svg, 53, y(score) + 4, score.toFixed(2), { 'text-anchor': 'end' });
      const cost = 10 ** (lo + (hi - lo) * i / 4); svgText(svg, x(cost), 238, cost.toExponential(1), { 'text-anchor': 'middle' });
    }
    svgText(svg, 65, 16, `${split === 'test' ? 'Final test' : 'Validation'} ROC-AUC`); svgText(svg, 335, 263, 'Normalized inference cost · logarithmic · lower is faster', { 'text-anchor': 'middle' });
    for (const row of points) {
      const title = `${label(row)}; ROC-AUC ${format(row.metrics[split].roc_auc, 4)}; normalized cost ${format(row.timings.normalized_inference_time, 6)}`;
      const dot = svgNode('circle', { cx: x(row.timings.normalized_inference_time), cy: y(row.metrics[split].roc_auc), r: 6, fill: row.model === 'sophon' ? '#777' : '#161616', stroke: '#fff', 'stroke-width': 1, tabindex: 0, 'aria-label': title });
      dot.append(svgNode('title', {}, title)); svg.append(dot);
    }
  }
  function renderJetChoices() {
    const select = $('jet'); if (!select) return; const previous = select.value; select.replaceChildren();
    const split = $('split')?.value || 'validation', supported = $('support')?.checked;
    const jets = (state.comparison?.jets || []).filter(row => row.split === split && (!supported || row.in_training_support));
    for (const row of jets) { const option = el('option', `${row.truth.group === 'signal' ? 'X→bb' : 'QCD'} truth · ${row.record_id.slice(0, 12)}`); option.value = row.record_id; select.append(option); }
    if (jets.some(row => row.record_id === previous)) select.value = previous;
    select.disabled = !jets.length; renderJet(); renderThreshold();
  }
  function renderJet() {
    const svg = $('energy'); if (!svg) return; svg.replaceChildren(); $('scores')?.replaceChildren();
    const split = $('split')?.value || 'validation', jet = state.comparison?.jets.find(row => row.split === split && row.record_id === $('jet')?.value);
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Angular energy flow: relative pseudorapidity and azimuth; circle area represents particle energy. These are not spatial detector tracks.');
    if (!jet) { svgText(svg, 210, 155, 'No display jets for this selection', { 'text-anchor': 'middle' }); set('jet-info', state.comparison ? 'Change the split or support filter.' : 'Load comparison.json to explore particle measurements and model scores.'); return; }
    const particles = jet.energy_flow, extent = Math.max(.8, ...particles.flatMap(row => [Math.abs(row.deta), Math.abs(row.dphi)])) * 1.08;
    const x = value => 215 + value / extent * 125, y = value => 150 - value / extent * 125, maxEnergy = Math.max(...particles.map(row => row.energy_gev));
    for (const fraction of [-1, 0, 1]) {
      const value = fraction * extent; svg.append(svgNode('line', { x1: x(value), x2: x(value), y1: 25, y2: 275, stroke: '#ddd' }), svgNode('line', { x1: 90, x2: 340, y1: y(value), y2: y(value), stroke: '#ddd' }));
      svgText(svg, x(value), 293, format(value, 2), { 'text-anchor': 'middle' }); svgText(svg, 59, y(value) + 4, format(value, 2), { 'text-anchor': 'end' });
    }
    svgText(svg, 215, 319, 'Δη · relative pseudorapidity', { 'text-anchor': 'middle' }); svgText(svg, 70, 15, 'Δφ · relative azimuth (radians)');
    for (const part of particles) {
      const dot = svgNode('circle', { cx: x(part.deta), cy: y(part.dphi), r: 16 * Math.sqrt(part.energy_gev / maxEnergy), fill: '#303030', 'fill-opacity': .5 });
      dot.append(svgNode('title', {}, `${format(part.energy_gev, 2)} GeV; Δη ${format(part.deta)}; Δφ ${format(part.dphi)}`)); svg.append(dot);
    }
    set('jet-info', `Simulation truth: ${jet.truth.group === 'signal' ? 'X→bb signal' : 'QCD background'} (label ${jet.truth.label}). ${particles.length} particles shown; circle areas scale within this jet. ${jet.in_training_support ? 'Within' : 'Outside'} Sophon training range.${jet.particles_truncated ? ' Full arrays are shown; Sophon uses the first 128 particles.' : ''}`);
    const scores = state.scores.get(key(split, jet.record_id));
    for (const experiment of state.comparison.experiments) if (scores?.has(experiment.experiment_key)) {
      const score = scores.get(experiment.experiment_key), row = el('div', undefined, 'score-row'), description = `${label(experiment)}: signal score ${format(score, 4)}`;
      const meter = el('div', undefined, 'score-bar'), fill = el('span'); fill.style.width = `${score * 100}%`; meter.append(fill);
      for (const [name, value] of Object.entries({ role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 1, 'aria-valuenow': score, 'aria-label': description })) meter.setAttribute(name, value); row.append(el('span', description), meter); $('scores')?.append(row);
    }
    if (!$('scores')?.children.length) $('scores')?.append(el('p', 'No model scores for this display jet.'));
  }
  function renderThreshold() {
    const threshold = Number($('threshold')?.value ?? .5), split = $('split')?.value || 'validation', supported = $('support')?.checked;
    set('threshold-label', threshold.toFixed(2)); $('operating-point')?.replaceChildren(); const counts = [];
    for (const experiment of state.comparison?.experiments || []) {
      if (!experiment.evaluated_splits.includes(split)) continue;
      let signal = 0, retained = 0, background = 0, rejected = 0;
      for (const [id, row] of state.population) {
        if (row.split !== split || (supported && !row.in_training_support)) continue;
        const score = state.scores.get(id)?.get(experiment.experiment_key); if (score === undefined) continue;
        if (row.truth_group === 'signal') { signal++; if (score >= threshold) retained++; } else { background++; if (score < threshold) rejected++; }
      }
      counts.push({ experiment_key: experiment.experiment_key, split, rows: signal + background, signal, retained, background, rejected });
      const percent = (n, d) => d ? `${format(n / d * 100, 1)}%` : 'unavailable';
      $('operating-point')?.append(el('p', `${label(experiment)} — signal retained ${percent(retained, signal)} (${retained}/${signal}); background rejected ${percent(rejected, background)} (${rejected}/${background}). ${signal + background} ${supported ? 'in-range ' : ''}${split} jets.`));
    }
    if (!counts.length) $('operating-point')?.append(el('p', 'Complete prediction data are needed for threshold analysis. Load comparison.json; a leaderboard alone contains no particle scores.'));
    window.__workshopView = { datasetId: analysis()?.dataset_id || null, experiments: analysis()?.experiments.length || 0, population: state.population.size, displayJets: state.comparison?.jets.length || 0, predictions: state.comparison?.predictions.length || 0, threshold, split, supportOnly: Boolean(supported), operatingPoints: counts, browserLocalPreview: state.preview, sharedLeaderboard: Boolean(state.shared && rankingSource() === state.shared) };
  }
  function render() {
    const data = analysis(), available = Boolean(data); if ($('content')) $('content').hidden = !available; if ($('empty')) $('empty').hidden = available;
    set('dataset', data ? `Dataset ${data.dataset_id.slice(0, 12)} · simulated collider data` : 'No dataset loaded');
    renderRankings(); renderExperiments(); renderTradeoff(); renderJetChoices();
  }
  async function fetchJSON(path) {
    const response = await fetch(path, { cache: 'no-store' }); if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${path} could not be loaded (${response.status}).`);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0, content = '';
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error(`${path} exceeds the 10 MB preview limit.`); } content += decoder.decode(value, { stream: true }); }
    content += decoder.decode(); return validate(JSON.parse(content));
  }
  async function reload() {
    const generation = ++requestGeneration; set('status', 'Loading published results…'); state.preview = false;
    const results = await Promise.allSettled([fetchJSON('comparison.json'), fetchJSON('leaderboard.json')]);
    if (generation !== requestGeneration) return;
    state.comparison = results[0].status === 'fulfilled' && results[0].value?.kind === 'comparison' ? results[0].value.data : null;
    state.shared = results[1].status === 'fulfilled' && results[1].value?.kind === 'leaderboard' ? results[1].value.data : null;
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.message);
    if (state.comparison && state.shared && state.comparison.dataset_id !== state.shared.dataset_id) { state.shared = null; errors.push('The shared leaderboard belongs to another dataset and was ignored.'); }
    indexComparison(); render();
    set('status', errors.join(' ') || (analysis() ? 'Published results loaded. Scores and timings are team-reported; quality is recomputed from simulation truth.' : 'No results published yet. Run the postprocessing step and add comparison.json, or wait for the first final submission.'));
  }
  $('file')?.addEventListener('change', async event => {
    try {
      if (!event.target.files.length) return; ++requestGeneration;
      assert(event.target.files.length <= 2, 'Choose one comparison.json and optionally one matching leaderboard.json.');
      const loaded = []; for (const file of event.target.files) { assert(file.size <= MAX_BYTES, `${file.name} exceeds 10 MB.`); loaded.push(validate(JSON.parse(await file.text()))); }
      assert(new Set(loaded.map(item => item.kind)).size === loaded.length, 'Choose only one export of each kind.');
      const selectedComparison = loaded.find(item => item.kind === 'comparison')?.data, selectedBoard = loaded.find(item => item.kind === 'leaderboard')?.data;
      const comparison = selectedComparison || state.comparison;
      let shared = selectedBoard || state.shared;
      if (selectedComparison && !selectedBoard && shared?.dataset_id !== comparison.dataset_id) shared = null;
      assert(!comparison || !shared || comparison.dataset_id === shared.dataset_id, 'The selected leaderboard and comparison belong to different datasets. Reload or choose matching exports.');
      state.comparison = comparison; state.shared = shared; state.preview = true; indexComparison(); render();
      set('status', 'Browser-local preview only. Nothing was uploaded or saved to the shared leaderboard. Reload returns to published results.');
    } catch (error) { set('status', `Preview rejected: ${error.message}`); } finally { event.target.value = ''; }
  });
  $('reload')?.addEventListener('click', reload);
  $('split')?.addEventListener('change', () => { renderExperiments(); renderTradeoff(); renderJetChoices(); });
  $('support')?.addEventListener('change', renderJetChoices); $('jet')?.addEventListener('change', renderJet); $('threshold')?.addEventListener('input', renderThreshold);
  setInterval(async () => {
    if (document.hidden || state.preview || location.protocol === 'file:') return;
    try { const updated = await fetchJSON('leaderboard.json'); if (state.preview || !updated || updated.kind !== 'leaderboard') return;
      if (state.comparison && updated.data.dataset_id !== state.comparison.dataset_id) { set('status', 'A leaderboard for another dataset was ignored.'); return; }
      const firstResults = !analysis(); state.shared = updated.data; render();
      if (firstResults) set('status', 'Shared final results loaded. Load comparison.json to inspect particle measurements and predictions.');
    } catch (error) { set('status', `Leaderboard refresh unavailable; keeping the last view. ${error.message}`); }
  }, 30000);
  if (location.protocol === 'file:') {
    $('reload').disabled = true;
    render();
    set('status', 'Open data/05_analytics/comparison.json using Preview a results file. Everything stays in your browser.');
  } else reload();
})();
