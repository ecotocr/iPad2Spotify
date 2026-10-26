/* Winamp Audio Analysis Engine - strict ES5, Safari iOS 9 compatible.
 * Maps the live playback position to Spotify audio-analysis segments and
 * synthesizes a 19-bin spectrum shaped by the Winamp 10-band EQ. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Playback-synced clock. setProgress(ms) re-baselines the reference;
   * getCurrentTime() returns milliseconds since the track started.
   * ------------------------------------------------------------------ */
  var refTime = 0;       // performance.now() at last baseline
  var refMs = 0;         // track position (ms) at that moment
  var pausedMs = 0;      // position when paused
  var playing = false;

  var audioClock = {
    isPlaying: false,    // live-mirrored for external consumers/tests
    setProgress: function (progressMs) {
      refMs = progressMs || 0;
      refTime = performance.now();
      pausedMs = refMs;
    },
    getCurrentTime: function () {
      if (playing) return refMs + (performance.now() - refTime);
      return pausedMs;
    },
    pause: function () {
      if (playing) {
        pausedMs = refMs + (performance.now() - refTime);
        playing = false;
        audioClock.isPlaying = false;
      }
    },
    resume: function () {
      if (!playing) {
        refMs = pausedMs;
        refTime = performance.now();
        playing = true;
        audioClock.isPlaying = true;
      }
    },
    setPausedAt: function (ms) {
      pausedMs = ms || 0;
      refMs = ms || 0;
    }
  };
  window.audioClock = audioClock;

  /* ------------------------------------------------------------------ *
   * Winamp 10-band EQ. Band centers in Hz; slot 10 is the preamp.
   * Gains are stored as linear multipliers (0.25..4.0) via dB.
   * ------------------------------------------------------------------ */
  var EQ_HZ = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  var PREAMP_INDEX = 10;
  window.eqBands = EQ_HZ;

  var eqGains = (function () {
    var a = new Array(EQ_HZ.length + 1);
    for (var i = 0; i < a.length; i++) a[i] = 1.0;
    return a;
  })();

  // Nearest Winamp band index for a given frequency (log-spaced bins).
  function bandForFreq(hz) {
    var best = 0, bd = Infinity, i, d;
    for (i = 0; i < EQ_HZ.length; i++) {
      d = Math.abs(hz - EQ_HZ[i]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Logarithmic center frequency of spectrum bin b (0..BIN_COUNT-1)
  // spanning 60 Hz .. 16 kHz (the Winamp range).
  function binCenterFreq(b, binCount) {
    var lo = Math.log(60), hi = Math.log(16000);
    var t = binCount > 1 ? b / (binCount - 1) : 0;
    return Math.exp(lo + (hi - lo) * t);
  }

  window.setEQGain = function (bandIndex, db) {
    if (bandIndex < 0 || bandIndex >= eqGains.length) return;
    var lin = Math.pow(10, db / 20);      // -12..+12 dB -> 0.25..4.0
    eqGains[bandIndex] = Math.max(0.25, Math.min(4.0, lin));
  };
  window.getEQGain = function (bandIndex) {
    if (bandIndex < 0 || bandIndex >= eqGains.length) return 1.0;
    return eqGains[bandIndex];
  };

  /* ------------------------------------------------------------------ *
   * Segment store + request handling (with a stale-response guard).
   * ------------------------------------------------------------------ */
  var audioAnalysis = {
    segments: [],
    segmentsMap: {},
    currentSegment: null,
    requestGen: 0,
    init: function () { this.bindEvents(); },
    loadAnalysis: function (payload) {
      this.segments = (payload && payload.segments) || [];
      this.segments.sort(function (a, b) { return a.start - b.start; });
      this.segmentsMap = {};
      this.currentSegment = null;
      for (var i = 0; i < this.segments.length; i++) {
        this.segmentsMap[this.segments[i].start] = this.segments[i];
      }
    },
    bindEvents: function () {
      var self = this;
      var message = function (text) {
        var el = document.getElementById ? document.getElementById('audio-analysis-status') : null;
        if (el) el.innerHTML = text;
      };
      var onAnalysisReceived = function (status, data, reqGen, reqTrack) {
        // Drop stale responses: only accept if this request still owns the track.
        if (window.currentTrackId && window.currentTrackId !== reqTrack) return;
        if (self.requestGen !== reqGen) return;
        if (status === 200 && data && data.segments) {
          self.loadAnalysis(data);
          message('Analysis loaded: ' + data.segments.length + ' segments');
        } else {
          message('Analysis unavailable');
        }
      };
      var sendRequest = function () {
        var trackId = window.currentTrackId;
        if (!trackId) { message('No track loaded'); return; }
        self.requestGen += 1;
        var gen = self.requestGen;
        var url = '/api/spotify/audio-analysis?trackId=' + encodeURIComponent(trackId);
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 30000;
        xhr.onreadystatechange = function () {
          if (xhr.readyState === 4) {
            var data = {};
            try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
            onAnalysisReceived(xhr.status, data, gen, trackId);
          }
        };
        xhr.ontimeout = function () { onAnalysisReceived(408, {}, gen, trackId); };
        xhr.onerror = function () { onAnalysisReceived(0, {}, gen, trackId); };
        xhr.send();
      };
      window.requestAudioAnalysis = sendRequest;
      window.audioAnalysis = self;
    }
  };

  /* ------------------------------------------------------------------ *
   * Spectrum synthesis: 12 pitch classes + 12 timbre + loudness ->
   * BIN_COUNT bins, then scaled by the Winamp EQ (band gain + preamp).
   * ------------------------------------------------------------------ */
  var BIN_COUNT = 19;
  var TAU = 2 * Math.PI;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Interpolate the value at a fractional index into a 12-entry vector.
  function lerpVec(vec, pos) {
    if (!vec) return 0;
    var i = Math.floor(pos), f = pos - i;
    var a = vec[i] || 0, b = vec[Math.min(i + 1, vec.length - 1)] || 0;
    return a + (b - a) * f;
  }

  // Map a single segment's pitch/timbre/loudness to BIN_COUNT 0..1 bins
  // before EQ. Pitches shape the low-mid content; timbre shapes brightness.
  function segmentToBans(seg, out) {
    var pitches = seg.pitches || [];
    var timbre = seg.timbre || [];
    var loud = seg.loudness_max;
    var loudScale = clamp((typeof loud === 'number' ? loud + 60 : 20) / 40, 0.15, 1.2);
    for (var b = 0; b < out.length; b++) {
      var t = out.length > 1 ? b / (out.length - 1) : 0;        // 0 low .. 1 high
      var ppos = t * 11;                                        // pitch bin 0..11
      var pitchE = clamp(lerpVec(pitches, ppos), 0, 1);
      var timbE = clamp(lerpVec(timbre, ppos), 0, 1);
      var low = pitchE * (1 - 0.5 * t);                         // lows from pitch
      var high = timbE * t * 0.8;                               // highs from timbre
      var raw = 0.55 * low + 0.5 * high + 0.25 * pitchE;
      out[b] = clamp(raw * loudScale, 0, 1);
    }
  }

  var analyzeNow = function () {
    var self = window.audioAnalysis;
    var clock = window.audioClock;
    var empty = (function () { var a = new Array(BIN_COUNT); for (var i = 0; i < a.length; i++) a[i] = 0; return a; })();

    if (!self || !self.segments || self.segments.length === 0) {
      return { loudness: 0, frequencies: empty, eqApplied: false };
    }

    var nowSec = clock.getCurrentTime() / 1000;
    var seg = null;
    for (var i = 0; i < self.segments.length; i++) {
      if (self.segments[i].start <= nowSec) seg = self.segments[i];
      else break;
    }
    if (!seg) seg = self.segments[0];
    self.currentSegment = seg;

    var freqBins = new Array(BIN_COUNT);
    segmentToBans(seg, freqBins);

    // Apply EQ: per-bin band gain, then the preamp across all bins.
    var preamp = window.getEQGain ? window.getEQGain(PREAMP_INDEX) : 1.0;
    var eqApplied = false;
    for (var b = 0; b < BIN_COUNT; b++) {
      var center = binCenterFreq(b, BIN_COUNT);
      var band = bandForFreq(center);
      var gain = (window.getEQGain ? window.getEQGain(band) : 1.0);
      freqBins[b] = clamp(freqBins[b] * gain * preamp, 0, 2);
      if (gain !== 1 || preamp !== 1) eqApplied = true;
    }

    return {
      loudness: typeof seg.loudness_max === 'number' ? seg.loudness_max : -60,
      frequencies: freqBins,
      eqApplied: eqApplied,
      currentSegmentId: seg.start ? Math.round(seg.start * 1000) : 0
    };
  };
  window.analyzeNow = analyzeNow;

  // Bridge for winamp.js: pollable, pre-EQ real spectrum for the current track.
  // winamp.js resamples + EQ-weights these bands in its own render loop, so the
  // Winamp EQ knobs (and EQ OFF) keep shaping the visualizer.
  window.getAudioAnalysisBands = function () {
    var self = window.audioAnalysis;
    if (!self || !self.segments || self.segments.length === 0) return null;
    var res = analyzeNow();
    return {
      frequencies: res.frequencies,
      trackId: window.currentTrackId || null
    };
  };

  audioAnalysis.init();
})();
