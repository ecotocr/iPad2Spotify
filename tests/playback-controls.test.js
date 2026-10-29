var test = require('node:test');
var assert = require('node:assert');
var playbackControls = require('../public/js/playback-controls.js');

test('previous skips tracks through exactly three seconds', function () {
  assert.strictEqual(playbackControls.previousAction({ progress_ms: 0, is_playing: false }, 0), 'previous');
  assert.strictEqual(playbackControls.previousAction({ progress_ms: 3000, is_playing: false }, 0), 'previous');
  assert.strictEqual(playbackControls.previousAction({ progress_ms: 3001, is_playing: false }, 0), 'restart');
});

test('previous uses live elapsed time for a playing track', function () {
  var playback = { progress_ms: 2500, is_playing: true, fetched_at: 10000 };
  assert.strictEqual(playbackControls.previousAction(playback, 10500), 'previous');
  assert.strictEqual(playbackControls.previousAction(playback, 10501), 'restart');
});
