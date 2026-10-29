var test = require('node:test');
var assert = require('node:assert');
var path = require('node:path');
var helpers = require('./helpers');

process.env.SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'test-secret';
var lib = require(path.join('..', 'api', '_lib.js'));
var pair = require(path.join('..', 'api', 'auth', 'pair.js'));

function stubLib(overrides) {
  var originals = {};
  Object.keys(overrides).forEach(function (key) { originals[key] = lib[key]; lib[key] = overrides[key]; });
  return function restore() { Object.keys(originals).forEach(function (key) { lib[key] = originals[key]; }); };
}
function notLimited(req, bucket, limit, seconds, cb) { cb(null, false); }
function setCookieValues(res) {
  var value = res.headers['Set-Cookie'];
  return Array.isArray(value) ? value : [value];
}

test('profile listing creates an installation store without a selected Spotify session', function (t, done) {
  var restore = stubLib({
    kvGet: function (key, cb) { assert.match(key, /^profiles:/); cb(null, null); }
  });
  var res = helpers.fakeRes();
  pair(helpers.fakeReq('GET', '/api/auth/pair'), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(helpers.resBody(res).profiles, []);
    assert.match(setCookieValues(res).join('\n'), /spotify_profile_store=[A-Za-z0-9_-]{43}/);
    done();
  });
});

test('profile listing migrates an existing single-account session into the installation store', function (t, done) {
  var saved = null;
  var cookie = 'spotify_session=' + lib.sealSession({ refresh_token: 'private-refresh-token', user_id: 'user123' });
  var restore = stubLib({
    kvGet: function (key, cb) { cb(null, null); },
    kvSet: function (key, value, seconds, cb) { saved = { key: key, value: value }; cb(null); },
    spotifyToken: function (cfg, body, cb) { cb(null, 401, { error: 'invalid_grant' }); }
  });
  var res = helpers.fakeRes();
  pair(helpers.fakeReq('GET', '/api/auth/pair', cookie), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(helpers.resBody(res).profiles.length, 1);
    assert.strictEqual(helpers.resBody(res).profiles[0].user_id, 'user123');
    assert.doesNotMatch(JSON.stringify(helpers.resBody(res)), /private-refresh-token/);
    assert.match(saved.key, /^profiles:/);
    assert.strictEqual(saved.value.profiles[0].refresh_token, 'private-refresh-token');
    assert.strictEqual(helpers.resBody(res).profile_warning_count, 1);
    assert.ok(setCookieValues(res).some(function (value) { return /^spotify_profile_store=/.test(value); }));
    assert.ok(setCookieValues(res).some(function (value) { return /^spotify_session=/.test(value); }));
    done();
  });
});

test('profile listing refreshes missing Spotify account name and avatar metadata', function () {
  var storeId = lib.random(32);
  var stored = {
    profiles: [
      { id: 'spotify-user-id', user_id: 'spotify-user-id', display_name: 'spotify-user-id', refresh_token: 'old-refresh-token' },
      { id: 'opaque-profile-id', refresh_token: 'old-second-refresh-token' }
    ]
  };
  var saved = null;
  var cookie = 'spotify_profile_store=' + storeId + '; spotify_session=' + lib.sealSession({
    refresh_token: 'old-second-refresh-token', profile_id: 'opaque-profile-id'
  });
  var restore = stubLib({
    config: function () { return { id: 'client-id', secret: 'client-secret' }; },
    kvGet: function (key, cb) {
      assert.strictEqual(key, 'profiles:' + storeId);
      cb(null, stored);
    },
    kvSet: function (key, value, seconds, cb) { saved = value; cb(null); },
    spotifyToken: function (cfg, body, cb) {
      if (/old-refresh-token/.test(body)) return cb(null, 200, { access_token: 'first-access', refresh_token: 'rotated-refresh-token' });
      assert.match(body, /refresh_token=old-second-refresh-token/);
      cb(null, 200, { access_token: 'second-access', refresh_token: 'rotated-second-refresh-token' });
    },
    spotifyUserProfile: function (accessToken, cb) {
      if (accessToken === 'first-access') {
        return cb(null, { user_id: 'spotify-user-id', display_name: 'Esteban', avatar_url: 'https://i.scdn.co/image/avatar' });
      }
      assert.strictEqual(accessToken, 'second-access');
      cb(null, { user_id: 'second-user-id', display_name: 'Second user', avatar_url: 'https://i.scdn.co/image/avatar-2' });
    }
  });
  var res = helpers.fakeRes();
  pair(helpers.fakeReq('GET', '/api/auth/pair', cookie), res);
  restore();
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(helpers.resBody(res).profiles[0].display_name, 'Esteban');
  assert.strictEqual(helpers.resBody(res).profiles[0].avatar_url, 'https://i.scdn.co/image/avatar');
  assert.strictEqual(helpers.resBody(res).profiles[1].id, 'opaque-profile-id');
  assert.strictEqual(helpers.resBody(res).profiles[1].display_name, 'Second user');
  assert.strictEqual(helpers.resBody(res).profiles[1].user_id, 'second-user-id');
  assert.strictEqual(helpers.resBody(res).profile_warning_count, 0);
  assert.strictEqual(saved.profiles[0].refresh_token, 'rotated-refresh-token');
  assert.strictEqual(saved.profiles[1].refresh_token, 'rotated-second-refresh-token');
  assert.strictEqual(saved.profiles[1].id, 'opaque-profile-id');
  assert.strictEqual(saved.profiles[0].profile_metadata_checked, true);
  assert.strictEqual(saved.profiles[1].profile_metadata_checked, true);
  var sessionCookie = setCookieValues(res).filter(function (value) { return /^spotify_session=/.test(value); })[0];
  var activeSession = lib.openSession(decodeURIComponent(sessionCookie.split(';')[0].split('=').slice(1).join('=')));
  assert.strictEqual(activeSession.profile_id, 'opaque-profile-id');
  assert.strictEqual(activeSession.user_id, 'second-user-id');
  assert.strictEqual(activeSession.refresh_token, 'rotated-second-refresh-token');
});

