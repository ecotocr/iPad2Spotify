'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const W = require('../winamp.js');

const root = path.join(__dirname, '..');
const track = (over) => Object.assign({
  is_playing: true,
  progress_ms: 30000,
  item: { id: 'abc123', name: 'Song', duration_ms: 200000, album: { name: 'Album' }, artists: [{ name: 'A' }, { name: 'B' }] }
}, over);
const flatEq = () => ({ on: true, preamp: 50, bands: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50] });

test('fromSpotify maps a playing track', () => {
  const s = W.fromSpotify(track(), 1000);
  assert.strictEqual(s.status, 'playing');
  assert.strictEqual(s.artist, 'A, B');
  assert.strictEqual(s.title, 'Song');
  assert.strictEqual(s.trackId, 'abc123');
  assert.strictEqual(s.durationMs, 200000);
  assert.strictEqual(s.progressMs, 30000);
});

test('fromSpotify maps paused, and a missing item to stopped (not "playing")', () => {
  assert.strictEqual(W.fromSpotify(track({ is_playing: false }), 0).status, 'paused');
  assert.strictEqual(W.fromSpotify({ item: null, is_playing: true }, 0).status, 'stopped');
  assert.strictEqual(W.fromSpotify({ item: null, is_playing: false }, 0).status, 'stopped');
  assert.strictEqual(W.fromSpotify(null, 0).status, 'stopped');
});

test('positionMs advances only while playing and clamps to duration', () => {
  const playing = W.fromSpotify(track(), 1000);
  assert.strictEqual(W.positionMs(playing, 6000), 35000);
  assert.strictEqual(W.positionMs(playing, 1000 + 10 * 60000), 200000);
  const paused = W.fromSpotify(track({ is_playing: false }), 1000);
  assert.strictEqual(W.positionMs(paused, 60000), 30000);
  assert.strictEqual(W.positionMs(W.fromSpotify(null, 0), 5000), 0);
});

test('fromSpotify preserves the original fetch time when entering Winamp mode', () => {
  const s = W.fromSpotify(track({ fetched_at: 1000 }), 12000);
  assert.strictEqual(s.fetchedAt, 1000);
  assert.strictEqual(W.positionMs(s, 11000), 40000);
});

test('spectrum is deterministic, bounded and track-dependent', () => {
  const p = W.trackProfile('abc123');
  const a = W.spectrum(p, 42.5, 200, flatEq(), new Array(19));
  const b = W.spectrum(W.trackProfile('abc123'), 42.5, 200, flatEq(), new Array(19));
  assert.deepStrictEqual(a, b);
  a.forEach((v) => assert.ok(v >= 0 && v <= 1));
  assert.ok(a.some((v) => v > 0.05), 'mid-song spectrum should not be silent');
  const other = W.spectrum(W.trackProfile('zzz999'), 42.5, 200, flatEq(), new Array(19));
  assert.notDeepStrictEqual(a, other);
});

test('spectrum fades in at the start and out at the end of a track', () => {
  const p = W.trackProfile('abc123');
  const sum = (arr) => arr.reduce((s, v) => s + v, 0);
  assert.strictEqual(sum(W.spectrum(p, 0, 200, flatEq(), new Array(19))), 0);
  assert.strictEqual(sum(W.spectrum(p, 200, 200, flatEq(), new Array(19))), 0);
});

test('EQ shapes the spectrum and can be switched off', () => {
  const p = W.trackProfile('abc123');
  const boosted = flatEq();
  boosted.bands[0] = 100;
  const flat = W.spectrum(p, 42.5, 200, flatEq(), new Array(19));
  const bass = W.spectrum(p, 42.5, 200, boosted, new Array(19));
  assert.ok(bass[0] >= flat[0]);
  assert.ok(bass[0] > flat[0] || flat[0] === 1);
  assert.strictEqual(W.eqGainDb(Object.assign(boosted, { on: false }), 0), 0);
  assert.strictEqual(W.eqGainDb(boosted, 0), 0);
  boosted.on = true;
  assert.strictEqual(W.eqGainDb(boosted, 0), 12);
});

