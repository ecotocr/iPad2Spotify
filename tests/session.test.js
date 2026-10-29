var test = require('node:test');
var assert = require('node:assert');
var path = require('node:path');
var helpers = require('./helpers');

process.env.SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'test-secret';
var lib = require(path.join('..', 'api', '_lib.js'));
var logout = require(path.join('..', 'api', 'auth', 'logout.js'));

function stubLib(overrides) {
  var originals = {};
  Object.keys(overrides).forEach(function (key) { originals[key] = lib[key]; lib[key] = overrides[key]; });
  return function restore() { Object.keys(originals).forEach(function (key) { lib[key] = originals[key]; }); };
}
function noKv() { throw new Error('Redis must not be used'); }

test('sealed sessions round-trip without exposing the refresh token', function () {
  var sealed = lib.sealSession({ refresh_token: 'secret-refresh-token' });
  assert.match(sealed, /^v1\.[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(sealed, /secret-refresh-token/);
  assert.strictEqual(lib.openSession(sealed).refresh_token, 'secret-refresh-token');
});

test('sealed sessions preserve the selected profile without storing installation identifiers', function () {
  var sealed = lib.sealSession({ refresh_token: 'rt', user_id: 'user-id', profile_id: 'profile-id', profile_store_id: 'installation-id' });
  var session = lib.openSession(sealed);
  assert.strictEqual(session.profile_id, 'profile-id');
  assert.strictEqual(session.profile_store_id, undefined);
  assert.doesNotMatch(sealed, /installation-id/);
});

test('tampered or foreign session cookies are rejected', function () {
  var sealed = lib.sealSession({ refresh_token: 'rt' });
  var tampered = sealed.charAt(3) === 'A' ? 'B' : 'A';
  assert.strictEqual(lib.openSession(sealed.slice(0, 3) + tampered + sealed.slice(4)), null);
  assert.strictEqual(lib.openSession('v1.garbage'), null);
  var original = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'a-different-secret';
  try { assert.strictEqual(lib.openSession(sealed), null); } finally {
    if (original === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = original;
  }
});

test('getSession reads encrypted cookies without Redis', function (t, done) {
  var restore = stubLib({ kvGet: noKv, kvDel: noKv });
  var req = helpers.fakeReq('GET', '/', 'spotify_session=' + lib.sealSession({ refresh_token: 'rt' }));
  lib.getSession(req, helpers.fakeRes(), function (err, session) {
    restore();
    assert.ifError(err);
    assert.strictEqual(session.refresh_token, 'rt');
    done();
  });
});

test('rotated refresh tokens are saved in the selected profile record', function (t, done) {
  var storeId = lib.random(32), saved = null;
  var req = helpers.fakeReq('GET', '/', 'spotify_session=' + lib.sealSession({ refresh_token: 'old-rt', user_id: 'user-id', profile_id: 'user-id' }) + '; spotify_profile_store=' + storeId);
  var restore = stubLib({
    kvGet: function (key, cb) {
      assert.strictEqual(key, 'profiles:' + storeId);
      cb(null, { profiles: [{ id: 'user-id', user_id: 'user-id', refresh_token: 'old-rt' }] });
    },
    kvSet: function (key, value, seconds, cb) { saved = value; cb(null); }
  });
  var res = helpers.fakeRes();
  lib.getSession(req, res, function (err, session) {
    assert.ifError(err);
    lib.updateRefreshToken(res, session, { refresh_token: 'rotated-rt' }, function (saveErr) {
      restore();
      assert.ifError(saveErr);
      assert.strictEqual(saved.profiles[0].refresh_token, 'rotated-rt');
      assert.strictEqual(lib.openSession(decodeURIComponent(res.headers['Set-Cookie'].split(';')[0].split('=').slice(1).join('='))).refresh_token, 'rotated-rt');
      done();
    });
  });
});

test('a pending profile token update is retried when Spotify does not rotate again', function (t, done) {
  var storeId = lib.random(32), saved = null;
  var session = { refresh_token: 'rotated-rt', profile_id: 'user-id', profile_store_id: storeId, profile_sync_pending: true, user_id: 'user-id' };
  var restore = stubLib({
    kvGet: function (key, cb) {
      assert.strictEqual(key, 'profiles:' + storeId);
      cb(null, { profiles: [{ id: 'user-id', user_id: 'user-id', refresh_token: 'old-rt' }] });
    },
    kvSet: function (key, value, seconds, cb) { saved = value; cb(null); }
  });
  var res = helpers.fakeRes();
  lib.updateRefreshToken(res, session, { access_token: 'access-token' }, function (saveErr) {
    restore();
    assert.ifError(saveErr);
    assert.strictEqual(saved.profiles[0].refresh_token, 'rotated-rt');
    var sessionCookie = decodeURIComponent(res.headers['Set-Cookie'].split(';')[0].split('=').slice(1).join('='));
    assert.strictEqual(lib.openSession(sessionCookie).profile_sync_pending, undefined);
    done();
  });
});

test('Spotify profile lookup returns a validated display name and CDN avatar', function (t, done) {
  var restore = stubLib({
    request: function (url, options, cb) {
      assert.strictEqual(url, 'https://api.spotify.com/v1/me');
      cb(null, 200, {
        id: 'SpotifyUser',
        display_name: 'Spotify Name',
        images: [{ url: 'https://i.scdn.co/image/avatar' }, { url: 'https://example.test/other' }]
      });
    }
  });
  lib.spotifyUserProfile('access-token', function (err, profile) {
    restore();
    assert.ifError(err);
    assert.deepStrictEqual(profile, {
      user_id: 'SpotifyUser',
      display_name: 'Spotify Name',
      avatar_url: 'https://i.scdn.co/image/avatar'
    });
    done();
  });
});

test('Spotify profile lookup reports failures instead of silently returning no profile', function (t, done) {
  var restore = stubLib({
    request: function (url, options, cb) { cb(null, 403, { error: { status: 403, message: 'Insufficient client scope' } }); }
  });
  lib.spotifyUserProfile('access-token', function (err, profile) {
    restore();
    assert.match(err.message, /HTTP 403/);
    assert.strictEqual(profile, null);
    done();
  });
});

test('getSession migrates a legacy Redis session id to an encrypted cookie', function (t, done) {
  var sid = 'LegacySessionId_abcdefghijklmnop';
  var reads = [];
  var restore = stubLib({ kvGet: function (key, cb) { reads.push(key); cb(null, { refresh_token: 'legacy-rt' }); } });
  var res = helpers.fakeRes();
  lib.getSession(helpers.fakeReq('GET', '/', 'spotify_session=' + sid), res, function (err, session) {
    restore();
    assert.ifError(err);
    assert.deepStrictEqual(reads, ['session:' + sid]);
    assert.strictEqual(session.refresh_token, 'legacy-rt');
    var value = decodeURIComponent(res.headers['Set-Cookie'].split(';')[0].split('=').slice(1).join('='));
    assert.strictEqual(lib.openSession(value).refresh_token, 'legacy-rt');
    done();
  });
});

test('memoryRateLimit limits per bucket and client within a window', function () {
  var req = { headers: { 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 250) } };
  assert.strictEqual(lib.memoryRateLimit(req, 'test-bucket', 2, 60), false);
  assert.strictEqual(lib.memoryRateLimit(req, 'test-bucket', 2, 60), false);
  assert.strictEqual(lib.memoryRateLimit(req, 'test-bucket', 2, 60), true);
  assert.strictEqual(lib.memoryRateLimit(req, 'other-bucket', 2, 60), false);
});

test('logout clears an encrypted session cookie without touching Redis', function () {
  var restore = stubLib({ kvDel: noKv });
  var res = helpers.fakeRes();
  logout(helpers.fakeReq('POST', '/api/auth/logout', 'spotify_session=' + lib.sealSession({ refresh_token: 'rt' })), res);
  restore();
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
});

test('logout deletes a legacy Redis session', function () {
  var deleted = null;
  var restore = stubLib({ kvDel: function (key, cb) { deleted = key; cb(null); } });
  var res = helpers.fakeRes();
  logout(helpers.fakeReq('POST', '/api/auth/logout', 'spotify_session=LegacySessionId_abcdefghijklmnop'), res);
  restore();
  assert.strictEqual(deleted, 'session:LegacySessionId_abcdefghijklmnop');
  assert.strictEqual(res.statusCode, 200);
});

test('forged legacy cookies cannot drive unbounded Redis lookups', function (t, done) {
  var reads = 0;
  var restore = stubLib({ kvGet: function (key, cb) { reads++; cb(null, null); } });
  var headers = { cookie: 'spotify_session=ForgedSessionId_abcdefghijklmnop', 'x-forwarded-for': '198.51.100.7' };
  var remaining = 10;
  (function next() {
    if (!remaining--) { restore(); assert.strictEqual(reads, 5); return done(); }
    lib.getSession({ headers: headers }, helpers.fakeRes(), function () { next(); });
  })();
});
