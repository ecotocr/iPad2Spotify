var test = require('node:test');
var assert = require('node:assert');
var path = require('node:path');
var helpers = require('./helpers');

var lib = require(path.join('..', 'api', '_lib.js'));
var login = require(path.join('..', 'api', 'auth', 'login.js'));

test('Spotify authorization requests playlist read permissions', function (t, done) {
  var originalLimit = lib.rateLimit, originalConfig = lib.config;
  lib.rateLimit = function (req, bucket, limit, seconds, callback) { callback(null, false); };
  lib.config = function () { return { id: 'client-id', secret: 'client-secret', redirect: 'https://app.example/api/auth/callback' }; };
  var res = helpers.fakeRes();
  login(helpers.fakeReq('GET', '/api/auth/login'), res);
  setImmediate(function () {
    lib.rateLimit = originalLimit;
    lib.config = originalConfig;
    assert.strictEqual(res.statusCode, 302);
    var authorize = new URL(res.headers.Location);
    var scopes = authorize.searchParams.get('scope').split(' ');
    assert.ok(scopes.indexOf('playlist-read-private') !== -1);
    assert.ok(scopes.indexOf('playlist-read-collaborative') !== -1);
    done();
  });
});