test('slider/dB conversion matches Winamp range', () => {
  assert.strictEqual(W.sliderToDb(0), -12);
  assert.strictEqual(W.sliderToDb(50), 0);
  assert.strictEqual(W.sliderToDb(100), 12);
  assert.strictEqual(W.dbToSlider(-12), 0);
  assert.strictEqual(W.dbToSlider(12), 100);
  W.EQ_PRESETS.forEach((p) => p.bands.forEach((db) => assert.ok(Math.abs(db) <= 12, p.name)));
});

test('text glyphs map to TEXT.BMP cells, folding accents and unknown characters', () => {
  assert.deepStrictEqual(W.textGlyphs('A1:'), [[0, 0], [1, 1], [1, 12]]);
  assert.deepStrictEqual(W.textGlyphs('é'), [[0, 4]]);
  assert.deepStrictEqual(W.textGlyphs('Ö'), [[2, 1]]);
  assert.deepStrictEqual(W.textGlyphs('\u4e2d'), [[0, 30]]);
});

test('clock digits and marquee text', () => {
  assert.deepStrictEqual(W.clockDigits(65000), [0, 1, 0, 5]);
  assert.deepStrictEqual(W.clockDigits(200 * 60000), [9, 9, 5, 9]);
  assert.strictEqual(W.marqueeText(W.fromSpotify(track(), 0)), 'A, B - Song (3:20)');
  assert.match(W.marqueeText(W.fromSpotify(null, 0)), /nothing playing/);
});

test('layout docks windows and fits the viewport', () => {
  const all = W.computeLayout({ eq: true, pl: true, md: true }, 1024, 768);
  assert.deepStrictEqual(all.pos.eq, { x: 0, y: 116 });
  assert.deepStrictEqual(all.pos.pl, { x: 0, y: 232 });
  assert.deepStrictEqual(all.pos.md, { x: 275, y: 0, h: 348 });
  assert.ok(all.width * all.scale <= 1024 && all.height * all.scale <= 768);
  const portrait = W.computeLayout({ eq: true, pl: true, md: true }, 768, 1024);
  assert.deepStrictEqual(portrait.pos.md, { x: 0, y: 348, h: 232 });
  assert.ok(portrait.scale > (768 / 550) * 0.96, "stacking beats side-by-side in portrait");
  const main = W.computeLayout({}, 1024, 768);
  assert.strictEqual(main.height, 116);
  assert.strictEqual(main.scale, 3);
  assert.strictEqual(main.pos.md, undefined);
});

test('settings fall back to defaults on corrupt storage', () => {
  const bad = { getItem: () => '{not json' };
  const s = W.loadSettings(bad);
  assert.strictEqual(s.eq.bands.length, 10);
  assert.strictEqual(s.vis, 'analyzer');
  assert.strictEqual(W.loadSettings(null).open.md, true);
});

test('index.html wires Winamp mode without the removed winamp2-js port', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="winamp-toggle"/);
  assert.match(html, /id="winamp"/);
  assert.match(html, /href="winamp\.css/);
  assert.ok(html.indexOf('oldmilk.js') < html.indexOf('winamp.js') && html.indexOf('winamp.js') < html.indexOf('app.js'));
  assert.doesNotMatch(html, /winamp2-js/);
});

test('every skin image referenced by winamp.css exists', () => {
  const css = fs.readFileSync(path.join(root, 'winamp.css'), 'utf8');
  const urls = Array.from(new Set((css.match(/url\(([^)]+)\)/g) || []).map((u) => u.slice(4, -1))));
  assert.ok(urls.length > 10);
  urls.forEach((u) => assert.ok(fs.existsSync(path.join(root, u)), u));
});

