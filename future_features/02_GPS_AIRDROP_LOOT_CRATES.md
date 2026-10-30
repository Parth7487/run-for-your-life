# Feature 02: Real-World GPS Airdrop Loot Crates

## 1. Executive Summary
Brings tactical real-world geocaching and battle-royale supply crates into physical parks, neighborhoods, and campuses. Every 5 to 8 minutes, an **Airdrop Crate** parachute drops onto a random physical GPS coordinate within 100–200 meters. The first player to physically reach within 8 meters unlocks game-changing power-ups.

---

## 2. Supply Crate Mechanics

### Crate Spawn & Parachute Sequence
1. **Spawn Announcement**:
   - Audio: Military jet flyover audio effect + parachute whistle.
   - Map: A gold crate icon with a descending parachute animates onto the Leaflet map.
   - Text banner: `📦 TACTICAL AIRDROP DETECTED IN SECTOR 3 (140m NORTH-EAST)`.
2. **Physical Collection**:
   - Radius: 8 meters (GPS proximity threshold).
   - Once collected, the crate disappears and awards the player one of 4 tactical consumables into their 2 HUD power-up inventory slots (`#hud-powerup-container`).

---

## 3. The 4 Power-Up Consumables

| Power-Up | Visual Icon | Duration | Tactical Effect |
|----------|-------------|----------|-----------------|
| **Smoke Screen (Cloak)** | 🥷 | 60 sec | Completely hides the survivor's blip and ping marker from the Zombie's radar screen. |
| **Decoy Flare** | 🎆 | 45 sec | Spawns a fake, moving "Survivor" blip on the zombie's radar 200m away in the opposite direction, luring them away. |
| **Adrenaline Shot** | 💉 | 30 sec | Grants temporary tag immunity. If a zombie attempts a QR scan or manual tag, it rejects with: *"Target Under Adrenaline Surge"*. |
| **Radar Jammer (EMP)** | 📻 | 45 sec | Blasts the zombie's radar screen with static noise, scrambled blips, and false proximity alarms. |

---

## 4. Technical Architecture

### Crate State ([server.js](file:///home/parth/MacProjects/Random/Reverse%20eng/game/server.js))
```typescript
interface AirdropCrate {
  id: string;
  lat: number;
  lng: number;
  droppedAt: number;
  itemType: 'SMOKE_SCREEN' | 'DECOY_FLARE' | 'ADRENALINE' | 'RADAR_JAMMER';
  claimedBy: string | null;
}
```

### Proximity Check on Position Tick
When `UPDATE_LOCATION` is received:
```javascript
const dist = haversineMeters(player.lat, player.lng, crate.lat, crate.lng);
if (dist <= 8 && !crate.claimedBy) {
  crate.claimedBy = playerId;
  awardPowerupToPlayer(room, player, crate.itemType);
  broadcastToRoom(room, {
    type: 'AIRDROP_CLAIMED',
    crateId: crate.id,
    claimedByName: player.name,
    itemType: crate.itemType
  });
}
```
