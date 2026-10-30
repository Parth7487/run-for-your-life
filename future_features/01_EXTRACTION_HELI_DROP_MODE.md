# Feature 01: "Call for Extraction" Evacuation Mode

## 1. Executive Summary
Instead of matches abruptly concluding when the 30-minute timer ticks down to 00:00, the match shifts into an adrenaline-charged final phase: **Extraction Protocol**. An emergency evacuation helicopter LZ drops a beacon at a random GPS coordinate within the arena. Survivors must coordinate over walkie-talkie to sprint to the zone and hold ground for 30 seconds to board the helicopter and achieve Victory.

---

## 2. Gameplay Mechanics

### Timeline & Phase Transition
1. **At T-minus 5:00 Remaining**:
   - Game state transitions from `THE_HUNT` to `EXTRACTION_ACTIVE`.
   - Audio broadcast: Loud air-raid siren followed by tactical pilot radio voice line:
     > *"Mayday Mayday, Evac Chopper inbound. LZ coordinates transmitted. Holding pattern for 5 minutes only. Move!"*
2. **LZ Beacon Placement**:
   - Server calculates a random point inside the arena geofence at least 60m away from current Zombie positions.
   - A pulsing cyan Landing Zone circle (radius: 15m) appears on everyone's Leaflet map.
3. **Extraction Hold Countdown (30 Seconds)**:
   - When a Survivor steps inside the 15m radius of the LZ, their HUD displays a progress bar:
     `🚁 EXTRACTION BOARDING: [████████░░] 21s / 30s`
   - If forced out of the circle by a pursuing Zombie, the timer pauses and begins to decay after 5 seconds.
   - If any Survivor completes 30 seconds:
     - All alive survivors currently inside the LZ are marked as **`ESCAPED (HEROIC EXTRACTION)`**.
     - Victory horn sounds: *"SURVIVORS EVACUATED — OPERATION SUCCESS!"*
4. **Zombie Counter-Offensive**:
   - Zombie HUD flashes: `⚠️ PREVENT EXTRACTION — INTERCEPT SURVIVORS AT LZ`.
   - The LZ gives zombies a clear target coordinate to sprint toward, forcing intense, dramatic last-second tags at the helicopter doors.

---

## 3. Technical Contract & Architecture

### Server State Additions ([server.js](file:///home/parth/MacProjects/Random/Reverse%20eng/game/server.js))
```typescript
interface ExtractionZone {
  lat: number;
  lng: number;
  radiusMeters: 15;
  active: boolean;
  evacDeadlineMs: number;
  occupants: Map<string, { enteredAt: number; accumulatedSeconds: number }>;
}
```

### Client Message Handling ([public/app.js](file:///home/parth/MacProjects/Random/Reverse%20eng/game/public/app.js))
- Message type: `EXTRACTION_CALLED`
  - Payload: `{ lzLat, lzLng, radius: 15, timeoutSeconds: 300 }`
  - Client actions: Render cyan pulsing LZ polygon, play siren, update HUD clock to `EVAC: 05:00`.
- Message type: `EXTRACTION_PROGRESS`
  - Payload: `{ playerId, currentHoldSeconds, requiredSeconds: 30 }`
  - Client actions: Animate radial progress ring around survivor token on map and HUD pill.
