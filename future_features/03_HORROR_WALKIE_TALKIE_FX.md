# Feature 03: Horror Walkie-Talkie FX & Static Interference

## 1. Executive Summary
Elevates the existing Push-to-Talk voice radio into an immersive psychological horror device. Rather than functioning like a clean modern phone call, the radio behaves like a battered, authentic military frequency subject to proximity radio frequency (RF) distortion, zombie bio-static interference, and emergency death alerts.

---

## 2. Audio Mechanics

### 1. 15-Meter Proximity Radio Distortion
- When an infected Zombie approaches within **15 meters** of any transmitting or receiving Survivor:
  - An eerie high-pass white noise hiss and simulated 60Hz radio hum fades into the survivor's audio output.
  - The voice stream becomes slightly pitch-shifted with low-frequency rumble, signaling that a predator is dangerously close even if the survivor isn't looking at their phone screen!

### 2. "Last Gasp" Emergency Cut-Off
- If a Survivor is holding down the Walkie-Talkie button when they are tagged and infected:
  - The audio stream is violently truncated with a 0.5s static burst followed by a continuous emergency flatline tone.
  - An automated tactical voice synthesizer broadcasts to all remaining survivors:
    > *"EMERGENCY: Operative [Callsign] vital signs flatlined. Bio-infection spread."*
  - Immediately strikes terror into the surviving teammates who hear their partner cut off mid-sentence.

### 3. Ghost Frequency / Zombie Taunt (Final 60 Seconds)
- During the final 60 seconds of a match or when only 1 survivor remains:
  - Zombies unlock a 10-second "Ghost Transmission" window.
  - Zombie voice is processed with a heavy pitch-down downward octave and robotic reverb, allowing them to broadcast an ominous psychological taunt to the last survivor.

---

## 3. Technical Implementation

### Web Audio Distortion Filter Node ([public/sound.js](file:///home/parth/MacProjects/Random/Reverse%20eng/game/public/sound.js))
```javascript
function applyRadioStaticFilter(audioContext, sourceNode, proximityDistanceMeters) {
  if (proximityDistanceMeters >= 20) return sourceNode;

  // Bandpass filter mimicking 300Hz-3000Hz military walkie-talkie
  const bandpass = audioContext.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 1400;
  bandpass.Q.value = 1.8;

  // WaveShaper distortion node proportional to proximity (closer = harsher distortion)
  const distortion = audioContext.createWaveShaper();
  const intensity = Math.max(0, 1 - (proximityDistanceMeters / 20));
  distortion.curve = makeDistortionCurve(intensity * 50);

  sourceNode.connect(bandpass);
  bandpass.connect(distortion);
  return distortion;
}
```
