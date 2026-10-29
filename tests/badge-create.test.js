var test = require('node:test');
var assert = require('node:assert');
var path = require('node:path');
var helpers = require('./helpers');

process.env.SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'test-secret';
var lib = require(path.join('..', 'api', '_lib.js'));
var create = require(path.join('..', 'api', 'badge', 'create.js'));
var pair = require(path.join('..', 'api', 'auth', 'pair.js'));
var badge = require(path.join('..', 'api', 'badge', '[key].js'));

function stubLib(overrides) {
  var originals = {};
  Object.keys(overrides).forEach(function (key) { originals[key] = lib[key]; lib[key] = overrides[key]; });
  return function restore() { Object.keys(originals).forEach(function (key) { lib[key] = originals[key]; }); };
}
function notLimited(req, bucket, limit, seconds, cb) { cb(null, false); }
function origin() { return 'https://example.test'; }

test('badge URL is derived from the Spotify account ID and is stable across calls', function (t, done) {
  var writes = [];
  var restore = stubLib({ rateLimit: notLimited, origin: origin, kvSet: function (key, value, seconds, cb) { writes.push({ key: key, value: value }); cb(null); } });
  var cookie = 'spotify_session=' + lib.sealSession({ refresh_token: 'rt', user_id: '1170009226' });
  var first = helpers.fakeRes(), second = helpers.fakeRes();
  create(helpers.fakeReq('POST', '/api/badge/create', cookie), first);
  create(helpers.fakeReq('POST', '/api/badge/create', cookie), second);
  setImmediate(function () {
    restore();
    assert.strictEqual(helpers.resBody(first).url, 'https://example.test/api/badge/1170009226.svg');
    assert.strictEqual(helpers.resBody(second).url, helpers.resBody(first).url);
    assert.deepStrictEqual(writes[0], { key: 'badge:1170009226', value: { refresh_token: 'rt', user_id: '1170009226' } });
    done();
  });
});

test('sessions without a stored account ID look it up from Spotify once', function (t, done) {
  var restore = stubLib({
    rateLimit: notLimited, origin: origin,
    config: function () { return { id: 'id', secret: 's', redirect: 'r' }; },
    spotifyToken: function (cfg, body, cb) { cb(null, 200, { access_token: 'at' }); },
    request: function (url, options, cb) { assert.match(url, /\/v1\/me$/); cb(null, 200, { id: 'SomeUser' }); },
    kvSet: function (key, value, seconds, cb) { assert.strictEqual(key, 'badge:someuser'); cb(null); }
  });
  var res = helpers.fakeRes();
  create(helpers.fakeReq('POST', '/api/badge/create', 'spotify_session=' + lib.sealSession({ refresh_token: 'rt' })), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(helpers.resBody(res).url, 'https://example.test/api/badge/someuser.svg');
    var value = decodeURIComponent(res.headers['Set-Cookie'].split(';')[0].split('=').slice(1).join('='));
    assert.strictEqual(lib.openSession(value).user_id, 'SomeUser');
    done();
  });
});

test('badge creation requires a paired session', function () {
  var res = helpers.fakeRes();
  create(helpers.fakeReq('POST', '/api/badge/create'), res);
  assert.strictEqual(res.statusCode, 401);
});

test('re-pairing refreshes an existing account badge so its URL keeps working', function (t, done) {
  var code = lib.pairingCode(8), writes = [];
  var restore = stubLib({
    rateLimit: notLimited,
    kvGet: function (key, cb) {
      if (key === 'pair:' + code) return cb(null, { refresh_token: 'new-rt', user_id: '1170009226', expires: Date.now() + 60000 });
      if (key === 'badge:1170009226') return cb(null, { refresh_token: 'old-rt', user_id: '1170009226' });
      cb(null, null);
    },
    kvDel: function (key, cb) { cb(null); },
    kvSet: function (key, value, seconds, cb) { writes.push({ key: key, value: value }); cb(null); }
  });
  var res = helpers.fakeRes();
  pair(helpers.fakeReq('POST', '/api/auth/pair', null, { code: code }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 200);
    var badgeWrite = writes.filter(function (entry) { return entry.key === 'badge:1170009226'; })[0];
    assert.deepStrictEqual(badgeWrite, { key: 'badge:1170009226', value: { refresh_token: 'new-rt', user_id: '1170009226' } });
    assert.ok(writes.some(function (entry) { return /^profiles:/.test(entry.key); }));
    done();
  });
});

test('pairing does not create a badge for accounts that never opted in', function (t, done) {
  var code = lib.pairingCode(8);
  var restore = stubLib({
    rateLimit: notLimited,
    kvGet: function (key, cb) { cb(null, key === 'pair:' + code ? { refresh_token: 'rt', user_id: 'someone', expires: Date.now() + 60000 } : null); },
    kvDel: function (key, cb) { cb(null); },
    kvSet: function (key, value, seconds, cb) {
      if (key.indexOf('profiles:') === 0) return cb(null);
      throw new Error('must not create a badge');
    }
  });
  var res = helpers.fakeRes();
  pair(helpers.fakeReq('POST', '/api/auth/pair', null, { code: code }), res);
  setImmediate(function () { restore(); assert.strictEqual(res.statusCode, 200); done(); });
});

test('account badge URLs resolve case-insensitively and unknown accounts 404', function (t, done) {
  var reads = [];
  var restore = stubLib({ kvGet: function (key, cb) { reads.push(key); cb(null, null); } });
  var res = helpers.fakeRes();
  badge(helpers.fakeReq('GET', '/api/badge/SomeUser.svg'), res);
  setImmediate(function () {
    restore();
    assert.deepStrictEqual(reads, ['badge:someuser']);
    assert.strictEqual(res.statusCode, 404);
    done();
  });
});
