# Run for Your Life — Future Features & Game Modes Roadmap

This directory stores the complete design blueprints, technical architectures, and gameplay specifications for upcoming features and game modes in **Run for Your Life** (Real-Life GPS Tactical Multiplayer Game).

---

## 🗺️ Master Index of Features & Modes

| # | Specification Document | Category | Impact | Description |
|---|------------------------|----------|--------|-------------|
| **1** | [01_EXTRACTION_HELI_DROP_MODE.md](file:///home/parth/MacProjects/Random/Reverse%20eng/game/future_features/01_EXTRACTION_HELI_DROP_MODE.md) | Game Mode | 🔥 High | Final 5-minute Emergency Heli LZ. Survivors must reach the zone and hold for 30s while zombies rush to ambush. |
| **2** | [02_GPS_AIRDROP_LOOT_CRATES.md](file:///home/parth/MacProjects/Random/Reverse%20eng/game/future_features/02_GPS_AIRDROP_LOOT_CRATES.md) | Mechanics | ⚡ High | Real-world GPS loot crates with Smoke Screens (Cloak), Decoy Pings, Adrenaline immunity, and Radar Jammers. |
| **3** | [03_HORROR_WALKIE_TALKIE_FX.md](file:///home/parth/MacProjects/Random/Reverse%20eng/game/future_features/03_HORROR_WALKIE_TALKIE_FX.md) | Audio & Immersion | 📻 High | 15m proximity radio static, zombie breathing interference, and automated "Operative Compromised" death squelch. |
| **4** | [04_SAT_MAP_POST_MATCH_REPLAY.md](file:///home/parth/MacProjects/Random/Reverse%20eng/game/future_features/04_SAT_MAP_POST_MATCH_REPLAY.md) | Social / Viral | 🎬 Ultra | 10x-20x fast-forward animated GPS trail replay on the arena map showing near-misses and tag moments. |
| **5** | [05_OBJECTIVE_GENERATORS_MODE.md](file:///home/parth/MacProjects/Random/Reverse%20eng/game/future_features/05_OBJECTIVE_GENERATORS_MODE.md) | Game Mode | 🎯 High | Survivors must visit and repair 3 GPS waypoints (Substations) for 20s to power up escape gates. |
| **6** | [06_NIGHT_VISION_COMPASS_RADAR.md](file:///home/parth/MacProjects/Random/Reverse%20eng/game/future_features/06_NIGHT_VISION_COMPASS_RADAR.md) | Night Mode | 🔦 Medium | Directional 90° flashlight radar beam driven by phone compass/gyroscope instead of 360° radar. |
| **7** | [07_VIP_ANTIDOTE_ESCORT_MODE.md](file:///home/parth/MacProjects/Random/Reverse%20eng/game/future_features/07_VIP_ANTIDOTE_ESCORT_MODE.md) | Game Mode | 🏆 Medium | 1 survivor carries the Antidote with periodic beaconing; teammates act as decoys and bodyguards. |

---

## 🏗️ Implementation Guidelines
When ready to implement any feature:
1. Engine protocols stay in provider/adapter layers, never infiltrating pure domain models.
2. Maintain fail-closed process safety and zero orphaned WebSockets or intervals.
3. Keep all contracts strictly validated with shared message types.
