'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var helpers = require('./helpers');
var lib = require('../api/_lib');
var audioAnalysis = require('../api/spotify/audio-analysis');

function callWithSegments(segments, options) {
  options = options || {};
  var counters = options.counters || {};
  function count(name) { counters[name] = (counters[name] || 0) + 1; }
  var originals = {};
  var replacements = {
    getSession: function (req, res, callback) { count('session'); callback(null, { refresh_token: 'refresh-token' }); },
    config: function () { return {}; },
    memoryRateLimit: function (req, bucket, limit, seconds) { count('rateLimit'); return !!options.limited; },
    spotifyToken: function (cfg, body, callback) { count('token'); callback(null, 200, { access_token: 'access-token' }); },
    updateRefreshToken: function (res, session, token, callback) { callback(null); },
    kvGet: function (key, callback) {
      count('cache');
      if (options.cached) callback(null, options.cached);
      else callback(new Error('cache miss'));
    },
    request: function (url, requestOptions, callback) { count('upstream'); callback(null, 200, { segments: segments }); },
    kvSet: function (key, value, ttl, callback) { callback(null); }
  };
  Object.keys(replacements).forEach(function (key) {
    originals[key] = lib[key];
    lib[key] = replacements[key];
  });

  var req = helpers.fakeReq('GET', '/api/spotify/audio-analysis?trackId=track', 'spotify_session=paired');
  req.query = { trackId: 'track' };
  var res = helpers.fakeRes();
  try {
    audioAnalysis(req, res);
    return res;
  } finally {
    Object.keys(originals).forEach(function (key) { lib[key] = originals[key]; });
  }
}

test('audio analysis keeps sanitized pitch and timbre vectors', function () {
  var pitches = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.8, 0.6];
  var timbre = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  var res = callWithSegments([{
    start: 0,
    duration: 0.2,
    loudness_max: -8,
    pitches: pitches,
    timbre: timbre,
    ignored: [1, 2, 3]
  }]);
  var payload = helpers.resBody(res);
  assert.deepStrictEqual(payload.segments[0].pitches, pitches);
  assert.deepStrictEqual(payload.segments[0].timbre, timbre);
  assert.strictEqual(payload.segments[0].ignored, undefined);
});

test('large audio analysis responses are reduced below 20,000 bytes', function () {
  var pitches = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.8, 0.6];
  var timbre = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  var segments = [];
  for (var i = 0; i < 10000; i++) {
    segments.push({ start: i * 0.02, duration: 0.02, loudness_max: -8, pitches: pitches, timbre: timbre });
  }
  var res = callWithSegments(segments);
  var payload = helpers.resBody(res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(payload.segments.length > 0);
  assert.strictEqual(payload.segments[payload.segments.length - 1].start, segments[segments.length - 1].start);
  assert.ok(Buffer.byteLength(JSON.stringify(payload), 'utf8') <= 20000);
});

test('analysis cache hits do not refresh Spotify tokens', function () {
  var counters = {};
  var cached = { segments: [{ start: 0, duration: 0.2, pitches: [1] }] };
  var res = callWithSegments([], { cached: cached, counters: counters });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(helpers.resBody(res), cached);
  assert.strictEqual(counters.cache, 1);
  assert.strictEqual(counters.token || 0, 0);
  assert.strictEqual(counters.upstream || 0, 0);
});

test('analysis requests are rate limited before session, cache, and Spotify work', function () {
  var counters = {};
  var res = callWithSegments([], { limited: true, counters: counters });
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(counters.rateLimit, 1);
  assert.strictEqual(counters.session || 0, 0);
  assert.strictEqual(counters.cache || 0, 0);
  assert.strictEqual(counters.token || 0, 0);
  assert.strictEqual(counters.upstream || 0, 0);
});

test('analysis 403 stays silent and keeps the visual fallback available', function () {
  var statusElement = { textContent: '', className: 'message hidden' };
  var xhr;
  function FakeXHR() { xhr = this; }
  FakeXHR.prototype.open = function () {};
  FakeXHR.prototype.send = function () {};

  var appWindow = {};
  var context = {
    window: appWindow,
    document: { getElementById: function (id) { return id === 'audio-analysis-status' ? statusElement : null; } },
    XMLHttpRequest: FakeXHR,
    performance: { now: function () { return 0; } }
  };
  var source = fs.readFileSync(path.join(__dirname, '../public/js/audio-analysis-engine.js'), 'utf8');
  vm.runInNewContext(source, context);

  appWindow.currentTrackId = 'track';
  appWindow.requestAudioAnalysis();
  xhr.status = 403;
  xhr.readyState = 4;
  xhr.responseText = JSON.stringify({ error: { message: 'Audio Analysis access is disabled for this app.' } });
  xhr.onreadystatechange();

  assert.strictEqual(statusElement.textContent, '');
  assert.strictEqual(statusElement.className, 'message hidden');
  assert.strictEqual(appWindow.getAudioAnalysisBands(), null);
});
