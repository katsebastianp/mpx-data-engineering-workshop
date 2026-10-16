/* Lightweight DOM harness for local-file interactions; no browser or model runtime. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'comparison.json'), 'utf8'));

class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.style = {}; this.attributes = {}; this.hidden = false; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; this._value = undefined; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  async emit(type, details = {}) { for (const handler of this.listeners[type] || []) await handler({ target: this, type, preventDefault() {}, ...details }); }
  focus() { this.focused = true; }
  setPointerCapture(id) { this.pointerCapture = id; }
  hasPointerCapture(id) { return this.pointerCapture === id; }
  releasePointerCapture() { this.pointerCapture = null; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(node => node.textContent || '').join(''); }
  set value(value) { this._value = String(value); }
  get value() { return this._value ?? (this.tagName === 'SELECT' ? this.children[0]?.value || '' : ''); }
}
function viewer(protocol = 'file:', embedded = '', supportControl = false) {
  const nodes = Object.fromEntries([...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"/g)].map(([, tag, id]) => [id, new Element(tag)]));
  if (supportControl) nodes.support = new Element('input');
  nodes.threshold.value = '0.5';
  nodes['model-explorer-data'].textContent = embedded;
  const calls = [], window = {};
  const sandbox = { window, location: { protocol }, TextDecoder, TextEncoder,
    document: { getElementById: id => nodes[id] || null, createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) },
    fetch: async filename => { calls.push(filename); return new Response(fs.readFileSync(path.join(__dirname, filename)), { status: 200 }); },
  };
  vm.runInNewContext(source, sandbox, { filename: 'app.js' });
  return { nodes, calls, window, async open(data) {
    const json = JSON.stringify(data);
    nodes.file.files = [{ name: 'comparison.json', size: Buffer.byteLength(json), text: async () => json }];
    await nodes.file.emit('change');
  } };
}
function expectedConfusion(data, experiment, threshold) {
  const truth = new Map(data.population.filter(row => row.split === 'validation').map(row => [row.record_id, row.truth_group]));
  const result = { tp: 0, fn: 0, fp: 0, tn: 0 };
  for (const row of data.predictions.filter(row => row.experiment_key === experiment && row.split === 'validation')) {
    const signal = truth.get(row.record_id) === 'signal';
    result[signal ? row.signal_score >= threshold ? 'tp' : 'fn' : row.signal_score >= threshold ? 'fp' : 'tn']++;
  }
  return result;
}

test('local and hosted pages start empty without fetching historical examples', () => {
  for (const protocol of ['file:', 'https:']) {
    const app = viewer(protocol);
    assert.equal(app.calls.length, 0);
    assert.equal(app.nodes.content.hidden, true);
    assert.equal(app.nodes.empty.hidden, false);
    assert.equal(app.nodes.reload.hidden, protocol === 'file:');
  }
});
test('hosted examples require an explicit action and remain clearly labeled', async () => {
  const app = viewer('https:');
  await app.nodes.reload.emit('click');
  assert.deepEqual(app.calls, ['comparison.json', 'leaderboard.json']);
  assert.match(app.nodes.status.textContent, /Historical example results/);
  assert.match(app.nodes.dataset.textContent, /Historical examples/);
});
test('file selection exposes actual model metadata, run IDs and a selectable baseline', async () => {
  const app = viewer(); await app.open(fixture);
  assert.equal(app.calls.length, 0);
  assert.equal(app.nodes.content.hidden, false);
  assert.equal(app.nodes.experiment.children.length, fixture.experiments.length);
  assert.equal(app.window.__workshopView.baselineExperiment, fixture.experiments[0].experiment_key);
  for (const row of fixture.experiments) {
    const option = app.nodes.experiment.children.find(item => item.value === row.experiment_key);
    assert.equal(option.textContent, `${row.experiment_id} · ${row.feature_names.length} features`);
    assert.match(option.attributes.title, new RegExp(row.run_id));
    assert.equal(option.attributes['aria-label'], option.attributes.title);
  }
  const selected = fixture.experiments[1]; app.nodes.experiment.value = selected.experiment_key; await app.nodes.experiment.emit('change');
  assert.equal(app.window.__workshopView.selectedExperiment, selected.experiment_key);
  assert.match(app.nodes['experiment-model'].textContent, /xgboost/);
  assert.match(app.nodes['experiment-features'].textContent, /jet_sdmass/);
  assert.match(app.nodes['experiment-parameters'].textContent, /n_estimators = 100/);
  app.nodes.baseline.value = selected.experiment_key; await app.nodes.baseline.emit('change');
  assert.equal(app.nodes['auc-delta'].textContent, 'Baseline');
});
test('experiment and baseline options include run IDs only to disambiguate repeated experiment names', async () => {
  const data = structuredClone(fixture); data.experiments[1].experiment_id = data.experiments[0].experiment_id;
  const app = viewer(); await app.open(data);
  for (const picker of [app.nodes.experiment, app.nodes.baseline]) for (const row of data.experiments) {
    const option = picker.children.find(item => item.value === row.experiment_key);
    assert.equal(option.textContent, `${row.experiment_id} · ${row.feature_names.length} features · ${row.run_id}`);
    assert.ok(option.attributes.title.includes(row.team));
  }
  assert.equal(app.nodes['operating-point'].children[0].children.filter(node => node.tagName === 'H3').length, 0);
});
test('only the selected confusion matrix changes at thresholds 0, 0.5 and 1; validation AUC stays fixed', async () => {
  const app = viewer(); await app.open(fixture);
  for (const experiment of fixture.experiments) {
    app.nodes.experiment.value = experiment.experiment_key; await app.nodes.experiment.emit('change');
    const savedAuc = app.nodes['selected-auc'].textContent;
    const comparison = app.nodes.experiments.textContent;
    for (const threshold of [0, .5, 1]) {
      app.nodes.threshold.value = String(threshold); await app.nodes.threshold.emit('input');
      const points = app.window.__workshopView.operatingPoints;
      assert.equal(points.length, 1);
      assert.equal(points[0].experiment_key, experiment.experiment_key);
      assert.equal(points[0].rows, 1000);
      assert.deepEqual(JSON.parse(JSON.stringify(points[0].confusion)), expectedConfusion(fixture, experiment.experiment_key, threshold));
      assert.equal(app.nodes['selected-auc'].textContent, savedAuc);
      assert.equal(app.nodes.experiments.textContent, comparison);
    }
  }
  assert.equal(app.nodes['split-control'].hidden, true);
  assert.equal(app.nodes.leaderboard.hidden, true);
});
test('custom model metadata is displayed without assuming an absent logistic baseline', async () => {
  const data = structuredClone(fixture), selected = data.experiments[0];
  selected.model = 'random_forest'; selected.trained = true; selected.experiment_id = 'forest-planned';
  selected.parameters = { bootstrap: true, max_features: null, criterion: 'gini' };
  const app = viewer(); await app.open(data);
  assert.equal(app.window.__workshopView.baselineExperiment, '');
  assert.equal(app.nodes['experiment-model'].textContent, 'random_forest');
  assert.match(app.nodes['experiment-parameters'].textContent, /bootstrap = true/);
  assert.match(app.nodes['experiment-parameters'].textContent, /max_features = null/);
  assert.match(app.nodes['auc-delta'].textContent, /Choose a baseline/);
});
test('table controls select the corresponding saved experiment', async () => {
  const app = viewer(); await app.open(fixture);
  await app.nodes.experiments.children[1].children[0].children[0].emit('click');
  assert.equal(app.window.__workshopView.selectedExperiment, fixture.experiments[1].experiment_key);
});
test('invalid data is rejected without replacing the prior valid result', async () => {
  const damages = [
    data => data.predictions.pop(),
    data => data.predictions.push(data.predictions[0]),
    data => { data.experiments[0].feature_names = ['truth/invalid']; },
    data => { data.experiments[0].parameters = { code: 'execute' }; },
    data => { data.experiments[0].model = 'custom'; delete data.experiments[0].trained; },
    data => { const id = data.population[0].record_id; data.population.shift(); data.predictions = data.predictions.filter(row => row.record_id !== id); data.jets = data.jets.filter(row => row.record_id !== id); },
  ];
  const app = viewer(); await app.open(fixture);
  for (const damage of damages) {
    const invalid = structuredClone(fixture); damage(invalid); await app.open(invalid);
    assert.match(app.nodes.status.textContent, /Preview rejected/);
    assert.equal(app.window.__workshopView.population, 1000);
    assert.equal(app.window.__workshopView.predictions, 2000);
  }
});

test('final-test controls appear only for saved test results and never replace validation comparison', async () => {
  // Synthetic test-split copies verify UI routing; they are not published model results.
  const data = structuredClone(fixture);
  data.population.push(...data.population.map(row => ({ ...row, split: 'test', record_id: `test-${row.record_id}` })));
  data.predictions.push(...data.predictions.map(row => ({ ...row, split: 'test', record_id: `test-${row.record_id}` })));
  for (const row of data.experiments) {
    row.evaluated_splits = ['validation', 'test']; row.test_selection = 'final';
    row.metrics.test = structuredClone(row.metrics.validation);
  }
  const app = viewer(); await app.open(data);
  assert.equal(app.nodes['split-control'].hidden, false);
  assert.equal(app.nodes.leaderboard.hidden, false);
  const validationTable = app.nodes.experiments.textContent;
  app.nodes.split.value = 'test'; await app.nodes.split.emit('change');
  assert.equal(app.window.__workshopView.operatingPoints[0].split, 'test');
  assert.equal(app.window.__workshopView.operatingPoints[0].rows, 1000);
  assert.equal(app.nodes.experiments.textContent, validationTable);
});

test('embedded comparison autoloads every experiment without a picker or network request', () => {
  // A third synthetic entry exercises custom classifier metadata and all-row rendering.
  const data = structuredClone(fixture), third = structuredClone(data.experiments[0]);
  third.experiment_key = 'synthetic-third'; third.experiment_id = 'planned-tree';
  third.run_id = 'synthetic-third-run'; third.model = 'decision_tree'; third.trained = true;
  third.parameters = { criterion: 'gini', max_depth: 3 };
  data.experiments.push(third);
  data.predictions.push(...data.predictions.filter(row => row.experiment_key === data.experiments[0].experiment_key).map(row => ({ ...row, experiment_key: third.experiment_key })));
  for (const protocol of ['file:', 'https:']) {
    const app = viewer(protocol, JSON.stringify(data));
    assert.equal(app.calls.length, 0);
    assert.equal(app.nodes.content.hidden, false);
    assert.equal(app.nodes.empty.hidden, true);
    assert.equal(app.nodes['import-controls'].hidden, true);
    assert.equal(app.nodes['import-help'].hidden, true);
    assert.equal(app.nodes.experiments.children.length, 3);
    assert.equal(app.nodes.experiment.children.length, 3);
    assert.equal(app.window.__workshopView.selectedExperiment, data.experiments[0].experiment_key);
    assert.equal(app.window.__workshopView.baselineExperiment, data.experiments[0].experiment_key);
    assert.equal(app.nodes.baseline.value, data.experiments[0].experiment_key);
    assert.equal(app.nodes['auc-delta'].textContent, 'Baseline');
    assert.equal(app.window.__workshopView.predictions, 3000);
    assert.equal(app.window.__workshopView.operatingPoints[0].rows, 1000);
    for (const row of data.experiments) assert.ok(app.nodes.experiments.textContent.includes(row.run_id));
  }
  assert.ok(html.indexOf('id="experiments-section"') < html.indexOf('id="experiment-section"'));
});

function smallComparison() {
  // Deliberately unequal classes and exact score boundaries; no display jets.
  const data = structuredClone(fixture);
  data.jets = [];
  data.population = Array.from({ length: 6 }, (_, index) => ({ record_id: `edge-${index}`, split: 'validation',
    truth_group: index < 2 ? 'signal' : 'background', truth_label: index < 2 ? 0 : 161,
    in_training_support: index < 4, particles_truncated: false }));
  const scores = [[0, .5, .5, .5, 1, 0], [1, 1, .25, .25, .25, .25]];
  data.predictions = data.experiments.flatMap((experiment, model) => data.population.map((row, index) => ({
    split: row.split, record_id: row.record_id, experiment_key: experiment.experiment_key, signal_score: scores[model][index] })));
  for (const experiment of data.experiments) experiment.metrics.validation.rows = data.population.length;
  return data;
}
const sum = values => values.reduce((total, value) => total + value, 0);

test('histograms count all predictions rather than display jets and each class totals 100 percent', async () => {
  const app = viewer(); await app.open(fixture);
  const histogram = app.window.__workshopView.scoreDistribution;
  assert.equal(sum(histogram.signal.counts) + sum(histogram.background.counts), 1000);
  assert.equal(app.window.__workshopView.displayJets, fixture.jets.length);
  assert.ok(app.window.__workshopView.displayJets < 1000);
  for (const group of [histogram.signal, histogram.background]) {
    assert.equal(sum(group.counts), group.count);
    assert.ok(Math.abs(sum(group.percent) - 100) < 1e-10);
  }
  assert.match(app.nodes['score-distribution'].textContent, /% within each class \/ bin/);
  assert.equal(app.nodes['signal-count'].textContent, String(histogram.signal.count));
  assert.equal(app.nodes['background-count'].textContent, String(histogram.background.count));
});

test('unequal-class bins handle scores 0, 0.5 and 1 while exact threshold ties predict signal', async () => {
  const data = smallComparison(), app = viewer(); await app.open(data);
  const histogram = app.window.__workshopView.scoreDistribution;
  assert.equal(histogram.bins, 32);
  assert.equal(histogram.signal.count, 2); assert.equal(histogram.background.count, 4);
  assert.equal(histogram.signal.counts[0], 1); assert.equal(histogram.signal.counts[16], 1);
  assert.equal(histogram.background.counts[0], 1); assert.equal(histogram.background.counts[16], 2); assert.equal(histogram.background.counts[31], 1);
  assert.equal(histogram.signal.percent[0], 50); assert.equal(histogram.background.percent[0], 25);
  assert.equal(sum(histogram.signal.percent), 100); assert.equal(sum(histogram.background.percent), 100);
  const expected = [[0, { tp: 2, fn: 0, fp: 4, tn: 0 }], [.5, { tp: 1, fn: 1, fp: 3, tn: 1 }], [1, { tp: 0, fn: 2, fp: 1, tn: 3 }]];
  for (const [threshold, confusion] of expected) {
    app.nodes.threshold.value = String(threshold); await app.nodes.threshold.emit('input');
    assert.deepEqual(JSON.parse(JSON.stringify(app.window.__workshopView.operatingPoints[0].confusion)), confusion);
    const line = app.nodes['score-distribution'].children.find(node => node.attributes.class === 'threshold-line');
    const region = app.nodes['score-distribution'].children.find(node => node.attributes.class === 'threshold-region');
    assert.equal(Number(line.attributes.x1), 52 + threshold * 568);
    assert.equal(Number(region.attributes.x), 52 + threshold * 568);
    assert.equal(Number(region.attributes.width), 568 * (1 - threshold));
  }
});

test('distribution follows model, split and optional support selection without changing validation comparison', async () => {
  const data = smallComparison(), first = data.experiments[0], second = data.experiments[1];
  const testRows = data.population.map(row => ({ ...row, split: 'test', record_id: `test-${row.record_id}` }));
  data.population.push(...testRows);
  data.predictions.push(...testRows.map(row => ({ split: 'test', record_id: row.record_id,
    experiment_key: first.experiment_key, signal_score: row.truth_group === 'signal' ? 1 : 0 })));
  first.evaluated_splits = ['validation', 'test']; first.test_selection = 'final'; first.metrics.test = { ...first.metrics.validation };
  const app = viewer('file:', '', true); await app.open(data);
  const validationTable = app.nodes.experiments.textContent;
  app.nodes.split.value = 'test'; await app.nodes.split.emit('change');
  assert.equal(app.window.__workshopView.scoreDistribution.signal.counts[31], 2);
  assert.equal(app.window.__workshopView.scoreDistribution.background.counts[0], 4);
  assert.equal(app.window.__workshopView.operatingPoints[0].split, 'test');
  assert.equal(app.nodes.experiments.textContent, validationTable);
  app.nodes.experiment.value = second.experiment_key; await app.nodes.experiment.emit('change');
  assert.equal(app.nodes.split.value, 'validation');
  assert.equal(app.window.__workshopView.scoreDistribution.background.counts[8], 4);
  assert.equal(app.window.__workshopView.scoreDistribution.signal.counts[31], 2);
  app.nodes.support.checked = true; await app.nodes.support.emit('change');
  assert.equal(app.window.__workshopView.scoreDistribution.background.counts[8], 2);
  assert.equal(app.window.__workshopView.scoreDistribution.background.percent[8], 100);
  assert.equal(app.window.__workshopView.operatingPoints[0].rows, 4);
});

test('pointer capture maps scaled SVG coordinates at any plot height and preserves native input events', async () => {
  const app = viewer(); await app.open(smallComparison());
  const svg = app.nodes['score-distribution'], input = app.nodes.threshold;
  // Mimic an SVG scaled to half size with horizontal/vertical page offsets.
  svg.getScreenCTM = () => ({ inverse: () => ({ scale: .5, left: 100, top: 70 }) });
  svg.createSVGPoint = () => ({ matrixTransform(matrix) { return { x: (this.x - matrix.left) / matrix.scale, y: (this.y - matrix.top) / matrix.scale }; } });
  const point = (score, y, pointerId = 7) => ({ isPrimary: true, button: 0, pointerId,
    clientX: 100 + (52 + score * 568) / 2, clientY: 70 + y / 2 });
  await input.emit('pointerdown', point(.2, 41));
  assert.equal(app.window.__workshopView.threshold, .2); assert.equal(input.focused, true); assert.equal(input.pointerCapture, 7);
  await input.emit('pointermove', point(.8, 245));
  assert.equal(app.window.__workshopView.threshold, .8);
  await input.emit('pointermove', point(.1, 80, 8));
  assert.equal(app.window.__workshopView.threshold, .8);
  await input.emit('pointerup', point(1.2, 100));
  assert.equal(app.window.__workshopView.threshold, 1); assert.equal(input.pointerCapture, null);
  await input.emit('pointerdown', point(-.2, 200));
  assert.equal(app.window.__workshopView.threshold, 0);
  await input.emit('pointercancel', point(.5, 120));
  assert.equal(input.pointerCapture, null); assert.equal(app.window.__workshopView.threshold, 0);
  input.value = '.43'; await input.emit('input'); // Native keyboard events use the same input handler.
  assert.equal(app.window.__workshopView.threshold, .43);
  assert.equal(app.nodes.experiments.children.length, 2);
});
test('invalid embedded data stays empty, reports an error and permits manual recovery without fetching', async () => {
  const incomplete = structuredClone(fixture); incomplete.predictions.pop();
  const leaderboard = { version: 1, dataset_id: fixture.dataset_id, experiments: [], leaderboard: { quality: [], efficiency: [] } };
  for (const embedded of ['{bad JSON', JSON.stringify(incomplete), JSON.stringify(leaderboard)]) {
    const app = viewer('file:', embedded);
    assert.equal(app.calls.length, 0);
    assert.equal(app.nodes.content.hidden, true);
    assert.equal(app.nodes.empty.hidden, false);
    assert.equal(app.nodes['import-controls'].hidden, false);
    assert.match(app.nodes.status.textContent, /Embedded results rejected/);
    await app.open(fixture);
    assert.equal(app.nodes.content.hidden, false);
    assert.equal(app.window.__workshopView.predictions, 2000);
    assert.equal(app.calls.length, 0);
  }
});
