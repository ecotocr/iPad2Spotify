var test = require('node:test');
var assert = require('node:assert');
var path = require('node:path');
var helpers = require('./helpers');

var lib = require(path.join('..', 'api', '_lib.js'));
var lyrics = require(path.join('..', 'api', 'lyrics.js'));

function stubLib(overrides) {
  var originals = {};
  Object.keys(overrides).forEach(function (key) { originals[key] = lib[key]; lib[key] = overrides[key]; });
  return function restore() { Object.keys(originals).forEach(function (key) { lib[key] = originals[key]; }); };
}

function withSession(extra) {
  var overrides = {
    memoryRateLimit: function () { return false; },
    cookie: function () { return 'session'; },
    getSession: function (req, res, callback) { callback(null, { refresh_token: 'refresh-token' }); }
  };
  Object.keys(extra || {}).forEach(function (key) { overrides[key] = extra[key]; });
  return overrides;
}

test('requires GET and a valid artist and title', function () {
  var res = helpers.fakeRes();
  lyrics(helpers.fakeReq('POST', '/api/lyrics'), res);
  assert.strictEqual(res.statusCode, 405);

  res = helpers.fakeRes();
  lyrics(helpers.fakeReq('GET', '/api/lyrics?artist=Queen'), res);
  assert.strictEqual(res.statusCode, 400);
});

test('requires a paired session', function () {
  var restore = stubLib(withSession({ cookie: function () { return null; } }));
  var res = helpers.fakeRes();
  lyrics(helpers.fakeReq('GET', '/api/lyrics?artist=Queen&title=Song'), res);
  restore();
  assert.strictEqual(res.statusCode, 401);
});

test('looks up lyrics using encoded artist and title and returns uncached text', function () {
  var requestedUrl;
  var restore = stubLib(withSession({
    request: function (url, options, callback) {
      requestedUrl = url;
      assert.strictEqual(options.timeout, 8000);
      callback(null, 200, { lyrics: 'First line\nSecond line' });
    }
  }));
  var res = helpers.fakeRes();
  lyrics(helpers.fakeReq('GET', '/api/lyrics?artist=AC%2FDC&title=Back%20in%20Black'), res);
  restore();
  assert.match(requestedUrl, /AC%2FDC\/Back%20in%20Black$/);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['Cache-Control'], 'private, no-store');
  assert.strictEqual(helpers.resBody(res).lyrics, 'First line\nSecond line');
});

test('returns not-found for tracks missing from the provider', function () {
  var restore = stubLib(withSession({
    request: function (url, options, callback) { callback(null, 404, { error: 'Not found' }); }
  }));
  var res = helpers.fakeRes();
  lyrics(helpers.fakeReq('GET', '/api/lyrics?artist=Unknown&title=Song'), res);
  restore();
  assert.strictEqual(res.statusCode, 404);
  assert.match(helpers.resBody(res).error, /not found/i);
});

test('reports upstream failures explicitly', function () {
  var restore = stubLib(withSession({
    request: function (url, options, callback) { callback(new Error('timeout')); }
  }));
  var res = helpers.fakeRes();
  lyrics(helpers.fakeReq('GET', '/api/lyrics?artist=Queen&title=Song'), res);
  restore();
  assert.strictEqual(res.statusCode, 502);
});
