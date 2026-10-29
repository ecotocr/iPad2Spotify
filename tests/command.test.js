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

test('starts a selected track at its position inside the playlist context', function (t, done) {
  var calledWith = null;
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) { calledWith = { url: url, options: options }; cb(null, 204, null); }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, {
    action: 'play_playlist_track', playlist_id: '37i9dQZF1DX4JAvHpjipBk', position: 56
  }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 200, JSON.stringify(helpers.resBody(res)));
    assert.strictEqual(calledWith.url, 'https://api.spotify.com/v1/me/player/play');
    assert.deepStrictEqual(JSON.parse(calledWith.options.body), {
      context_uri: 'spotify:playlist:37i9dQZF1DX4JAvHpjipBk', offset: { position: 56 }
    });
    assert.strictEqual(res.statusCode, 200);
    done();
  });
});

test('plays a selected Spotify queue track by URI', function (t, done) {
  var calledWith = null;
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) {
      if (url.indexOf('/me/player/devices') !== -1) return cb(null, 200, { devices: [{ id: 'device-1', is_active: true }] });
      calledWith = { url: url, options: options };
      cb(null, 204, null);
    }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, {
    action: 'play_track', track_uri: 'spotify:track:4NHQUGzhtTLFvgF5SZesLK'
  }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(calledWith.url, 'https://api.spotify.com/v1/me/player/play?device_id=device-1');
    assert.deepStrictEqual(JSON.parse(calledWith.options.body), { uris: ['spotify:track:4NHQUGzhtTLFvgF5SZesLK'] });
    done();
  });
});

test('rejects invalid Spotify queue track URIs', function () {
  var restore = stubLib({ rateLimit: noKv });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, {
    action: 'play_track', track_uri: 'https://example.test/track'
  }), res);
  restore();
  assert.strictEqual(res.statusCode, 400);
  assert.match(helpers.resBody(res).error, /track/i);
});

test('rejects invalid selected playlist track positions', function (t, done) {
  var restore = stubLib({ rateLimit: noKv, kvGet: noKv, spotifyToken: validToken });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, {
    action: 'play_playlist_track', playlist_id: '37i9dQZF1DX4JAvHpjipBk', position: -1
  }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 400);
    assert.match(helpers.resBody(res).error, /position/i);
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

test('seeks to a validated playback position', function (t, done) {
  var calledWith = null;
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) { calledWith = { url: url, options: options }; cb(null, 204, null); }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'seek', position_ms: 73500 }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(calledWith.url, 'https://api.spotify.com/v1/me/player/seek?position_ms=73500');
    assert.strictEqual(calledWith.options.method, 'PUT');
    assert.strictEqual(res.statusCode, 200);
    done();
  });
});

test('rejects invalid seek positions', function () {
  var restore = stubLib({ rateLimit: noKv });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'seek', position_ms: '1200' }), res);
  restore();
  assert.strictEqual(res.statusCode, 400);
  assert.match(helpers.resBody(res).error, /seek position/i);
});

test('transfers playback to a selected Spotify device', function (t, done) {
  var calls = [];
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) { calls.push({ url: url, options: options }); cb(null, 204, null); }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'transfer_device', device_id: 'speaker-device-123' }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://api.spotify.com/v1/me/player');
    assert.strictEqual(calls[0].options.method, 'PUT');
    assert.deepStrictEqual(JSON.parse(calls[0].options.body), { device_ids: ['speaker-device-123'], play: true });
    assert.strictEqual(res.statusCode, 200);
    done();
  });
});

test('rejects an invalid Spotify device ID', function () {
  var restore = stubLib({ rateLimit: noKv });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'transfer_device', device_id: 'bad\u0000device' }), res);
  restore();
  assert.strictEqual(res.statusCode, 400);
  assert.match(helpers.resBody(res).error, /device id/i);
});

test('sets the selected Spotify device volume', function (t, done) {
  var calledWith = null;
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) { calledWith = { url: url, options: options }; cb(null, 204, null); }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'volume', volume_percent: 50, device_id: 'speaker-device-123' }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(calledWith.url, 'https://api.spotify.com/v1/me/player/volume?volume_percent=50&device_id=speaker-device-123');
    assert.strictEqual(calledWith.options.method, 'PUT');
    assert.strictEqual(res.statusCode, 200);
    done();
  });
});

test('reports when Spotify cannot control a device volume', function (t, done) {
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) {
      cb(null, 404, { error: { status: 404, message: 'Player command failed: Cannot control device volume.', reason: 'PLAYER_COMMAND_FAILED' } });
    }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'volume', volume_percent: 50, device_id: 'speaker-device-123' }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(helpers.resBody(res).code, 'DEVICE_VOLUME_UNSUPPORTED');
    assert.strictEqual(helpers.resBody(res).device_id, 'speaker-device-123');
    assert.match(helpers.resBody(res).error, /device’s own volume controls/);
    done();
  });
});

test('sets volume on the active device when no device ID was supplied by playback state', function (t, done) {
  var calls = [];
  var restore = stubLib({
    rateLimit: noKv, kvGet: noKv, spotifyToken: validToken,
    request: function (url, options, cb) {
      calls.push(url);
      if (url === 'https://api.spotify.com/v1/me/player/devices') {
        return cb(null, 200, { devices: [{ id: 'active-device', is_active: true }] });
      }
      cb(null, 204, null);
    }
  });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'volume', volume_percent: 55 }), res);
  setImmediate(function () {
    restore();
    assert.deepStrictEqual(calls, [
      'https://api.spotify.com/v1/me/player/devices',
      'https://api.spotify.com/v1/me/player/volume?volume_percent=55&device_id=active-device'
    ]);
    assert.strictEqual(res.statusCode, 200);
    done();
  });
});

test('rejects invalid Spotify volume percentages', function () {
  var restore = stubLib({ rateLimit: noKv });
  var res = helpers.fakeRes();
  command(helpers.fakeReq('POST', '/api/spotify/command', SESSION_COOKIE, { action: 'volume', volume_percent: 101 }), res);
  restore();
  assert.strictEqual(res.statusCode, 400);
  assert.match(helpers.resBody(res).error, /volume/i);
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
