var test = require('node:test');
var assert = require('node:assert');
var path = require('node:path');
var helpers = require('./helpers');

process.env.SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'test-secret';
var lib = require(path.join('..', 'api', '_lib.js'));
var command = require(path.join('..', 'api', 'spotify', 'command.js'));

function stubLib(overrides) {
  var originals = {};
  Object.keys(overrides).forEach(function (key) { originals[key] = lib[key]; lib[key] = overrides[key]; });
  return function restore() { Object.keys(originals).forEach(function (key) { lib[key] = originals[key]; }); };
}

var SESSION_COOKIE = 'spotify_session=' + lib.sealSession({ refresh_token: 'refresh-token' });
function noKv() { throw new Error('Redis must not be used on this path'); }
function validToken(cfg, body, cb) { cb(null, 200, { access_token: 'access-token' }); }

test('rejects non-POST requests with 405', function () {
  var res = helpers.fakeRes();
  command(helpers.fakeReq('GET', '/api/spotify/command'), res);
  assert.strictEqual(res.statusCode, 405);
});

test('requires a paired session cookie', function () {
  var restore = stubLib({ rateLimit: noKv });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', null, { action: 'play' }), res);
  restore();
  assert.strictEqual(res.statusCode, 401);
});

test('rejects an unknown playback action', function (t, done) {
  var restore = stubLib({ rateLimit: noKv, kvGet: noKv, spotifyToken: validToken });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'shuffle' }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 400);
    assert.match(helpers.resBody(res).error, /unknown/i);
    done();
  });
});

test('rejects play_artist with an invalid artist id', function () {
  var restore = stubLib({ rateLimit: noKv });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'play_artist', artist_id: '../etc/passwd' }), res);
  restore();
  assert.strictEqual(res.statusCode, 400);
  assert.match(helpers.resBody(res).error, /artist/i);
});

test('rejects play_playlist with an invalid playlist id', function () {
  var restore = stubLib({ rateLimit: noKv });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'play_playlist', playlist_id: '../etc/passwd' }), res);
  restore();
  assert.strictEqual(res.statusCode, 400);
  assert.match(helpers.resBody(res).error, /playlist/i);
});

test('starts a playlist with a valid playlist id via playlist context_uri', function (t, done) {
  var calledWith = null;
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) { calledWith = { url: url, options: options }; cb(null, 204, null); }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'play_playlist', playlist_id: '37i9dQZF1DX4JAvHpjipBk' }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(calledWith.url, 'https://api.spotify.com/v1/me/player/play');
    assert.strictEqual(calledWith.options.method, 'PUT');
    assert.deepStrictEqual(JSON.parse(calledWith.options.body), { context_uri: 'spotify:playlist:37i9dQZF1DX4JAvHpjipBk' });
    assert.strictEqual(res.statusCode, 200);
    done();
  });
});

test('proxies a known action to the matching Spotify endpoint', function (t, done) {
  var calledWith = null;
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) { calledWith = { url: url, options: options }; cb(null, 204, null); }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'next' }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(calledWith.url, 'https://api.spotify.com/v1/me/player/next');
    assert.strictEqual(calledWith.options.method, 'POST');
    assert.strictEqual(res.statusCode, 200);
    done();
  });
});

test('restarts playback by seeking to zero', function (t, done) {
  var calledWith = null;
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) { calledWith = { url: url, options: options }; cb(null, 204, null); }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'restart' }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(calledWith.url, 'https://api.spotify.com/v1/me/player/seek?position_ms=0');
    assert.strictEqual(calledWith.options.method, 'PUT');
    assert.strictEqual(res.statusCode, 200);
    done();
  });
});

test('starts artist radio with a valid artist id via context_uri', function (t, done) {
  var calledWith = null;
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) { calledWith = { url: url, options: options }; cb(null, 204, null); }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'play_artist', artist_id: '4NHQUGzhtTLFvgF5SZesLK' }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(calledWith.url, 'https://api.spotify.com/v1/me/player/play');
    assert.strictEqual(calledWith.options.method, 'PUT');
    assert.deepStrictEqual(JSON.parse(calledWith.options.body), { context_uri: 'spotify:artist:4NHQUGzhtTLFvgF5SZesLK' });
    assert.strictEqual(res.statusCode, 200);
    done();
  });
});

test('surfaces the real Spotify error message instead of a generic failure', function (t, done) {
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) { cb(null, 404, { error: { status: 404, message: 'Device not found' } }); }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'play_artist', artist_id: '4NHQUGzhtTLFvgF5SZesLK' }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(helpers.resBody(res).error, 'Device not found');
    done();
  });
});

test('targets an available device even when none is marked active', function (t, done) {
  var calls = [];
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) {
      calls.push(url);
      if (url.indexOf('/me/player/devices') !== -1) return cb(null, 200, { devices: [{ id: 'device-1', is_active: false }] });
      cb(null, 204, null);
    }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'next' }), res);
  setImmediate(function () {
    restore();
    assert.match(calls[1], /device_id=device-1/);
    assert.strictEqual(res.statusCode, 200);
    done();
  });
});

test('maps NO_ACTIVE_DEVICE to a friendly message when no device is available', function (t, done) {
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) {
      if (url.indexOf('/me/player/devices') !== -1) return cb(null, 200, { devices: [] });
      cb(null, 404, { error: { status: 404, reason: 'NO_ACTIVE_DEVICE', message: 'No active device found' } });
    }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'play_artist', artist_id: '4NHQUGzhtTLFvgF5SZesLK' }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 404);
    assert.match(helpers.resBody(res).error, /open spotify/i);
    done();
  });
});

test('returns 429 when rate limited', function () {
  var restore = stubLib({ memoryRateLimit: function () { return true; }, rateLimit: noKv, kvGet: noKv });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'play' }), res);
  restore();
  assert.strictEqual(res.statusCode, 429);
});
