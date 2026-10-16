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
  async emit(type) { for (const handler of this.listeners[type] || []) await handler({ target: this }); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(node => node.textContent || '').join(''); }
  set value(value) { this._value = String(value); }
  get value() { return this._value ?? (this.tagName === 'SELECT' ? this.children[0]?.value || '' : ''); }
}
function viewer(protocol = 'file:') {
  const nodes = Object.fromEntries([...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"/g)].map(([, tag, id]) => [id, new Element(tag)]));
  nodes.threshold.value = '0.5';
  const calls = [], window = {};
  const sandbox = { window, location: { protocol }, TextDecoder,
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
  for (const row of fixture.experiments) assert.match(app.nodes.experiment.textContent, new RegExp(row.run_id));
  const selected = fixture.experiments[1]; app.nodes.experiment.value = selected.experiment_key; await app.nodes.experiment.emit('change');
  assert.equal(app.window.__workshopView.selectedExperiment, selected.experiment_key);
  assert.match(app.nodes['experiment-model'].textContent, /xgboost/);
  assert.match(app.nodes['experiment-features'].textContent, /jet_sdmass/);
  assert.match(app.nodes['experiment-parameters'].textContent, /n_estimators = 100/);
  app.nodes.baseline.value = selected.experiment_key; await app.nodes.baseline.emit('change');
  assert.equal(app.nodes['auc-delta'].textContent, 'Selected baseline.');
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
  assert.match(app.nodes['auc-delta'].textContent, /Choose a comparison baseline/);
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
