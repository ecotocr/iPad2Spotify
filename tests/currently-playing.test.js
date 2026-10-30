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

test('current playlist request lists sanitized tracks with stable playlist offsets', function (t, done) {
  var urls = [];
  var restore = stubLib(withRedisFree({
    config: function () { return { id: 'id', secret: 'secret', redirect: 'r' }; },
    spotifyToken: function (cfg, body, cb) { cb(null, 200, { access_token: 'at' }); },
    request: function (url, options, cb) {
      urls.push(url);
      if (url.indexOf('/currently-playing') !== -1) {
        return cb(null, 200, {
          context: { type: 'playlist', uri: 'spotify:playlist:37i9dQZF1DX4JAvHpjipBk' },
          item: { uri: 'spotify:track:4NHQUGzhtTLFvgF5SZesLK' }
        });
      }
      cb(null, 200, { total: 72, items: [
        { item: { type: 'track', uri: 'spotify:track:4NHQUGzhtTLFvgF5SZesLK', name: 'Current Song', artists: [{ name: 'Artist' }] } },
        { item: { type: 'track', uri: 'spotify:track:anotherTrackId1', name: 'Next Song', artists: [{ name: 'Other' }] } }
      ] });
    }
  }));
  var res = helpers.fakeRes();
  currentlyPlaying(helpers.fakeReq('GET', '/api/spotify/currently-playing?playlist=1&offset=50', SESSION_COOKIE), res);
  setImmediate(function () {
    restore();
    var body = helpers.resBody(res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(urls, [
      'https://api.spotify.com/v1/me/player/currently-playing',
      'https://api.spotify.com/v1/playlists/37i9dQZF1DX4JAvHpjipBk/items?limit=50&offset=50'
    ]);
    assert.strictEqual(body.playlist_id, '37i9dQZF1DX4JAvHpjipBk');
    assert.strictEqual(body.items[0].position, 50);
    assert.strictEqual(body.items[0].artists[0], 'Artist');
    assert.strictEqual(body.items[0].playable, true);
    assert.strictEqual(body.total, 72);
    assert.strictEqual(body.next_offset, 52);
    assert.strictEqual(body.current_track_uri, 'spotify:track:4NHQUGzhtTLFvgF5SZesLK');
    done();
  });
});

test('current playlist retries the legacy tracks endpoint when Spotify returns 404 for items', function (t, done) {
  var urls = [];
  var restore = stubLib(withRedisFree({
    config: function () { return { id: 'id', secret: 'secret', redirect: 'r' }; },
    spotifyToken: function (cfg, body, cb) { cb(null, 200, { access_token: 'at' }); },
    request: function (url, options, cb) {
      urls.push(url);
      if (url.indexOf('/currently-playing') !== -1) {
        return cb(null, 200, {
          context: { uri: 'spotify:playlist:37i9dQZF1DX4JAvHpjipBk' },
          item: { uri: 'spotify:track:4NHQUGzhtTLFvgF5SZesLK' }
        });
      }
      if (url.indexOf('/items?') !== -1) return cb(null, 404, { error: { status: 404, message: 'Resource not found' } });
      cb(null, 200, { total: 1, items: [
        { track: { type: 'track', uri: 'spotify:track:4NHQUGzhtTLFvgF5SZesLK', name: 'Current Song', artists: [{ name: 'Artist' }] } }
      ] });
    }
  }));
  var res = helpers.fakeRes();
  currentlyPlaying(helpers.fakeReq('GET', '/api/spotify/currently-playing?playlist=1', SESSION_COOKIE), res);
  setImmediate(function () {
    restore();
    var body = helpers.resBody(res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.items[0].name, 'Current Song');
    assert.deepStrictEqual(urls.slice(1), [
      'https://api.spotify.com/v1/playlists/37i9dQZF1DX4JAvHpjipBk/items?limit=50&offset=0',
      'https://api.spotify.com/v1/playlists/37i9dQZF1DX4JAvHpjipBk/tracks?limit=50&offset=0'
    ]);
    done();
  });
});

test('current playlist lookup accepts Spotify legacy user playlist URIs', function (t, done) {
  var urls = [];
  var restore = stubLib(withRedisFree({
    config: function () { return { id: 'id', secret: 'secret', redirect: 'r' }; },
    spotifyToken: function (cfg, body, cb) { cb(null, 200, { access_token: 'at' }); },
    request: function (url, options, cb) {
      urls.push(url);
      if (url.indexOf('/currently-playing') !== -1) {
        return cb(null, 200, { context: { uri: 'spotify:user:esteban:playlist:37i9dQZF1DX4JAvHpjipBk' }, item: {} });
      }
      cb(null, 200, { total: 0, items: [] });
    }
  }));
  var res = helpers.fakeRes();
  currentlyPlaying(helpers.fakeReq('GET', '/api/spotify/currently-playing?playlist=1', SESSION_COOKIE), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(helpers.resBody(res).playlist_id, '37i9dQZF1DX4JAvHpjipBk');
    assert.ok(urls[1].indexOf('/playlists/37i9dQZF1DX4JAvHpjipBk/items') !== -1);
    done();
  });
});

