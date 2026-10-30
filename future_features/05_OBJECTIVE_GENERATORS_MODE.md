# Feature 05: Objective "Power Relay / Repair Generators" Mode

## 1. Executive Summary
In pure hide-and-seek tag, survivors occasionally find an obscure hiding spot (e.g., behind a locked gate or dense grove) and refuse to move for 40 minutes, causing passive and boring gameplay.

**Power Relay Mode** transforms the match into an objective-driven stealth game (similar to *Dead by Daylight* or *Among Us* in the real world). To escape, Survivors must physically locate, reach, and "repair" **3 Power Generators** scattered across the arena before the exit doors open.

---

## 2. Objective Mechanics

### 1. The 3 Generator Stations
- Placed dynamically around the perimeter of the safe zone:
  - ⚡ **Generator Alpha** (e.g. North Playground / Park Entrance)
  - ⚡ **Generator Bravo** (e.g. East Fountain / Pavilion)
  - ⚡ **Generator Charlie** (e.g. West Tree Line / Parking Edge)
- Each generator appears as a yellow battery icon on the survivors' map.

### 2. Repairing a Generator
- A Survivor must stand within **10 meters** of the generator.
- Tapping **"REPAIR GENERATOR"** starts an on-screen hacking minigame:
  - Takes **20 seconds of continuous presence**.
  - If 2 Survivors repair together, it completes in **10 seconds**!
  - If the survivor runs away (because a zombie approaches), progress pauses.
- **Auditory Risk**: When a generator reaches 100%, it spools up with a loud motor sound and sends an audible chime across the neighborhood!

### 3. Exit Gates Powered
- When all 3 generators are repaired:
  - The main **Perimeter Evacuation Gate** powers on.
  - Survivors have 3 minutes to reach the gate to escape and win!

---

## 3. Technical Contract

### Generator Data Structure ([server.js](file:///home/parth/MacProjects/Random/Reverse%20eng/game/server.js))
```typescript
interface GeneratorObjective {
  id: string; // 'gen_alpha' | 'gen_bravo' | 'gen_charlie'
  name: string;
  lat: number;
  lng: number;
  progressPercent: number; // 0 to 100
  isRepaired: boolean;
  repairingPlayerIds: Set<string>;
}
```
