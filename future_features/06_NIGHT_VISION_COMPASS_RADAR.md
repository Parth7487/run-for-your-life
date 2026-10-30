# Feature 06: Night Vision & Directional Compass Flashlight Radar

## 1. Executive Summary
Designed specifically for late evening and night games in dark parks, university campuses, or residential blocks.

In standard daylight mode, players have an omnidirectional 360° radar screen. In **Night Vision Mode**, the radar operates like a tactical flashlight: you can only see radar blips in the **90° cone where you physically point your smartphone**, driven by the device's hardware digital magnetometer (compass) and gyroscope.

---

## 2. Gameplay Mechanics

### 1. Flashlight Sweep & Scan
- To check behind you or around corners, you must physically pivot your body and sweep your phone like a flashlight.
- A glowing green/amber cone of light emanates from your position marker on the map in the exact direction you are facing.
- Blips outside the 90° cone are hidden in the shadows (`opacity: 0`).

### 2. Tactical Flash / Pulse Toggle
- Tapping the on-screen **"FLASH SCAN"** button emits a 360° high-power pulse that reveals all blips for 2 seconds.
- **The Risk**: Emitting a Flash Scan broadcasts your exact location to the enemy for 5 seconds!

---

## 3. Technical Integration

### Device Orientation API ([public/app.js](file:///home/parth/MacProjects/Random/Reverse%20eng/game/public/app.js))
```javascript
function listenToHardwareCompass(onHeadingChange) {
  if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientation', (event) => {
      let heading = event.alpha; // Compass heading (0-360)
      if (typeof event.webkitCompassHeading !== 'undefined') {
        heading = event.webkitCompassHeading; // iOS Safari
      }
      if (typeof heading === 'number') {
        onHeadingChange(heading);
      }
    }, true);
  }
}
```

### Radar Blip Angular Filtering
```javascript
function isBlipInFlashlightCone(playerHeading, playerLat, playerLng, targetLat, targetLng, coneAngle = 90) {
  const bearing = calculateBearing(playerLat, playerLng, targetLat, targetLng);
  let diff = Math.abs(playerHeading - bearing) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff <= (coneAngle / 2);
}
```
