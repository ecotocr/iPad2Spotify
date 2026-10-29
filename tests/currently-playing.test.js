var test = require('node:test');
var assert = require('node:assert');
var path = require('node:path');
var helpers = require('./helpers');

process.env.SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'test-secret';
var lib = require(path.join('..', 'api', '_lib.js'));
var currentlyPlaying = require(path.join('..', 'api', 'spotify', 'currently-playing.js'));

function stubLib(overrides) {
  var originals = {};
  Object.keys(overrides).forEach(function (key) { originals[key] = lib[key]; lib[key] = overrides[key]; });
  return function restore() { Object.keys(originals).forEach(function (key) { lib[key] = originals[key]; }); };
}
function noKv() { throw new Error('Polling must not use Redis'); }
var redisFree = { kvGet: noKv, kvSet: noKv, kvDel: noKv, rateLimit: noKv };
function withRedisFree(extra) { var o = {}; Object.keys(redisFree).forEach(function (k) { o[k] = redisFree[k]; }); Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; }); return o; }
var SESSION_COOKIE = 'spotify_session=' + lib.sealSession({ refresh_token: 'rt' });

test('unpaired visitors get 401 without touching Redis', function () {
  var restore = stubLib(withRedisFree());
  var res = helpers.fakeRes();
  currentlyPlaying(helpers.fakeReq('GET', '/api/spotify/currently-playing'), res);
  restore();
  assert.strictEqual(res.statusCode, 401);
});

test('a paired poll returns Spotify data without any Redis commands', function (t, done) {
  var restore = stubLib(withRedisFree({
    config: function () { return { id: 'id', secret: 'secret', redirect: 'r' }; },
    spotifyToken: function (cfg, body, cb) { assert.match(body, /refresh_token=rt/); cb(null, 200, { access_token: 'at' }); },
    request: function (url, options, cb) { cb(null, 200, { is_playing: true, item: { id: 't1', name: 'Song' } }); }
  }));
  var res = helpers.fakeRes();
  currentlyPlaying(helpers.fakeReq('GET', '/api/spotify/currently-playing', SESSION_COOKIE), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(helpers.resBody(res).item.name, 'Song');
    done();
  });
});

test('a Spotify 403 explains the development-mode allowlist requirement', function () {
  var restore = stubLib(withRedisFree({
    config: function () { return { id: 'id', secret: 'secret', redirect: 'r' }; },
    spotifyToken: function (cfg, body, cb) { cb(null, 200, { access_token: 'at' }); },
    request: function (url, options, cb) { cb(null, 403, null, ''); }
  }));
  var res = helpers.fakeRes();
  currentlyPlaying(helpers.fakeReq('GET', '/api/spotify/currently-playing', SESSION_COOKIE), res);
  restore();
  assert.strictEqual(res.statusCode, 403);
  assert.match(helpers.resBody(res).error, /Development mode/);
  assert.match(helpers.resBody(res).error, /Users Management/);
});

test('device lookup lists available devices without requiring a current playback response', function (t, done) {
  var urls = [];
  var restore = stubLib(withRedisFree({
    config: function () { return { id: 'id', secret: 'secret', redirect: 'r' }; },
    spotifyToken: function (cfg, body, cb) { cb(null, 200, { access_token: 'at' }); },
    request: function (url, options, cb) {
      urls.push(url);
      cb(null, 200, { devices: [
        { id: 'device-1', name: 'Living Room', type: 'Speaker', is_active: true, supports_volume: false },
        { id: 'device-2', name: 'Phone', type: 'Smartphone', is_active: false, supports_volume: true }
      ] });
    }
  }));
  var res = helpers.fakeRes();
  currentlyPlaying(helpers.fakeReq('GET', '/api/spotify/currently-playing?devices=1', SESSION_COOKIE), res);
  setImmediate(function () {
    restore();
    var body = helpers.resBody(res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(urls, [
      'https://api.spotify.com/v1/me/player/devices'
    ]);
    assert.strictEqual(body.devices.length, 2);
    assert.strictEqual(body.devices[0].name, 'Living Room');
    assert.strictEqual(body.devices[0].supports_volume, false);
    assert.strictEqual(body.devices[1].is_active, false);
    assert.strictEqual(body.devices[1].supports_volume, true);
    done();
  });
});

test('a rotated Spotify refresh token is written back to the cookie', function (t, done) {
  var restore = stubLib(withRedisFree({
    config: function () { return { id: 'id', secret: 'secret', redirect: 'r' }; },
    spotifyToken: function (cfg, body, cb) { cb(null, 200, { access_token: 'at', refresh_token: 'rt2' }); },
    request: function (url, options, cb) { cb(null, 204, null); }
  }));
  var res = helpers.fakeRes();
  currentlyPlaying(helpers.fakeReq('GET', '/api/spotify/currently-playing', SESSION_COOKIE), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 200);
    var value = decodeURIComponent(res.headers['Set-Cookie'].split(';')[0].split('=').slice(1).join('='));
    assert.strictEqual(lib.openSession(value).refresh_token, 'rt2');
    done();
  });
});

test('returns 429 from the in-memory limiter', function () {
  var restore = stubLib(withRedisFree({ memoryRateLimit: function () { return true; } }));
  var res = helpers.fakeRes();
  currentlyPlaying(helpers.fakeReq('GET', '/api/spotify/currently-playing', SESSION_COOKIE), res);
  restore();
  assert.strictEqual(res.statusCode, 429);
});
