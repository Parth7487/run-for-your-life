# Feature 04: Post-Match 10x Sat-Map Replay

## 1. Executive Summary
The single most viral and requested social feature in real-world location-based games. After a game terminates, players constantly ask: *"Where were you hiding?! How did you not see me when I ran right past that tree?!"*

The **Sat-Map Replay** provides an interactive, fast-forwarded (10x / 20x) timeline player directly on the Game Over screen ([#screen-game-over](file:///home/parth/MacProjects/Random/Reverse%20eng/game/public/index.html#L702)), animating all players' recorded GPS trajectories simultaneously across the arena map.

---

## 2. Replay Experience & UI

### 1. Interactive Timeline Scrubber
- Full Play / Pause controls.
- Speed toggle: `1x` (Real-Time), `5x`, `10x`, `20x`.
- Timeline progress bar showing the match elapsed time: `14:23 / 30:00`.

### 2. Live Blip Trail Animation
- Each operative has a distinct glowing trail:
  - 🏃 **Survivors**: Electric Blue / Golden trails.
  - 🧟 **Zombies**: Crimson Red trails.
- When an operative gets infected, an animated red shockwave explosion blooms on the map at the exact GPS coordinate, and their trail turns from Blue to Red!
- Proximity Near-Misses (< 10m where the zombie ran past the survivor) pulse with a yellow warning flash on the replay timeline.

### 3. One-Click Social Sharing
- Generates a lightweight 15-second animated canvas recording or WebM video:
  - Branded with the **RUN FOR YOUR LIFE** HUD overlay, player names, and final match stats.
  - Ready for instant 1-tap export to Instagram Stories, TikTok, or WhatsApp status.

---

## 3. Technical Contract

### Match Trajectory Payload from Server
```typescript
interface MatchReplayPayload {
  roomCode: string;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  players: {
    id: string;
    name: string;
    initialRole: 'survivor' | 'zombie';
    infectedAt: number | null;
    path: Array<{ lat: number; lng: number; time: number }>;
  }[];
  events: Array<{
    type: 'INFECTION' | 'ESCAPE' | 'AIRDROP_CLAIM';
    time: number;
    lat: number;
    lng: number;
    actorId: string;
    targetId?: string;
  }>;
}
```

### Canvas / Leaflet Interpolator ([public/app.js](file:///home/parth/MacProjects/Random/Reverse%20eng/game/public/app.js))
- Uses linear coordinate interpolation (`L.latLng`) based on the current scrubber timestamp:
  `lat = p1.lat + (p2.lat - p1.lat) * factor`
- Smooth 60fps animation using `requestAnimationFrame`.
