// Tactical Sound Synthesizer & Authentic PlayCulture Audio Engine
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.audioCache = new Map();
    this.audioFiles = {
      ping: 'assets/audio/appsound_blip1.wav',
      click: 'assets/audio/appsound_click1.wav',
      bell: 'assets/audio/appsound_bell1.wav',
      infection: 'assets/audio/appsound_watermelon1.wav',
      fanfare: 'assets/audio/seektagGameEnd.mp3'
    };
    this.preloadAudio();
  }

  preloadAudio() {
    for (const [key, path] of Object.entries(this.audioFiles)) {
      try {
        const audio = new Audio(path);
        audio.preload = 'auto';
        this.audioCache.set(key, audio);
      } catch (e) {
        // Fallback to procedural synthesis if Audio element fails
      }
    }
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playCachedAudio(key, fallbackFn) {
    if (this.muted) return;
    const cached = this.audioCache.get(key);
    if (cached) {
      const clone = cached.cloneNode();
      clone.volume = 0.85;
      clone.play().catch(() => {
        fallbackFn?.();
      });
    } else {
      fallbackFn?.();
    }
  }

  // Tactical Sonar Radar Ping sound (PlayCulture Blip)
  playPing() {
    this.playCachedAudio('ping', () => this.proceduralPing());
  }

  proceduralPing() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.35);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.9);
  }

  // Tactical Proximity Beep (Sonar alert for Survivor when Zombie is within 15 meters)
  playProximityBeep(distance = 15) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Scale pitch & volume: closer = higher frequency & louder
    const clampedDist = Math.max(1, Math.min(15, distance));
    const urgency = (15 - clampedDist) / 10; // 0.0 at 15m -> 1.0 at 5m
    const freq = 900 + urgency * 600; // 900Hz up to 1500Hz
    const volume = 0.25 + urgency * 0.35; // 0.25 up to 0.60
    const duration = 0.10 - urgency * 0.03; // 100ms down to 70ms crisp pip

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.25, now + duration);

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + duration);
  }

  // Heartbeat countdown tick for tension
  playHeartbeat(fast = false) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(fast ? 90 : 70, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.12);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.15);
  }

  // Tactical Alert Bell / Game Start Chime (PlayCulture Bell)
  playBell() {
    this.playCachedAudio('bell', () => this.playPing());
  }

  // Tag Alarm & Watermelon Infection Impact
  playTagAlarm() {
    this.playCachedAudio('infection', () => this.proceduralTagAlarm());
  }

  proceduralTagAlarm() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.linearRampToValueAtTime(800, now + 0.15);
    osc.frequency.linearRampToValueAtTime(350, now + 0.3);
    osc.frequency.linearRampToValueAtTime(750, now + 0.45);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.6);
  }

  // Button click blip (PlayCulture Click)
  playClick() {
    this.playCachedAudio('click', () => this.proceduralClick());
  }

  proceduralClick() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  }

  // Round End / Game Over Fanfare (PlayCulture SeekTag End Theme)
  playFanfare() {
    this.playCachedAudio('fanfare', () => this.proceduralFanfare());
  }

  proceduralFanfare() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const notes = [440, 554, 659, 880];
    notes.forEach((freq, i) => {
      const now = this.ctx.currentTime + i * 0.12;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    });
  }

  // Tactical Walkie-Talkie: Radio Key-Up (Mic Open / Squelch Burst)
  playRadioStart() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // 1. Chirp Beep (PTT click)
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1950, now);
    osc.frequency.exponentialRampToValueAtTime(1400, now + 0.04);
    oscGain.gain.setValueAtTime(0.25, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);

    // 2. White noise burst (Radio static / squelch)
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.06);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2200, now + 0.02);
    filter.Q.setValueAtTime(2.5, now + 0.02);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.2, now + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);

    whiteNoise.start(now + 0.02);
    whiteNoise.stop(now + 0.08);
  }

  // Tactical Walkie-Talkie: Roger Beep & Squelch Tail (Mic Released)
  playRadioEnd() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // 1. Dual-Tone Roger Beep (1760Hz -> 1320Hz)
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1760, now);
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.07);
    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.07);

    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, now + 0.07);
    gain2.gain.setValueAtTime(0.25, now + 0.07);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    osc2.start(now + 0.07);
    osc2.stop(now + 0.14);

    // 2. Radio Squelch Tail (Static burst on channel close)
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.08);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, now + 0.13);
    filter.Q.setValueAtTime(3.0, now + 0.13);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.22, now + 0.13);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);

    whiteNoise.start(now + 0.13);
    whiteNoise.stop(now + 0.22);
  }

  // Eerie horror tension stinger when a Zombie is within 20 meters of a Survivor
  playZombieNearScarySound(distance = 20) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    if (this._lastScarySoundTime && now - this._lastScarySoundTime < 2.5) {
      return; // Throttled to avoid deafening or overlapping audio
    }
    this._lastScarySoundTime = now;

    const clampedDist = Math.max(1, Math.min(20, distance));
    const proximity = (20 - clampedDist) / 20; // 0.0 at 20m -> 1.0 at 1m

    // 1. Dual detuned ominous sub-bass oscillators (deep horror rumble)
    const baseFreq = 68 + proximity * 18; // 68Hz - 86Hz
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(baseFreq, now);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 0.82, now + 1.4);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(baseFreq * 1.05 + 1.5, now); // Dissonant beating
    osc2.frequency.exponentialRampToValueAtTime(baseFreq * 0.88, now + 1.4);

    // Lowpass filter for muffled dark dread
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(170 + proximity * 120, now);
    filter.Q.setValueAtTime(4.0, now);

    const volume = 0.25 + proximity * 0.18;
    subGain.gain.setValueAtTime(volume * 0.2, now);
    subGain.gain.linearRampToValueAtTime(volume, now + 0.3);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(subGain);
    subGain.connect(this.ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.6);
    osc2.stop(now + 1.6);

    // 2. High eerie whisper tension sting (dissonant tritones)
    const stingOsc = this.ctx.createOscillator();
    const stingGain = this.ctx.createGain();
    stingOsc.type = 'sine';
    stingOsc.frequency.setValueAtTime(880 + (1 - proximity) * 110, now + 0.05);
    stingOsc.frequency.linearRampToValueAtTime(830, now + 1.2);

    stingGain.gain.setValueAtTime(0.001, now);
    stingGain.gain.linearRampToValueAtTime(0.08 + proximity * 0.06, now + 0.2);
    stingGain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);

    stingOsc.connect(stingGain);
    stingGain.connect(this.ctx.destination);

    stingOsc.start(now + 0.05);
    stingOsc.stop(now + 1.3);
  }
}

window.soundEngine = new SoundEngine();