test('front-end scripts stay ES5 for iOS 9 Safari', () => {
  ['winamp.js', 'app.js', 'vendor/oldmilk/oldmilk.js', 'public/js/audio-analysis-engine.js', 'public/js/winamp-vis-renderer.js'].forEach((file) => {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(src, /(^|[^.\w])(let|const|class)\s/m, file);
    assert.doesNotMatch(src, /=>|`/, file);
  });
});

test('OldMilk exposes host-driven rendering and no longer starts its own loop', () => {
  const src = fs.readFileSync(path.join(root, 'vendor/oldmilk/oldmilk.js'), 'utf8');
  assert.match(src, /setBands:/);
  assert.match(src, /function render\(timeSec\)/);
  assert.doesNotMatch(src, /requestAnimationFrame/);
  assert.doesNotMatch(src, /__oldmilk/);
});

test('windows snap to each other and to the screen edges like Webamp', () => {
  const main = { x: 100, y: 100, width: 275, height: 116 };
  assert.deepStrictEqual(W.snapBox({ x: 110, y: 222, width: 275, height: 116 }, main), { x: 100, y: 216 });
  assert.deepStrictEqual(W.snapBox({ x: 385, y: 105, width: 275, height: 116 }, main), { x: 375, y: 100 });
  assert.deepStrictEqual(W.snapBox({ x: 600, y: 600, width: 275, height: 116 }, main), { x: undefined, y: undefined });
  assert.deepStrictEqual(W.snapWithin({ x: 8, y: 590, width: 275, height: 116 }, 1000, 700), { x: 0, y: 584 });
});

test('dragging the main window brings docked windows along; others move alone', () => {
  const main = { key: 'main', x: 0, y: 0, width: 275, height: 116 };
  const eq = { key: 'eq', x: 0, y: 116, width: 275, height: 116 };
  const md = { key: 'md', x: 275, y: 0, width: 275, height: 232 };
  const far = { key: 'pl', x: 600, y: 500, width: 275, height: 116 };
  const group = W.connectedWindows([main, eq, md, far], main).map((b) => b.key).sort();
  assert.deepStrictEqual(group, ['eq', 'main', 'md']);
  // A free drag keeps the proposed offset; near another window it snaps flush.
  assert.deepStrictEqual(W.dragOffset([far], [main], { x: -100, y: -100 }, 2000, 2000), { x: -100, y: -100 });
  const snapped = W.dragOffset([far], [main], { x: -320, y: -380 }, 2000, 2000);
  assert.deepStrictEqual({ x: far.x + snapped.x, y: far.y + snapped.y }, { x: 275, y: 116 });
  const clampedToEdge = W.dragOffset([far], [], { x: 0, y: 190 }, 1000, 800);
  assert.strictEqual(far.y + clampedToEdge.y, 800 - 116);
});

test('saved window positions are validated', () => {
  const store = { getItem: () => JSON.stringify({ positions: { main: { x: 10.4, y: 20 }, eq: { x: 'a', y: 1 } } }) };
  const s = W.loadSettings(store);
  assert.deepStrictEqual(s.positions.main, { x: 10, y: 20 });
  assert.strictEqual(s.positions.eq, undefined);
  assert.strictEqual(W.loadSettings(null).positions, null);
});

test('background images are downscaled keeping their aspect ratio', () => {
  assert.deepStrictEqual(W.fitWithin(4000, 3000, 1024), { width: 1024, height: 768 });
  assert.deepStrictEqual(W.fitWithin(800, 600, 1024), { width: 800, height: 600 });
});

test('main menu offers Options, Set background and Exit; no separate exit button', () => {
  const src = fs.readFileSync(path.join(root, 'winamp.js'), 'utf8');
  assert.match(src, />Options<ul>/);
  assert.match(src, /Set background\.\.\.<input type="file" accept="image\/\*"/);
  assert.match(src, /data-action="exit">Exit</);
  assert.doesNotMatch(src, /wa-exit/);
  const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
  assert.match(vercel, /img-src 'self' data:/);
});

// Visualizer bridge: engine exposes getAudioAnalysisBands; winamp.js prefers
// those real bands over the deterministic pseudo-spectrum via realBands().
test('audio analysis engine exposes getAudioAnalysisBands and syncs clock', () => {
  // Evaluate the engine in an isolated scope with only the global we care about.
  const engineSrc = fs.readFileSync(path.join(root, 'public/js/audio-analysis-engine.js'), 'utf8');
  const engine = new Function(
    'window',
    engineSrc
      .replace(/document\.getElementById/g, '(typeof document!=="undefined"&&document.getElementById)')
      .replace(/performance\.now/g, '(()=>0)')
      .replace(/requestAnimationFrame/g, '(f=>setTimeout(f,0))')
      + '\nreturn window.audioAnalysis;'
  );
  const scope = {
    audioAnalysis: null,
    currentTrackId: null,
    requestAudioAnalysis: null,
    audioClock: null,
    eqBands: null,
    setEQGain: null,
    getEQGain: null,
    analyzeNow: null,
    getAudioAnalysisBands: null
  };
  // The engine writes to window.*, so we pass our object as window.
  const fakeWindow = Object.create(null);
  engine(fakeWindow);
  const ae = fakeWindow.audioAnalysis;
  assert.ok(ae, 'engine self-initialises');
  assert.strictEqual(typeof fakeWindow.analyzeNow, 'function');
  assert.strictEqual(typeof fakeWindow.getAudioAnalysisBands, 'function');
  // No segments loaded → null bands.
  assert.strictEqual(fakeWindow.getAudioAnalysisBands(), null);
  // Load segments and switch track: bands are available with current track id.
  const fakeClock = {
    isPlaying: false,
    setProgress: function (ms) { this._ms = ms; },
    getCurrentTime: function () { return this._ms || 0; },
    pause: function () { this._paused = this._ms; this.isPlaying = false; },
    resume: function () { this._ms = this._paused; this.isPlaying = true; },
    setPausedAt: function (ms) { this._paused = ms; }
  };
  // Replace the module's internal clock with the test clock so we can drive it.
  Object.defineProperty(fakeWindow, 'audioClock', { value: fakeClock, writable: true });
  fakeClock.setProgress(0);
  fakeClock.resume();
  fakeWindow.currentTrackId = 'abc123';
  ae.loadAnalysis({
    segments: [
      { start: 0, duration: 2, loudness_max: -12, pitches: [0.8,0.6,0.4,0.2,0.1,0.05,0.03,0.02,0.01,0.01,0.01,0.01], timbre: [10,8,6,4,2,1,0.5,0.3,0.2,0.1,0.1,0.1] },
      { start: 2, duration: 2, loudness_max: -20, pitches: [0.2,0.3,0.5,0.6,0.7,0.8,0.9,0.95,0.98,0.99,0.99,0.99], timbre: [1,2,3,4,5,6,7,8,9,10,10,10] }
    ]
  });
  fakeClock.setProgress(1000);
  const bands = fakeWindow.getAudioAnalysisBands();
  assert.ok(bands);
  assert.strictEqual(bands.trackId, 'abc123');
  assert.strictEqual(bands.frequencies.length, 19);
  assert.ok(bands.frequencies.some((v) => v > 0), 'bands should not be all-zero with non-zero pitches');
  // Track id is carried through so winamp.js's guard (trackId === state.trackId)
  // can drop stale data; the engine itself just reflects the current track.
  fakeWindow.currentTrackId = 'def456';
  const mismatched = fakeWindow.getAudioAnalysisBands();
  assert.strictEqual(mismatched.trackId, 'def456');
});

test('winamp.js realBands resamples and applies EQ, falls back when empty', () => {
  const eq = { on: true, preamp: 50, bands: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50] };
  const out = new Array(19);
  // Empty source → no override (renderer must fallback).
  assert.strictEqual(W.realBands([], eq, out), false);
  assert.strictEqual(W.realBands(null, eq, out), false);
  // Valid 19-band source → filled output in [0,1] and returns true.
  const src = new Array(19).fill(0);
  src[0] = 0.5; src[9] = 0.25; src[18] = 0.1;
  assert.strictEqual(W.realBands(src, eq, out), true);
  assert.ok(out.every((v) => v >= 0 && v <= 1));
  // EQ OFF bypass: yields a flat scale (eqGainDb returns 0 -> multiplier 1).
  const off = { on: false, preamp: 50, bands: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50] };
  W.realBands(src, off, out);
  assert.ok(out.every((v) => v >= 0 && v <= 1), 'EQ-off bins stay in [0,1]');
  assert.ok(Math.max.apply(null, out) > 0, 'EQ-off still renders non-zero bins');
  // A boost (bands above 50) scales up vs a cut; both stay bounded.
  const boost = { on: true, preamp: 80, bands: [80, 80, 80, 80, 80, 80, 80, 80, 80, 80] };
  const boosted = new Array(19);
  W.realBands(src, boost, boosted);
  assert.ok(Math.max.apply(null, boosted) > Math.max.apply(null, out), 'boost raises bins');
  assert.ok(boosted.every((v) => v <= 1), 'boosted bins clamp at 1');
});
