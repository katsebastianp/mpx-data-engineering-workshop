/* Saved exports only. Local files stay in this browser; no uploads or model calls. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), MAX_BYTES = 10 * 1024 * 1024;
  const state = { comparison: null, shared: null, preview: false, population: new Map(), scores: new Map(), selected: null, baseline: undefined, example: false };
  const number = value => typeof value === 'number' && Number.isFinite(value);
  const text = value => typeof value === 'string' && value.length <= 2000;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const key = (split, id) => `${split}\0${id}`;
  const format = (value, digits = 3) => number(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
  const el = (tag, value, className) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (className) node.className = className; return node; };
  const set = (id, value) => { if ($(id)) $(id).textContent = value; };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const isTrained = experiment => experiment.model !== 'sophon' && (typeof experiment.trained === 'boolean' ? experiment.trained : ['logistic', 'xgboost'].includes(experiment.model));
  const modelLabel = experiment => isTrained(experiment) ? experiment.model : `${experiment.model === 'sophon' ? 'Sophon' : experiment.model} (frozen reference)`;
  const label = experiment => `${experiment.experiment_id || experiment.feature_set} · ${modelLabel(experiment)} · ${experiment.run_id} · ${experiment.team}`;
  const splitNames = ['validation', 'test'];
  let requestGeneration = 0;

  function validate(data) {
    assert(object(data) && data.version === 1 && /^[a-f0-9]{64}$/.test(data.dataset_id || ''), 'Choose a version-1 comparison.json or leaderboard.json export.');
    if (!object(data.leaderboard) || !Array.isArray(data.experiments)) throw new Error('This looks like a submission. Run the postprocessing step to preview it, or upload the JSON to the workshop leaderboard while signed in.');
    assert(data.experiments.length <= 500 && Array.isArray(data.leaderboard.quality) && Array.isArray(data.leaderboard.efficiency), 'The results export has an invalid experiment or ranking list.');
    const experiments = new Map();
    for (const row of data.experiments) {
      assert(object(row) && text(row.experiment_key) && text(row.team) && text(row.model) && text(row.run_id) && text(row.feature_set) && object(row.metrics) && object(row.timings), 'An experiment is missing its result fields.');
      assert(/^[a-z][a-z0-9_-]{0,63}$/.test(row.model) && (typeof row.trained === 'boolean' || row.trained === undefined && ['logistic', 'xgboost', 'sophon'].includes(row.model)), 'New model identifiers require a trained boolean. Regenerate the results export.');
      assert(text(row.experiment_id) && Array.isArray(row.feature_names) && row.feature_names.length > 0 && row.feature_names.length <= 100 && row.feature_names.every(name => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) && new Set(row.feature_names).size === row.feature_names.length && object(row.parameters) && Object.keys(row.parameters).length <= 100 && Number.isInteger(row.seed), 'An experiment has invalid feature, parameter or seed metadata.');
      for (const [name, value] of Object.entries(row.parameters)) assert(/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) && !/(?:^|_)(?:path|dir|directory|file|filename|code|script|command|url)(?:_|$)/i.test(name) && !['constructor', 'prototype'].includes(name) && (value === null || typeof value === 'boolean' || number(value) || typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)), 'Parameters must be bounded scalar settings, not paths or code.');
      assert(!experiments.has(row.experiment_key), 'Duplicate experiment identifiers; regenerate the export.');
      assert(Array.isArray(row.evaluated_splits) && ['["validation"]', '["validation","test"]'].includes(JSON.stringify(row.evaluated_splits)) && row.test_selection === (row.evaluated_splits.includes('test') ? 'final' : 'not_evaluated'), 'An experiment has an unsupported evaluation split.');
      for (const split of row.evaluated_splits) assert(object(row.metrics[split]) && number(row.metrics[split].roc_auc) && row.metrics[split].roc_auc >= 0 && row.metrics[split].roc_auc <= 1, 'A saved ROC-AUC is invalid.');
      assert(number(row.timings.normalized_inference_time) && row.timings.normalized_inference_time > 0 && number(row.timings.training_seconds) && row.timings.training_seconds >= 0 && number(row.timings.per_jet_ms) && row.timings.per_jet_ms > 0, 'An experiment has invalid timing values.');
      assert(row.explanation === undefined || text(row.explanation), 'An experiment explanation is too long.');
      experiments.set(row.experiment_key, row);
    }
    for (const entries of [data.leaderboard.quality, data.leaderboard.efficiency]) {
      assert(entries.length <= 500, 'The ranking list is too large.');
      for (const row of entries) assert(object(row) && text(row.team) && text(row.run_id) && text(row.model) && number(row.rank) && number(row.test_auc) && number(row.normalized_inference_time) && isTrained(row) && [...experiments.values()].some(experiment => experiment.team === row.team && experiment.run_id === row.run_id && experiment.model === row.model && isTrained(experiment) && experiment.test_selection === 'final' && experiment.evaluated_splits.includes('test')), 'Rankings must refer to trained models with explicit final test selections.');
    }
    if (!('population' in data || 'jets' in data)) return { kind: 'leaderboard', data };
    assert(Array.isArray(data.population) && data.population.length <= 20000 && Array.isArray(data.predictions) && data.predictions.length <= 100000 && Array.isArray(data.jets) && data.jets.length <= 200, 'Comparison arrays are missing or exceed the bounded export size.');
    const population = new Map(), predictions = new Set(), counts = new Map();
    for (const row of data.population) {
      assert(object(row) && text(row.record_id) && splitNames.includes(row.split) && ['signal', 'background'].includes(row.truth_group) && Number.isInteger(row.truth_label) && (row.truth_group === 'signal' ? row.truth_label === 0 : row.truth_label >= 161 && row.truth_label <= 187) && typeof row.in_training_support === 'boolean' && typeof row.particles_truncated === 'boolean', 'A population record is invalid.');
      const id = key(row.split, row.record_id); assert(!population.has(id), 'Duplicate population records.'); population.set(id, row);
    }
    for (const row of data.predictions) {
      assert(object(row) && experiments.has(row.experiment_key) && population.has(key(row.split, row.record_id)) && experiments.get(row.experiment_key).evaluated_splits.includes(row.split) && number(row.signal_score) && row.signal_score >= 0 && row.signal_score <= 1, 'A prediction has an unknown record or invalid score.');
      const id = `${row.experiment_key}\0${key(row.split, row.record_id)}`; assert(!predictions.has(id), 'Duplicate prediction records.'); predictions.add(id);
      const group = key(row.split, row.experiment_key); counts.set(group, (counts.get(group) || 0) + 1);
    }
    for (const experiment of experiments.values()) for (const split of experiment.evaluated_splits) assert(counts.get(key(split, experiment.experiment_key)) === data.population.filter(row => row.split === split).length && counts.get(key(split, experiment.experiment_key)) === experiment.metrics[split].rows, 'Predictions do not cover the complete population. Regenerate comparison.json with the postprocessing step.');
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
  const analysis = () => state.comparison || state.shared;
  const selectedExperiment = () => analysis()?.experiments.find(row => row.experiment_key === state.selected);
  const baselineExperiment = () => analysis()?.experiments.find(row => row.experiment_key === state.baseline);
  function selectExperiment(identifier) { state.selected = identifier; render(); }
  function renderSelection() {
    const experiments = analysis()?.experiments || [], select = $('experiment'), baseline = $('baseline');
    if (!experiments.some(row => row.experiment_key === state.selected)) state.selected = experiments[0]?.experiment_key || null;
    if (state.baseline === undefined) {
      const candidates = experiments.filter(row => row.model === 'logistic' && row.experiment_id === 'linear-basic' && row.feature_names.length === 3 && ['jet_pt', 'jet_sdmass', 'particle_count'].every(name => row.feature_names.includes(name)));
      state.baseline = candidates.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))[0]?.experiment_key || '';
    }
    if (state.baseline && !experiments.some(row => row.experiment_key === state.baseline)) state.baseline = '';
    select.replaceChildren(); baseline.replaceChildren();
    const empty = el('option', 'Choose a baseline'); empty.value = ''; baseline.append(empty);
    for (const row of experiments) {
      for (const picker of [select, baseline]) { const option = el('option', label(row)); option.value = row.experiment_key; picker.append(option); }
    }
    select.value = state.selected || ''; baseline.value = state.baseline; select.disabled = baseline.disabled = !experiments.length;
    const split = $('split'), previous = split.value; split.replaceChildren();
    for (const name of selectedExperiment()?.evaluated_splits || ['validation']) { const option = el('option', name === 'test' ? 'Final test' : 'Validation'); option.value = name; split.append(option); }
    split.value = selectedExperiment()?.evaluated_splits.includes(previous) ? previous : 'validation';
    $('split-control').hidden = !selectedExperiment()?.evaluated_splits.includes('test');
    set('experiment-count', `${experiments.length} saved experiment${experiments.length === 1 ? '' : 's'}`);
  }
  function renderOverview() {
    const row = selectedExperiment(), baseline = baselineExperiment();
    set('experiment-model', row ? modelLabel(row) : 'No experiment selected');
    set('experiment-run', row ? `Run ${row.run_id} · seed ${row.seed}` : '');
    set('experiment-explanation', row?.explanation && !row.explanation.startsWith('Replace this with') ? row.explanation : 'No experiment explanation was saved.');
    $('experiment-features').replaceChildren(); $('experiment-parameters').replaceChildren();
    for (const name of row?.feature_names || []) $('experiment-features').append(el('code', name));
    for (const [name, value] of Object.entries(row?.parameters || {})) $('experiment-parameters').append(el('code', `${name} = ${JSON.stringify(value)}`));
    if (!Object.keys(row?.parameters || {}).length) $('experiment-parameters').append(el('span', 'No parameter settings recorded.', 'small'));
    set('selected-auc', format(row?.metrics.validation?.roc_auc, 4));
    set('selected-training', row ? `${format(row.timings.training_seconds, 4)} s` : '—');
    set('selected-inference', row ? `${format(row.timings.per_jet_ms, 6)} ms` : '—');
    const delta = (value, reference, unit, digits) => {
      if (!baseline) return 'Choose a comparison baseline.';
      if (row === baseline) return 'Selected baseline.';
      if (!number(value) || !number(reference)) return 'No matching baseline measurement.';
      const difference = value - reference;
      return `${difference > 0 ? '+' : difference < 0 ? '−' : ''}${format(Math.abs(difference), digits)}${unit} vs ${baseline.experiment_id}`;
    };
    set('auc-delta', delta(row?.metrics.validation?.roc_auc, baseline?.metrics.validation?.roc_auc, '', 4));
    set('training-delta', delta(row?.timings.training_seconds, baseline?.timings.training_seconds, ' s', 4));
    set('inference-delta', delta(row?.timings.per_jet_ms, baseline?.timings.per_jet_ms, ' ms', 6));
    set('baseline-note', baseline ? `Comparison baseline: ${baseline.experiment_id}. Its saved feature list and parameters are available in the experiment selector.` : 'Choose a comparison baseline to see the differences.');
  }
  const rankingSource = () => state.shared && (!state.comparison || state.shared.dataset_id === state.comparison.dataset_id) ? state.shared : state.comparison;
  const tableRow = values => { const row = el('tr'); for (const value of values) row.append(el('td', value)); return row; };
  function emptyTable(id, columns, message) { const row = el('tr'), cell = el('td', message); cell.colSpan = columns; row.append(cell); $(id)?.append(row); }
  function renderRankings() {
    const board = rankingSource()?.leaderboard, quality = (board?.quality || []).filter(isTrained), efficiency = (board?.efficiency || []).filter(isTrained);
    $('leaderboard').hidden = !(analysis()?.experiments || []).some(row => row.evaluated_splits.includes('test')) && !quality.length;
    $('rankings')?.replaceChildren();
    for (const row of quality) {
      const efficient = efficiency.find(item => item.team === row.team);
      $('rankings')?.append(tableRow([row.rank, row.team, row.model, format(row.test_auc, 4), format(row.normalized_inference_time, 6), efficient ? efficient.rank : 'Outside quality margin']));
    }
    if (!quality.length) emptyTable('rankings', 6, 'No trained final-test selections in this export.');
  }
  function renderExperiments() {
    const experiments = analysis()?.experiments || []; $('experiments').replaceChildren();
    for (const experiment of experiments) {
      const row = el('tr'), cell = el('td'), button = el('button', experiment.experiment_id, 'experiment-link');
      button.type = 'button'; button.setAttribute('aria-pressed', String(experiment.experiment_key === state.selected));
      button.addEventListener('click', () => selectExperiment(experiment.experiment_key)); cell.append(button);
      cell.append(el('small', experiment.run_id, 'run-label')); row.append(cell);
      if (experiment.experiment_key === state.selected) row.className = 'selected-row';
      for (const value of [modelLabel(experiment), `${experiment.feature_names.length} · ${experiment.feature_set}`, format(experiment.metrics.validation?.roc_auc, 4), format(experiment.timings.training_seconds, 4), format(experiment.timings.per_jet_ms, 6)]) row.append(el('td', value));
      $('experiments').append(row);
    }
    if (!experiments.length) emptyTable('experiments', 6, 'No saved experiment results are available.');
  }
  function svgNode(tag, attrs = {}, value) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, item] of Object.entries(attrs)) node.setAttribute(name, String(item));
    if (value !== undefined) node.textContent = value; return node;
  }
  function svgText(svg, x, y, value, attrs = {}) { svg.append(svgNode('text', { x, y, fill: 'currentColor', 'font-size': 11, ...attrs }, value)); }
  function renderTradeoff() {
    const svg = $('tradeoff'); if (!svg) return; svg.replaceChildren();
    const split = 'validation';
    const points = (analysis()?.experiments || []).filter(row => row.metrics[split]);
    svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', 'Saved full-validation ROC-AUC versus inference milliseconds per jet on a logarithmic horizontal axis.');
    if (!points.length) { svgText(svg, 320, 130, `No ${split} results available`, { 'text-anchor': 'middle' }); return; }
    const logs = points.map(row => Math.log10(row.timings.per_jet_ms));
    const lo = Math.min(...logs) - .3, hi = Math.max(...logs) + .3, x = value => 65 + (Math.log10(value) - lo) / (hi - lo) * 540, y = value => 220 - value * 190;
    for (let i = 0; i <= 4; i++) {
      const score = i / 4; svg.append(svgNode('line', { x1: 65, x2: 605, y1: y(score), y2: y(score), stroke: '#d4d4d4' })); svgText(svg, 53, y(score) + 4, score.toFixed(2), { 'text-anchor': 'end' });
      const cost = 10 ** (lo + (hi - lo) * i / 4); svgText(svg, x(cost), 238, cost.toExponential(1), { 'text-anchor': 'middle' });
    }
    svgText(svg, 65, 16, `${split === 'test' ? 'Final test' : 'Validation'} ROC-AUC`); svgText(svg, 335, 263, 'Inference ms / jet · logarithmic · lower is faster', { 'text-anchor': 'middle' });
    for (const row of points) {
      const title = `${label(row)}; ROC-AUC ${format(row.metrics[split].roc_auc, 4)}; inference ${format(row.timings.per_jet_ms, 6)} ms / jet`;
      const dot = svgNode('circle', { cx: x(row.timings.per_jet_ms), cy: y(row.metrics[split].roc_auc), r: row.experiment_key === state.selected ? 8 : 6, fill: row.experiment_key === state.selected ? '#245e8a' : isTrained(row) ? '#161616' : '#777', stroke: '#fff', 'stroke-width': 1, tabindex: 0, role: 'button', 'aria-label': `Inspect ${title}`, 'aria-pressed': String(row.experiment_key === state.selected) });
      if (row.experiment_key === state.baseline) svg.append(svgNode('circle', { cx: x(row.timings.per_jet_ms), cy: y(row.metrics[split].roc_auc), r: 12, fill: 'none', stroke: '#245e8a', 'stroke-width': 1.5 }));
      dot.addEventListener('click', () => selectExperiment(row.experiment_key));
      dot.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectExperiment(row.experiment_key); } });
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
    set('jet-info', `Simulation truth: ${jet.truth.group === 'signal' ? 'X→bb signal' : 'QCD background'} (label ${jet.truth.label}). ${particles.length} particles shown; circle areas scale within this jet.${state.comparison.experiments.some(row => row.model === 'sophon') ? ` ${jet.in_training_support ? 'Within' : 'Outside'} Sophon training range.${jet.particles_truncated ? ' Full arrays are shown; Sophon uses the first 128 particles.' : ''}` : ''}`);
    const scores = state.scores.get(key(split, jet.record_id));
    for (const experiment of state.comparison.experiments.filter(row => row.experiment_key === state.selected || row.experiment_key === state.baseline)) if (scores?.has(experiment.experiment_key)) {
      const score = scores.get(experiment.experiment_key), row = el('div', undefined, 'score-row'), description = `${label(experiment)}: signal score ${format(score, 4)}`;
      const meter = el('div', undefined, 'score-bar'), fill = el('span'); fill.style.width = `${score * 100}%`; meter.append(fill);
      for (const [name, value] of Object.entries({ role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 1, 'aria-valuenow': score, 'aria-label': description })) meter.setAttribute(name, value); row.append(el('span', description), meter); $('scores')?.append(row);
    }
    if (!$('scores')?.children.length) $('scores')?.append(el('p', 'No model scores for this display jet.'));
  }
  function renderThreshold() {
    const threshold = Number($('threshold')?.value ?? .5), split = $('split')?.value || 'validation', supported = $('support')?.checked;
    set('threshold-label', threshold.toFixed(2)); $('operating-point')?.replaceChildren(); const counts = [];
    for (const experiment of (state.comparison?.experiments || []).filter(row => row.experiment_key === state.selected)) {
      if (!experiment.evaluated_splits.includes(split)) continue;
      let signal = 0, retained = 0, background = 0, rejected = 0;
      for (const [id, row] of state.population) {
        if (row.split !== split || (supported && !row.in_training_support)) continue;
        const score = state.scores.get(id)?.get(experiment.experiment_key); if (score === undefined) continue;
        if (row.truth_group === 'signal') { signal++; if (score >= threshold) retained++; } else { background++; if (score < threshold) rejected++; }
      }
      const confusion = { tp: retained, fn: signal - retained, fp: background - rejected, tn: rejected };
      counts.push({ experiment_key: experiment.experiment_key, split, rows: signal + background, signal, retained, background, rejected, confusion });
      const percent = (n, d) => d ? `${format(n / d * 100, 1)}%` : 'unavailable';
      const card = el('article', undefined, 'matrix-card'), matrix = el('table', undefined, 'confusion-matrix');
      matrix.append(el('caption', `Every ${supported ? 'in-range ' : ''}${split} jet · ${signal + background} total`));
      const head = el('thead'), heading = el('tr');
      for (const title of ['Known truth', 'Predict signal', 'Predict background']) {
        const cell = el('th', title); cell.scope = 'col'; heading.append(cell);
      }
      head.append(heading); matrix.append(head);
      const body = el('tbody');
      for (const [truth, cells] of [
        ['Signal', [[confusion.tp, 'Signal kept', 'correct'], [confusion.fn, 'Signal missed', 'mistake']]],
        ['Background', [[confusion.fp, 'False alarm', 'mistake'], [confusion.tn, 'Background rejected', 'correct']]],
      ]) {
        const row = el('tr'), truthCell = el('th', truth); truthCell.scope = 'row'; row.append(truthCell);
        for (const [count, meaning, kind] of cells) {
          const cell = el('td', undefined, kind); cell.append(el('strong', format(count, 0)), el('span', meaning)); row.append(cell);
        }
        body.append(row);
      }
      matrix.append(body);
      card.append(el('h3', label(experiment)), matrix,
        el('p', `Signal kept: ${percent(retained, signal)}. Background rejected: ${percent(rejected, background)}.`, 'small'));
      $('operating-point')?.append(card);
    }
    if (!counts.length) $('operating-point')?.append(el('p', 'Complete prediction data are needed for threshold analysis. Load comparison.json; a leaderboard alone contains no particle scores.'));
    window.__workshopView = { datasetId: analysis()?.dataset_id || null, experiments: analysis()?.experiments.length || 0, selectedExperiment: state.selected, baselineExperiment: state.baseline, population: state.population.size, displayJets: state.comparison?.jets.length || 0, predictions: state.comparison?.predictions.length || 0, threshold, split, supportOnly: Boolean(supported), operatingPoints: counts, browserLocalPreview: state.preview, sharedLeaderboard: Boolean(state.shared && rankingSource() === state.shared) };
  }
  function render() {
    const data = analysis(), available = Boolean(data); if ($('content')) $('content').hidden = !available; if ($('empty')) $('empty').hidden = available;
    set('dataset', data ? `${state.example ? 'Historical examples · ' : ''}Dataset ${data.dataset_id.slice(0, 12)} · simulated collider data` : 'No dataset loaded');
    renderSelection(); renderOverview(); renderRankings(); renderExperiments(); renderTradeoff(); renderJetChoices();
  }
  async function fetchJSON(path) {
    const response = await fetch(path, { cache: 'no-store' }); if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${path} could not be loaded (${response.status}).`);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0, content = '';
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error(`${path} exceeds the 10 MB preview limit.`); } content += decoder.decode(value, { stream: true }); }
    content += decoder.decode(); return validate(JSON.parse(content));
  }
  async function reload() {
    const generation = ++requestGeneration; set('status', 'Loading historical example results…'); state.preview = false; state.example = true;
    const results = await Promise.allSettled([fetchJSON('comparison.json'), fetchJSON('leaderboard.json')]);
    if (generation !== requestGeneration) return;
    state.comparison = results[0].status === 'fulfilled' && results[0].value?.kind === 'comparison' ? results[0].value.data : null;
    state.shared = results[1].status === 'fulfilled' && results[1].value?.kind === 'leaderboard' ? results[1].value.data : null;
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.message);
    if (state.comparison && state.shared && state.comparison.dataset_id !== state.shared.dataset_id) { state.shared = null; errors.push('The shared leaderboard belongs to another dataset and was ignored.'); }
    state.selected = null; state.baseline = undefined; indexComparison(); render();
    set('status', errors.join(' ') || (analysis() ? 'Historical example results loaded (12 October 2026). Open your data/05_analytics/comparison.json to explore your own experiments.' : 'No results loaded. Run the postprocessing step, then open data/05_analytics/comparison.json.'));
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
      state.comparison = comparison; state.shared = selectedBoard || null; state.preview = true; state.example = typeof comparison?.title === 'string' && comparison.title.startsWith('Recorded validation examples:'); state.selected = null; state.baseline = undefined; indexComparison(); render();
      set('status', state.example ? 'Historical example file loaded. Open your data/05_analytics/comparison.json for your actual experiments.' : 'Results loaded.');
    } catch (error) { set('status', `Preview rejected: ${error.message}`); } finally { event.target.value = ''; }
  });
  $('reload')?.addEventListener('click', reload);
  $('experiment').addEventListener('change', event => selectExperiment(event.target.value));
  $('baseline').addEventListener('change', event => { state.baseline = event.target.value; render(); });
  $('split')?.addEventListener('change', renderJetChoices);
  $('support')?.addEventListener('change', renderJetChoices); $('jet')?.addEventListener('change', renderJet); $('threshold')?.addEventListener('input', renderThreshold);
  $('reload').hidden = location.protocol === 'file:';
  render();
  set('status', 'No results loaded.');
  const embedded = $('model-explorer-data')?.textContent.trim();
  if (embedded) {
    try {
      assert(new TextEncoder().encode(embedded).length <= MAX_BYTES, 'Embedded results exceed the 10 MB preview limit.');
      const loaded = validate(JSON.parse(embedded));
      assert(loaded.kind === 'comparison', 'Embedded results require the complete comparison export.');
      state.comparison = loaded.data; state.shared = null; state.preview = true;
      state.example = typeof loaded.data.title === 'string' && loaded.data.title.startsWith('Recorded validation examples:');
      state.selected = null; state.baseline = undefined; indexComparison(); render();
      $('import-controls').hidden = true; $('import-help').hidden = true;
      set('status', state.example ? 'Historical example results.' : 'All saved experiments are shown below.');
    } catch (error) {
      state.comparison = null; indexComparison(); render();
      set('status', `Embedded results rejected: ${error.message}`);
    }
  }
})();