test('playlist button falls back to the current Spotify queue when playback has no playlist context', function (t, done) {
  var urls = [];
  var restore = stubLib(withRedisFree({
    config: function () { return { id: 'id', secret: 'secret', redirect: 'r' }; },
    spotifyToken: function (cfg, body, cb) { cb(null, 200, { access_token: 'at' }); },
    request: function (url, options, cb) {
      urls.push(url);
      if (url.indexOf('/currently-playing') !== -1) {
        return cb(null, 200, { context: null, item: { type: 'track', uri: 'spotify:track:4NHQUGzhtTLFvgF5SZesLK', name: 'Current Song', artists: [{ name: 'Artist' }] } });
      }
      if (url === 'https://api.spotify.com/v1/me/player') return cb(null, 204, null);
      if (url.indexOf('/me/player/queue') !== -1) {
        return cb(null, 200, {
          currently_playing: { type: 'track', uri: 'spotify:track:4NHQUGzhtTLFvgF5SZesLK', name: 'Current Song', artists: [{ name: 'Artist' }] },
          queue: [{ type: 'track', uri: 'spotify:track:4NHQUGzhtTLFvgF5SZesLM', name: 'Next Song', artists: [{ name: 'Other' }] }]
        });
      }
      throw new Error('Queue fallback must not request playlist items.');
    }
  }));
  var res = helpers.fakeRes();
  currentlyPlaying(helpers.fakeReq('GET', '/api/spotify/currently-playing?playlist=1', SESSION_COOKIE), res);
  setImmediate(function () {
    restore();
    var body = helpers.resBody(res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.source, 'queue');
    assert.strictEqual(body.total, 2);
    assert.strictEqual(body.items[0].name, 'Current Song');
    assert.strictEqual(body.items[1].position, 1);
    assert.strictEqual(body.items[1].playable, true);
    assert.strictEqual(body.current_track_uri, 'spotify:track:4NHQUGzhtTLFvgF5SZesLK');
    assert.ok(urls[1].indexOf('/me/player') !== -1);
    assert.ok(urls[2].indexOf('/me/player/queue') !== -1);
    done();
  });
});

test('playlist lookup checks the full playback state for a playlist context', function (t, done) {
  var urls = [];
  var restore = stubLib(withRedisFree({
    config: function () { return { id: 'id', secret: 'secret', redirect: 'r' }; },
    spotifyToken: function (cfg, body, cb) { cb(null, 200, { access_token: 'at' }); },
    request: function (url, options, cb) {
      urls.push(url);
      if (url.indexOf('/currently-playing') !== -1) return cb(null, 200, { item: { uri: 'spotify:track:4NHQUGzhtTLFvgF5SZesLK' } });
      if (url === 'https://api.spotify.com/v1/me/player') {
        return cb(null, 200, {
          context: { uri: 'spotify:playlist:37i9dQZF1DX4JAvHpjipBk' },
          device: { id: 'device-1' },
          item: { uri: 'spotify:track:4NHQUGzhtTLFvgF5SZesLK' }
        });
      }
      cb(null, 200, { total: 1, items: [{ item: {
        type: 'track', id: '4NHQUGzhtTLFvgF5SZesLK', uri: 'spotify:track:4NHQUGzhtTLFvgF5SZesLK',
        name: 'Song', artists: [{ name: 'Artist' }], duration_ms: 123000,
        album: { name: 'Album', images: [{ url: 'https://i.scdn.co/image/album' }] }
      } }] });
    }
  }));
  var res = helpers.fakeRes();
  currentlyPlaying(helpers.fakeReq('GET', '/api/spotify/currently-playing?playlist=1', SESSION_COOKIE), res);
  setImmediate(function () {
    restore();
    var body = helpers.resBody(res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(body.source, 'playlist');
    assert.strictEqual(body.device_id, 'device-1');
    assert.strictEqual(body.items[0].id, '4NHQUGzhtTLFvgF5SZesLK');
    assert.strictEqual(body.items[0].duration_ms, 123000);
    assert.deepStrictEqual(body.items[0].album_images, [{ url: 'https://i.scdn.co/image/album' }]);
    assert.ok(urls.indexOf('https://api.spotify.com/v1/me/player') !== -1);
    done();
  });
});

test('playlist lookup refuses a playlist different from the active playback context', function (t, done) {
  var playlistRequests = 0;
  var restore = stubLib(withRedisFree({
    config: function () { return { id: 'id', secret: 'secret', redirect: 'r' }; },
    spotifyToken: function (cfg, body, cb) { cb(null, 200, { access_token: 'at' }); },
    request: function (url, options, cb) {
      if (url.indexOf('/playlists/') !== -1) playlistRequests++;
      cb(null, 200, { context: { type: 'playlist', uri: 'spotify:playlist:37i9dQZF1DX4JAvHpjipBk' }, item: {} });
    }
  }));
  var res = helpers.fakeRes();
  currentlyPlaying(helpers.fakeReq('GET', '/api/spotify/currently-playing?playlist=1&playlist_id=37i9dQZF1DX4JAvHpjipB1&offset=0', SESSION_COOKIE), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(playlistRequests, 0);
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