test('profile selection installs only the chosen profile as the active session', function (t, done) {
  var storeId = lib.random(32);
  var storeCookie = 'spotify_profile_store=' + storeId;
  var selected = { id: 'user-two', user_id: 'user-two', display_name: 'Second Account', avatar_url: 'https://i.scdn.co/image/photo', refresh_token: 'second-refresh-token' };
  var restore = stubLib({
    kvGet: function (key, cb) { assert.strictEqual(key, 'profiles:' + storeId); cb(null, { profiles: [selected] }); }
  });
  var res = helpers.fakeRes();
  pair(helpers.fakeReq('POST', '/api/auth/pair', storeCookie, { profile_id: selected.id }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(helpers.resBody(res).selected, {
      id: 'user-two', user_id: 'user-two', display_name: 'Second Account', avatar_url: 'https://i.scdn.co/image/photo'
    });
    var sessionCookie = setCookieValues(res).filter(function (value) { return /^spotify_session=/.test(value); })[0];
    var sealed = decodeURIComponent(sessionCookie.split(';')[0].split('=').slice(1).join('='));
    var session = lib.openSession(sealed);
    assert.strictEqual(session.refresh_token, 'second-refresh-token');
    assert.strictEqual(session.user_id, 'user-two');
    assert.strictEqual(session.profile_id, 'user-two');
    assert.doesNotMatch(sessionCookie, /second-refresh-token/);
    done();
  });
});

test('profile selection rejects IDs that are not in the installation store', function () {
  var restore = stubLib({ kvGet: function (key, cb) { cb(null, { profiles: [] }); } });
  var res = helpers.fakeRes();
  pair(helpers.fakeReq('POST', '/api/auth/pair', 'spotify_profile_store=' + lib.random(32), { profile_id: 'missing' }), res);
  restore();
  assert.strictEqual(res.statusCode, 404);
});

test('updating an existing Spotify user preserves the profile ID used by sessions', function () {
  var profile = { id: 'opaque-profile-id', user_id: 'spotify-user-id', refresh_token: 'old-token' };
  lib.upsertProfile([profile], {
    id: 'spotify-user-id',
    user_id: 'spotify-user-id',
    display_name: 'Esteban',
    refresh_token: 'new-token'
  });
  assert.strictEqual(profile.id, 'opaque-profile-id');
  assert.strictEqual(profile.refresh_token, 'new-token');
  assert.strictEqual(profile.display_name, 'Esteban');
});

test('adding a second account keeps the current active account selected', function (t, done) {
  var storeId = lib.random(32), writes = [];
  var cookie = 'spotify_profile_store=' + storeId + '; spotify_session=' + lib.sealSession({
    refresh_token: 'first-refresh-token', user_id: 'first-user', profile_id: 'first-user'
  });
  var code = 'SECOND22';
  var restore = stubLib({
    rateLimit: notLimited,
    kvGet: function (key, cb) {
      if (key === 'pair:' + code) return cb(null, {
        profile_id: 'second-user', user_id: 'second-user', display_name: 'Second', refresh_token: 'second-refresh-token', expires: Date.now() + 60000
      });
      if (key === 'profiles:' + storeId) return cb(null, { profiles: [
        { id: 'first-user', user_id: 'first-user', display_name: 'First', refresh_token: 'first-refresh-token' }
      ] });
      cb(null, null);
    },
    kvSet: function (key, value, seconds, cb) { writes.push({ key: key, value: value }); cb(null); },
    kvDel: function (key, cb) { cb(null); }
  });
  var res = helpers.fakeRes();
  pair(helpers.fakeReq('POST', '/api/auth/pair', cookie, { code: code }), res);
  setImmediate(function () {
    restore();
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(helpers.resBody(res).profiles.length, 2);
    var sessionCookie = setCookieValues(res).filter(function (value) { return /^spotify_session=/.test(value); })[0];
    var active = lib.openSession(decodeURIComponent(sessionCookie.split(';')[0].split('=').slice(1).join('=')));
    assert.strictEqual(active.user_id, 'first-user');
    assert.strictEqual(active.refresh_token, 'first-refresh-token');
    assert.strictEqual(writes[0].value.profiles[1].user_id, 'second-user');
    done();
  });
});
