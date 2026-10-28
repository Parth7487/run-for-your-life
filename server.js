import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

// Powerup Catalog definitions
const POWERUP_CATALOG = {
  CLOAK: {
    id: 'CLOAK',
    name: 'Cloak',
    cost: 25,
    role: 'survivor',
    durationSeconds: 30,
    description: 'Stealth: Hidden from zombie radar and immune to proximity infection for 30s.'
  },
  CLOAK_PLUS: {
    id: 'CLOAK_PLUS',
    name: 'Cloak+',
    cost: 45,
    role: 'survivor',
    durationSeconds: 60,
    description: 'Extended Stealth: Invisibility from radar and proximity infect for 60s.'
  },
  ANTI_CLOAK: {
    id: 'ANTI_CLOAK',
    name: 'Anti-Cloak',
    cost: 30,
    role: 'both',
    durationSeconds: 30,
    description: 'Sensor: Pierces stealth, revealing cloaked players on radar within 100m.'
  },
  RADAR_EXTEND: {
    id: 'RADAR_EXTEND',
    name: 'Radar Extend',
    cost: 20,
    role: 'both',
    durationSeconds: 45,
    description: 'Radar range increased by 1.5x for 45s.'
  },
  RADAR_EXTEND_PLUS: {
    id: 'RADAR_EXTEND_PLUS',
    name: 'Radar Extend+',
    cost: 35,
    role: 'both',
    durationSeconds: 60,
    description: 'Radar range increased by 2.5x for 60s.'
  },
  FRESH_MEAT: {
    id: 'FRESH_MEAT',
    name: 'Fresh Meat',
    cost: 25,
    role: 'zombie',
    durationSeconds: 30,
    description: 'Scent Trail: Pings bearing and distance to the nearest living survivor.'
  }
};

// Rooms and client mappings
const rooms = new Map();
const clients = new Map(); // ws -> { roomId, playerId }

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return 999999;
  const R = 6371e3; // meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180));
  const x =
    Math.cos(lat1 * (Math.PI / 180)) * Math.sin(lat2 * (Math.PI / 180)) -
    Math.sin(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.cos((lon2 - lon1) * (Math.PI / 180));
  const theta = Math.atan2(y, x);
  return (theta * (180 / Math.PI) + 360) % 360;
}

// Generate default procedural zones around an arena center point
function generateDefaultZones(centerLat, centerLng, arenaRadius = 300) {
  const R_EARTH = 6371e3;
  const offsetCoord = (lat, lng, distMeters, angleRad) => {
    const dLat = (distMeters * Math.cos(angleRad)) / R_EARTH;
    const dLng = (distMeters * Math.sin(angleRad)) / (R_EARTH * Math.cos((lat * Math.PI) / 180));
    return {
      lat: lat + (dLat * 180) / Math.PI,
      lng: lng + (dLng * 180) / Math.PI
    };
  };

  const zones = [];

  // 1. Arena Center (Zombie Powerup Shop & Gathering Hub)
  zones.push({
    id: 'zone_center',
    type: 'ARENA_CENTER',
    name: 'Arena Hub',
    lat: centerLat,
    lng: centerLng,
    radius: 25,
    powerupShop: true,
    active: true
  });

  // 2. Health Zones (Distributed in cardinal directions)
  const healthOffsetDist = Math.max(60, arenaRadius * 0.45);
  const angles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];

  angles.forEach((angle, idx) => {
    const coord = offsetCoord(centerLat, centerLng, healthOffsetDist, angle);
    zones.push({
      id: `zone_health_${idx + 1}`,
      type: 'HEALTH_ZONE',
      name: `Sanctuary ${idx + 1}`,
      lat: coord.lat,
      lng: coord.lng,
      radius: 22,
      powerupShop: false,
      active: true
    });
  });

  // 3. Health+ Zone (Refill + Survivor Powerup Shop)
  const healthPlusCoord = offsetCoord(centerLat, centerLng, healthOffsetDist * 0.8, Math.PI / 2);
  zones.push({
    id: 'zone_health_plus',
    type: 'HEALTH_PLUS_ZONE',
    name: 'Supply Outpost (Health+)',
    lat: healthPlusCoord.lat,
    lng: healthPlusCoord.lng,
    radius: 25,
    powerupShop: true,
    active: true
  });

  // 4. Extraction Zone (Outer rim, activates during final 20%)
  const extractCoord = offsetCoord(centerLat, centerLng, arenaRadius * 0.75, (Math.PI * 5) / 4);
  zones.push({
    id: 'zone_extraction',
    type: 'EXTRACTION_ZONE',
    name: 'Extraction Zone Omega',
    lat: extractCoord.lat,
    lng: extractCoord.lng,
    radius: 30,
    powerupShop: false,
    active: false // Unlocks in final phase
  });

  return zones;
}

function broadcastToRoom(room, data) {
  const msg = JSON.stringify(data);
  for (const client of room.sockets.values()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function sendToPlayer(room, playerId, data) {
  const socket = room.sockets.get(playerId);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

// HTTP Server
const server = http.createServer((req, res) => {
  // Over-The-Air (OTA) live version checking endpoint
  if (req.url && req.url.startsWith('/api/version')) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(
      JSON.stringify({
        app: 'Run for Your Life',
        version: '1.2.0',
        build: '2026.10.28-hot-sync',
        features: [
          'Push-to-Talk Walkie-Talkie',
          '20m Zombie Horror Threat',
          'Live GPS High Accuracy',
          '1-Click Cloud Hot Update'
        ],
        timestamp: Date.now()
      })
    );
    return;
  }

  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

// WebSocket Server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const playerId = 'p_' + Math.random().toString(36).substring(2, 9);
  clients.set(ws, { playerId, roomId: null });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleMessage(ws, playerId, msg);
    } catch (e) {
      console.error('Error handling WebSocket message:', e);
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client && client.roomId) {
      const room = rooms.get(client.roomId);
      if (room) {
        const effectiveId = client.playerId || playerId;
        room.sockets.delete(effectiveId);
        const player = room.players.get(effectiveId);
        if (player) {
          player.connected = false;
          player.disconnectedAt = Date.now();
          player.graceSeconds = 90;

          broadcastToRoom(room, {
            type: 'PLAYER_DISCONNECTED_BUFFER',
            playerId: player.id,
            playerName: player.name,
            graceSeconds: 90
          });

          if (player.graceTimeout) clearTimeout(player.graceTimeout);
          player.graceTimeout = setTimeout(() => {
            if (!player.connected) {
              room.players.delete(player.id);
              broadcastToRoom(room, {
                type: 'PLAYER_REMOVED_TIMEOUT',
                playerId: player.id,
                playerName: player.name
              });
              checkEndConditions(room);

              const activeCount = Array.from(room.players.values()).filter((p) => p.connected).length;
              if (activeCount === 0) {
                if (room.timer) clearInterval(room.timer);
                rooms.delete(room.code);
              }
            }
          }, 90000);
        }

        if (room.hostId === effectiveId) {
          const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
          if (connectedPlayers.length > 0) {
            room.hostId = connectedPlayers[0].id;
          }
        }

        broadcastRoomState(room);
      }
    }
    clients.delete(ws);
  });
});

function handleMessage(ws, initialPlayerId, msg) {
  const currentClient = clients.get(ws);
  const playerId = currentClient?.playerId || initialPlayerId;

  switch (msg.type) {
    case 'CREATE_ROOM': {
      const code = generateRoomCode();
      const arenaCenter = msg.arena || { lat: 37.7749, lng: -122.4194, radius: 300 };
      const zones = msg.zones || generateDefaultZones(arenaCenter.lat, arenaCenter.lng, arenaCenter.radius);

      const room = {
        code,
        hostId: playerId,
        state: 'LOBBY', // LOBBY, HEAD_START, THE_HUNT, EXTRACTION, ENDED
        config: {
          arena: arenaCenter,
          zones,
          roundLength: typeof msg.roundLength === 'number' ? msg.roundLength : 30 * 60, // 30 mins
          headStart: typeof msg.headStart === 'number' ? msg.headStart : 90, // run-away time
          startingZombiesCount: msg.startingZombiesCount || 1,
          modeZombieLottery: msg.modeZombieLottery !== false,
          modeBluetoothTagging: msg.modeBluetoothTagging !== false,
          modeRangeAffectsHealthTick: msg.modeRangeAffectsHealthTick !== false,
          healthTickRate: 1, // 1 coin/sec
          infectionActiveWindow: 10, // 10s burst
          infectionCooldown: 40, // 40s cooldown
          proximityInfectRadius: 20 // 20m proximity catch
        },
        players: new Map(),
        sockets: new Map(),
        phaseStartTime: null,
        timeRemaining: 0,
        chatHistory: [],
        eventsLog: [],
        matchLaunchedAt: null,
        winner: null,
        timer: null
      };

      const hostPlayer = createInitialPlayer(playerId, msg.name || 'Survivor 1', room.config.arena);
      room.players.set(playerId, hostPlayer);
      room.sockets.set(playerId, ws);
      rooms.set(code, room);

      if (currentClient) {
        currentClient.roomId = code;
        currentClient.playerId = playerId;
      }

      ws.send(
        JSON.stringify({
          type: 'ROOM_CREATED',
          roomCode: code,
          playerId,
          hostId: playerId,
          config: room.config,
          players: serializePlayers(room),
          chatHistory: room.chatHistory
        })
      );
      broadcastRoomState(room);
      break;
    }

    case 'JOIN_ROOM': {
      const roomCode = msg.roomCode?.toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found. Check the 6-letter code!' }));
        return;
      }

      // Check for reconnection
      let reconnectingPlayer = null;
      if (msg.playerId && room.players.has(msg.playerId)) {
        reconnectingPlayer = room.players.get(msg.playerId);
      } else if (msg.name) {
        const trimmed = msg.name.trim().toLowerCase();
        for (const p of room.players.values()) {
          if (p.name.toLowerCase() === trimmed) {
            reconnectingPlayer = p;
            break;
          }
        }
      }

      if (reconnectingPlayer) {
        if (reconnectingPlayer.graceTimeout) {
          clearTimeout(reconnectingPlayer.graceTimeout);
          reconnectingPlayer.graceTimeout = null;
        }
        reconnectingPlayer.connected = true;
        reconnectingPlayer.disconnectedAt = null;

        room.sockets.set(reconnectingPlayer.id, ws);
        if (currentClient) {
          currentClient.roomId = room.code;
          currentClient.playerId = reconnectingPlayer.id;
        }

        ws.send(
          JSON.stringify({
            type: 'RECONNECT_SUCCESS',
            roomCode: room.code,
            playerId: reconnectingPlayer.id,
            state: room.state,
            config: room.config,
            timeRemaining: room.timeRemaining,
            player: serializePlayer(reconnectingPlayer),
            players: serializePlayers(room),
            chatHistory: room.chatHistory
          })
        );

        broadcastToRoom(room, {
          type: 'PLAYER_RECONNECTED',
          playerId: reconnectingPlayer.id,
          playerName: reconnectingPlayer.name
        });
        broadcastRoomState(room);
        return;
      }

      // Check 10-minute late join window if match already started
      if (room.state !== 'LOBBY') {
        if (room.state === 'ENDED') {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Match has ended! Return to menu to join or host a new match.' }));
          return;
        }

        const elapsedSinceLaunch = room.matchLaunchedAt ? Math.floor((Date.now() - room.matchLaunchedAt) / 1000) : 0;
        const LATE_JOIN_WINDOW_SECONDS = 600; // 10 minutes

        if (elapsedSinceLaunch > LATE_JOIN_WINDOW_SECONDS) {
          const minsPassed = Math.floor(elapsedSinceLaunch / 60);
          ws.send(JSON.stringify({
            type: 'ERROR',
            message: `Late entry window closed! New operatives can only join within the first 10 minutes (${minsPassed}m elapsed).`
          }));
          return;
        }
      }

      const newPlayerId = msg.playerId && !room.players.has(msg.playerId) ? msg.playerId : playerId;
      let finalName = (msg.name || '').trim() || `Operative ${room.players.size + 1}`;
      let uniqueName = finalName;
      let counter = 2;
      while (Array.from(room.players.values()).some((p) => p.name.toLowerCase() === uniqueName.toLowerCase())) {
        uniqueName = `${finalName} (${counter})`;
        counter++;
      }

      const player = createInitialPlayer(newPlayerId, uniqueName, room.config.arena);
      // Late joiners are deployed as Survivors to run and survive
      player.assignedRole = 'survivor';
      player.rolePreference = 'survivor';
      player.isTagged = false;

      room.players.set(newPlayerId, player);
      room.sockets.set(newPlayerId, ws);

      if (currentClient) {
        currentClient.roomId = room.code;
        currentClient.playerId = newPlayerId;
      }

      ws.send(
        JSON.stringify({
          type: 'ROOM_JOINED',
          roomCode: room.code,
          playerId: newPlayerId,
          hostId: room.hostId,
          role: player.assignedRole,
          config: room.config,
          state: room.state,
          timeRemaining: room.timeRemaining,
          players: serializePlayers(room),
          chatHistory: room.chatHistory
        })
      );

      // If joining an active match in progress, immediately transmit phase & radar
      if (room.state !== 'LOBBY') {
        ws.send(JSON.stringify({
          type: 'PHASE_CHANGED',
          state: room.state,
          startTime: room.phaseStartTime,
          duration: room.state === 'HEAD_START' ? room.config.headStart : room.config.roundLength,
          timeRemaining: room.timeRemaining,
          config: room.config,
          players: serializePlayers(room)
        }));

        const lateJoinChatMsg = {
          id: 'sys_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          senderId: 'SYSTEM',
          senderName: 'ℹ️ SYSTEM ALERT',
          role: 'system',
          text: `🏃 OPERATIVE DEPLOYED: ${player.name} joined the active match as a Survivor!`,
          photoUrl: null,
          timestamp: Date.now()
        };
        room.chatHistory.push(lateJoinChatMsg);
        if (room.chatHistory.length > 50) room.chatHistory.shift();

        broadcastToRoom(room, {
          type: 'CHAT_MESSAGE',
          message: lateJoinChatMsg
        });
      }

      broadcastToRoom(room, {
        type: 'PLAYER_JOINED',
        player: serializePlayer(player),
        players: serializePlayers(room)
      });
      broadcastRoomState(room);
      broadcastTacticalRadar(room);
      break;
    }

    case 'SELECT_ROLE':
    case 'TOGGLE_VOLUNTEER_ZOMBIE': {
      const room = getRoom(ws);
      if (!room || room.state !== 'LOBBY') return;
      const player = room.players.get(playerId);
      if (player) {
        if (msg.role) {
          player.rolePreference = msg.role;
          player.volunteerZombie = (msg.role === 'hunter' || msg.role === 'zombie');
        } else {
          player.volunteerZombie = !!msg.volunteerZombie;
          player.rolePreference = player.volunteerZombie ? 'zombie' : 'survivor';
        }
        broadcastRoomState(room);
      }
      break;
    }

    case 'UPDATE_CONFIG': {
      const room = getRoom(ws);
      if (!room || room.hostId !== playerId || room.state !== 'LOBBY') return;

      if (msg.arena) {
        room.config.arena = msg.arena;
        room.config.zones = generateDefaultZones(msg.arena.lat, msg.arena.lng, msg.arena.radius);
      }
      if (msg.roundLength) room.config.roundLength = parseInt(msg.roundLength, 10);
      if (msg.headStart) room.config.headStart = parseInt(msg.headStart, 10);
      if (msg.startingZombiesCount) {
        room.config.startingZombiesCount = Math.max(1, parseInt(msg.startingZombiesCount, 10));
      }
      if (typeof msg.modeZombieLottery === 'boolean') room.config.modeZombieLottery = msg.modeZombieLottery;
      if (typeof msg.modeBluetoothTagging === 'boolean') room.config.modeBluetoothTagging = msg.modeBluetoothTagging;
      if (typeof msg.modeRangeAffectsHealthTick === 'boolean') {
        room.config.modeRangeAffectsHealthTick = msg.modeRangeAffectsHealthTick;
      }

      broadcastRoomState(room);
      break;
    }

    case 'START_GAME': {
      const room = getRoom(ws);
      if (!room || room.hostId !== playerId || room.state !== 'LOBBY') return;

      if (room.players.size < 1) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Need at least 1 operative to start!' }));
        return;
      }

      // If testing solo with 1 human player, spawn a tactical sparring bot for 1v1 play
      if (room.players.size === 1) {
        const human = Array.from(room.players.values())[0];
        const botId = 'bot_' + Math.random().toString(36).substring(2, 7);
        const centerLat = room.config.arena?.lat || human.lat || 20.464;
        const centerLng = room.config.arena?.lng || human.lng || 72.893;
        const botPlayer = createInitialPlayer(
          botId,
          'Hunter Titan (Bot)',
          room.config.arena
        );
        botPlayer.lat = centerLat + 0.0003;
        botPlayer.lng = centerLng + 0.0003;
        botPlayer.volunteerZombie = true;
        botPlayer.assignedRole = 'zombie';
        botPlayer.rolePreference = 'zombie';
        botPlayer.isBot = true;
        room.players.set(botId, botPlayer);

        human.assignedRole = 'survivor';
        human.volunteerZombie = false;
        human.rolePreference = 'survivor';
      } else {
        assignInitialZombies(room);
      }

      room.matchLaunchedAt = Date.now();
      startHeadStartPhase(room);
      break;
    }

    case 'UPDATE_LOCATION': {
      const room = getRoom(ws);
      if (!room) return;

      const player = room.players.get(playerId);
      if (player && Number.isFinite(msg.lat) && Number.isFinite(msg.lng)) {
        player.lat = msg.lat;
        player.lng = msg.lng;
        player.heading = typeof msg.heading === 'number' && Number.isFinite(msg.heading) ? msg.heading : player.heading;
        player.lastSeen = Date.now();
        player.path.push({ lat: msg.lat, lng: msg.lng, time: Date.now() });
        if (room.state === 'LOBBY' && room.hostId === playerId) {
          if (room.config?.arena && (room.config.arena.lat === 37.7749 || !room.config.arena.lat)) {
            room.config.arena.lat = msg.lat;
            room.config.arena.lng = msg.lng;
            room.config.zones = generateDefaultZones(msg.lat, msg.lng, room.config.arena.radius);
            broadcastRoomState(room);
          }
        }

        if (room.state === 'HEAD_START' || room.state === 'THE_HUNT' || room.state === 'EXTRACTION') {
          const distFromCenter = haversineDistance(player.lat, player.lng, room.config.arena.lat, room.config.arena.lng);
          player.distFromCenter = Math.round(distFromCenter);
          const isNowOOB = distFromCenter > room.config.arena.radius;
          processPlayerBoundaryCheck(room, player, isNowOOB, Date.now());

          // Check zone membership
          player.currentZoneId = null;
          for (const zone of room.config.zones) {
            if (!zone.active && zone.type === 'EXTRACTION_ZONE' && room.state !== 'EXTRACTION') continue;
            const distToZone = haversineDistance(player.lat, player.lng, zone.lat, zone.lng);
            if (distToZone <= zone.radius) {
              player.currentZoneId = zone.id;
              break;
            }
          }

          // Live proximity infection check if zombie is currently infectious
          if (player.assignedRole === 'zombie' && player.isInfectious && room.config.modeBluetoothTagging) {
            checkProximityInfectionsForZombie(room, player);
          }

          broadcastTacticalRadar(room);
        }
      }
      break;
    }

    case 'TRIGGER_INFECTION_BURST': {
      const room = getRoom(ws);
      if (!room || (room.state !== 'THE_HUNT' && room.state !== 'EXTRACTION')) return;

      const zombie = room.players.get(playerId);
      if (!zombie || zombie.assignedRole !== 'zombie') return;

      const now = Date.now();
      if (zombie.nextInfectAvailableAt && now < zombie.nextInfectAvailableAt) {
        const remainingCd = Math.ceil((zombie.nextInfectAvailableAt - now) / 1000);
        ws.send(JSON.stringify({ type: 'ERROR', message: `Infection recharging... Wait ${remainingCd}s` }));
        return;
      }

      zombie.isInfectious = true;
      zombie.infectiousUntil = now + room.config.infectionActiveWindow * 1000;
      zombie.nextInfectAvailableAt = now + (room.config.infectionActiveWindow + room.config.infectionCooldown) * 1000;

      broadcastToRoom(room, {
        type: 'ZOMBIE_INFECTION_TRIGGERED',
        zombieId: zombie.id,
        zombieName: zombie.name,
        duration: room.config.infectionActiveWindow,
        cooldown: room.config.infectionCooldown
      });

      // Immediate proximity check
      checkProximityInfectionsForZombie(room, zombie);
      break;
    }

    case 'CONFIRM_QR_TAG': {
      const room = getRoom(ws);
      if (!room || (room.state !== 'THE_HUNT' && room.state !== 'EXTRACTION')) return;

      // msg: { scannedCode: 'tag_z_...', or victimId: '...' }
      const scanner = room.players.get(playerId);
      if (!scanner) return;

      let zombie = null;
      let survivor = null;

      if (msg.scannedZombieCode) {
        // Survivor scanned Zombie's QR code to admit defeat
        zombie = Array.from(room.players.values()).find((p) => p.assignedRole === 'zombie' && p.tagCode === msg.scannedZombieCode);
        survivor = scanner.assignedRole === 'survivor' ? scanner : null;
      } else if (msg.scannedVictimCode) {
        // Zombie scanned Survivor's code to claim bounty
        zombie = scanner.assignedRole === 'zombie' ? scanner : null;
        survivor = Array.from(room.players.values()).find(
          (p) => p.assignedRole === 'survivor' && p.tagCode === msg.scannedVictimCode
        );
      }

      if (zombie && survivor && !survivor.isTagged) {
        executeInfection(room, zombie, survivor, 'QR_PHYSICAL_TAG');
      } else {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid or already-infected tag code.' }));
      }
      break;
    }

    case 'WALKIE_TALKIE_TRANSMIT': {
      const room = getRoom(ws);
      if (!room) return;

      const sender = room.players.get(playerId);
      if (!sender) return;

      // STRICT SURVIVOR-ONLY ENFORCEMENT:
      // Only active living survivors can broadcast on the walkie-talkie radio.
      // Zombies, infected players, or evacuated players are strictly barred.
      if (sender.assignedRole !== 'survivor' || sender.isTagged || sender.escaped) {
        ws.send(JSON.stringify({
          type: 'ERROR',
          message: 'Radio jammed: only active survivors can use the walkie-talkie frequency.'
        }));
        return;
      }

      if (!msg.audioData || typeof msg.audioData !== 'string') return;

      // Broadcast exclusively to other active survivors in the same room.
      // Zombies never receive this transmission.
      const payload = JSON.stringify({
        type: 'WALKIE_TALKIE_RECEIVE',
        senderId: sender.id,
        senderName: sender.name,
        audioData: msg.audioData,
        mimeType: msg.mimeType || 'audio/webm',
        timestamp: Date.now()
      });

      for (const [pId, socket] of room.sockets.entries()) {
        if (pId === playerId) continue; // Do not echo to sender
        const recipient = room.players.get(pId);
        if (
          recipient &&
          recipient.assignedRole === 'survivor' &&
          !recipient.isTagged &&
          socket.readyState === WebSocket.OPEN
        ) {
          socket.send(payload);
        }
      }
      break;
    }


    case 'BUY_POWERUP': {
      const room = getRoom(ws);
      if (!room || (room.state !== 'THE_HUNT' && room.state !== 'EXTRACTION')) return;

      const player = room.players.get(playerId);
      const powerupDef = POWERUP_CATALOG[msg.powerupId];

      if (!player || !powerupDef) return;

      // Check role eligibility
      if (powerupDef.role !== 'both' && powerupDef.role !== player.assignedRole) {
        ws.send(JSON.stringify({ type: 'ERROR', message: `This powerup is reserved for ${powerupDef.role}s.` }));
        return;
      }

      // Check inventory capacity (Max 2 slots)
      if (player.powerups.length >= 2) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'No space for more powerups (Max 2 slots).' }));
        return;
      }

      // Check location eligibility:
      // Survivors buy at HEALTH_PLUS_ZONE
      // Zombies buy at ARENA_CENTER
      const currentZone = room.config.zones.find((z) => z.id === player.currentZoneId);
      const isEligibleLocation =
        (player.assignedRole === 'survivor' && currentZone?.type === 'HEALTH_PLUS_ZONE') ||
        (player.assignedRole === 'zombie' && currentZone?.type === 'ARENA_CENTER');

      if (!isEligibleLocation) {
        const requiredLoc = player.assignedRole === 'survivor' ? 'Supply Outpost (Health+)' : 'Arena Hub';
        ws.send(JSON.stringify({ type: 'ERROR', message: `Visit ${requiredLoc} to buy powerups.` }));
        return;
      }

      // Check coin cost
      const currency = player.assignedRole === 'survivor' ? player.healthCoins : player.bountiesEarned;
      if (currency < powerupDef.cost) {
        ws.send(JSON.stringify({ type: 'ERROR', message: `Not enough coins! Requires ${powerupDef.cost}.` }));
        return;
      }

      if (player.assignedRole === 'survivor') {
        player.healthCoins -= powerupDef.cost;
      } else {
        player.bountiesEarned -= powerupDef.cost;
      }

      player.powerups.push(powerupDef.id);

      sendToPlayer(room, player.id, {
        type: 'POWERUP_BOUGHT',
        powerupId: powerupDef.id,
        powerups: player.powerups,
        healthCoins: player.healthCoins,
        bountiesEarned: player.bountiesEarned
      });
      broadcastRoomState(room);
      break;
    }

    case 'ACTIVATE_POWERUP': {
      const room = getRoom(ws);
      if (!room || (room.state !== 'THE_HUNT' && room.state !== 'EXTRACTION')) return;

      const player = room.players.get(playerId);
      if (!player) return;

      const slotIdx = player.powerups.indexOf(msg.powerupId);
      if (slotIdx === -1) return;

      const powerupId = player.powerups.splice(slotIdx, 1)[0];
      const def = POWERUP_CATALOG[powerupId];
      const now = Date.now();
      const expiresAt = now + def.durationSeconds * 1000;

      if (powerupId === 'CLOAK' || powerupId === 'CLOAK_PLUS') {
        player.activeEffects.cloakUntil = expiresAt;
      } else if (powerupId === 'ANTI_CLOAK') {
        player.activeEffects.antiCloakUntil = expiresAt;
      } else if (powerupId === 'RADAR_EXTEND' || powerupId === 'RADAR_EXTEND_PLUS') {
        player.activeEffects.radarExtendUntil = expiresAt;
      } else if (powerupId === 'FRESH_MEAT') {
        player.activeEffects.freshMeatUntil = expiresAt;
      }

      broadcastToRoom(room, {
        type: 'POWERUP_ACTIVATED',
        playerId: player.id,
        playerName: player.name,
        role: player.assignedRole,
        powerupId,
        powerupName: def.name,
        durationSeconds: def.durationSeconds
      });
      broadcastTacticalRadar(room);
      break;
    }

    case 'SEND_CHAT': {
      const room = getRoom(ws);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player) return;

      const chatMsg = {
        id: msg.id || ('msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)),
        senderId: player.id,
        senderName: player.name,
        role: player.assignedRole,
        text: msg.text || '',
        photoUrl: msg.photoUrl || null,
        timestamp: Date.now()
      };

      room.chatHistory.push(chatMsg);
      if (room.chatHistory.length > 50) room.chatHistory.shift();

      broadcastToRoom(room, {
        type: 'CHAT_MESSAGE',
        message: chatMsg
      });
      break;
    }

    case 'END_GAME_EARLY': {
      const room = getRoom(ws);
      if (room && room.hostId === playerId) {
        endGame(room, 'HOST_ENDED');
      }
      break;
    }
  }
}

function getRoom(ws) {
  const client = clients.get(ws);
  if (!client?.roomId) return null;
  return rooms.get(client.roomId) || null;
}

function createInitialPlayer(id, name, arena) {
  return {
    id,
    name,
    tagCode: 'tag_' + Math.random().toString(36).substring(2, 8).toUpperCase(),
    assignedRole: 'survivor', // default until game start
    volunteerZombie: false,
    healthCoins: 100, // Starting health coins
    powerups: [], // Max 2 slots
    activeEffects: {
      cloakUntil: 0,
      antiCloakUntil: 0,
      radarExtendUntil: 0,
      freshMeatUntil: 0
    },
    isInfectious: false,
    infectiousUntil: 0,
    nextInfectAvailableAt: 0,
    isTagged: false,
    taggedAt: null,
    taggedBy: null,
    deathType: null, // 'TAGGED' | 'EXHAUSTION'
    escaped: false,
    escapedAt: null,
    bountiesEarned: 0,
    assistsCount: 0,
    tagsCount: 0,
    lat: arena.lat,
    lng: arena.lng,
    outOfBounds: false,
    outOfBoundsRemaining: null,
    outOfBoundsSince: null,
    distFromCenter: 0,
    currentZoneId: null,
    connected: true,
    lastSeen: Date.now(),
    path: []
  };
}

function assignInitialZombies(room) {
  const playerList = Array.from(room.players.values()).filter((p) => !p.isBot);
  const targetZombies = Math.max(1, parseInt(room.config.startingZombiesCount, 10) || 1);
  const N = playerList.length;
  // Ensure at least 1 survivor if more than 1 human player
  const actualZombies = N > 1 ? Math.min(targetZombies, N - 1) : 1;

  // Cryptographically fair Fisher-Yates shuffle
  for (let i = playerList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playerList[i], playerList[j]] = [playerList[j], playerList[i]];
  }

  // Exactly `actualZombies` become Zombies, the remaining become Survivors
  playerList.forEach((p, idx) => {
    if (idx < actualZombies) {
      p.assignedRole = 'zombie';
      p.volunteerZombie = true;
      p.rolePreference = 'zombie';
      p.isTagged = true;
      p.deathType = null;
      p.taggedBy = 'Patient Zero';
    } else {
      p.assignedRole = 'survivor';
      p.volunteerZombie = false;
      p.rolePreference = 'survivor';
      p.isTagged = false;
      p.escaped = false;
    }
  });
}

function startHeadStartPhase(room) {
  if (!room.config.headStart || room.config.headStart <= 0) {
    startTheHuntPhase(room);
    return;
  }
  room.state = 'HEAD_START';
  room.phaseStartTime = Date.now();
  room.timeRemaining = room.config.headStart;

  broadcastToRoom(room, {
    type: 'PHASE_CHANGED',
    state: room.state,
    startTime: room.phaseStartTime,
    duration: room.config.headStart,
    timeRemaining: room.timeRemaining,
    config: room.config,
    players: serializePlayers(room)
  });

  if (room.timer) clearInterval(room.timer);

  room.timer = setInterval(() => {
    room.timeRemaining--;

    if (room.timeRemaining <= 0) {
      startTheHuntPhase(room);
    } else {
      broadcastToRoom(room, {
        type: 'CLOCK_TICK',
        state: room.state,
        timeRemaining: room.timeRemaining
      });
    }
  }, 1000);
}

function startTheHuntPhase(room) {
  room.state = 'THE_HUNT';
  room.phaseStartTime = Date.now();
  room.timeRemaining = room.config.roundLength;

  broadcastToRoom(room, {
    type: 'PHASE_CHANGED',
    state: room.state,
    startTime: room.phaseStartTime,
    duration: room.config.roundLength,
    timeRemaining: room.timeRemaining,
    config: room.config,
    players: serializePlayers(room)
  });

  if (room.timer) clearInterval(room.timer);

  room.timer = setInterval(() => {
    gameTick(room);
  }, 1000);
}

function startExtractionPhase(room) {
  room.state = 'EXTRACTION';

  // Activate extraction zone(s)
  room.config.zones.forEach((z) => {
    if (z.type === 'EXTRACTION_ZONE') z.active = true;
  });

  broadcastToRoom(room, {
    type: 'EXTRACTION_PHASE_STARTED',
    state: room.state,
    timeRemaining: room.timeRemaining,
    zones: room.config.zones
  });
}

function processPlayerBoundaryCheck(room, player, isNowOOB, now = Date.now()) {
  const wasOOB = Boolean(player.outOfBounds);
  player.outOfBounds = isNowOOB;

  if (isNowOOB) {
    if (!player.outOfBoundsSince) {
      player.outOfBoundsSince = now;
      player.outOfBoundsRemaining = 60;

      // Broadcast breach alert to Tactical Chatbox
      const breachChatMsg = {
        id: 'sys_' + now + '_' + Math.random().toString(36).substring(2, 6),
        senderId: 'SYSTEM',
        senderName: '⚠️ PERIMETER BREACH',
        role: 'system',
        text: `🚨 BREACH WARNING: ${player.name} moved outside the arena zone! 60s elimination countdown initiated!`,
        photoUrl: null,
        timestamp: now
      };
      room.chatHistory.push(breachChatMsg);
      if (room.chatHistory.length > 50) room.chatHistory.shift();
      broadcastToRoom(room, { type: 'CHAT_MESSAGE', message: breachChatMsg });
    } else {
      const elapsed = Math.floor((now - player.outOfBoundsSince) / 1000);
      player.outOfBoundsRemaining = Math.max(0, 60 - elapsed);
    }
  } else {
    if (wasOOB && player.outOfBoundsSince) {
      // Broadcast safe return to Tactical Chatbox
      const returnChatMsg = {
        id: 'sys_' + now + '_' + Math.random().toString(36).substring(2, 6),
        senderId: 'SYSTEM',
        senderName: '✅ SAFE ZONE',
        role: 'system',
        text: `✅ SAFE: ${player.name} returned safely inside the arena perimeter. Countdown canceled.`,
        photoUrl: null,
        timestamp: now
      };
      room.chatHistory.push(returnChatMsg);
      if (room.chatHistory.length > 50) room.chatHistory.shift();
      broadcastToRoom(room, { type: 'CHAT_MESSAGE', message: returnChatMsg });
    }
    player.outOfBoundsSince = null;
    player.outOfBoundsRemaining = null;
  }
}

function gameTick(room) {
  room.timeRemaining--;
  const now = Date.now();

  // Phase transition to Extraction during final 20%
  const extractionThreshold = Math.floor(room.config.roundLength * 0.2);
  if (room.state === 'THE_HUNT' && room.timeRemaining <= extractionThreshold) {
    startExtractionPhase(room);
  }

  // Time up check
  if (room.timeRemaining <= 0) {
    endGame(room, 'TIME_UP');
    return;
  }

  // 0. Update bots positions inside arena
  for (const p of room.players.values()) {
    if (p.isBot && !p.isTagged && !p.escaped) {
      const angle = (now / 6000) + (p.id.charCodeAt(p.id.length - 1) || 0);
      const step = 0.00004; // ~4 meters
      p.lat += Math.cos(angle) * step;
      p.lng += Math.sin(angle) * step;
      p.heading = Math.round(((angle * 180 / Math.PI) + 360) % 360);
      p.distFromCenter = Math.round(haversineDistance(p.lat, p.lng, room.config.arena.lat, room.config.arena.lng));
      p.outOfBounds = p.distFromCenter > room.config.arena.radius;
    }
  }

  // 0.5 Process 60-Second Perimeter Boundary Integrity
  for (const p of room.players.values()) {
    if (p.escaped) continue;
    if (p.lat !== null && p.lng !== null && room.config?.arena) {
      const dist = haversineDistance(p.lat, p.lng, room.config.arena.lat, room.config.arena.lng);
      p.distFromCenter = Math.round(dist);
      const isOOB = dist > room.config.arena.radius;
      processPlayerBoundaryCheck(room, p, isOOB, now);
      if (p.outOfBounds && p.outOfBoundsRemaining <= 0 && !p.isTagged && p.assignedRole === 'survivor') {
        executeInfection(room, null, p, 'OUT_OF_BOUNDS_60S');
      }
    }
  }

  // 1. Process 5-Meter / 10-Second Chase Proximity Infection Engine
  // A Zombie can ONLY infect a Survivor (a Zombie CANNOT infect another Zombie)
  for (const survivor of room.players.values()) {
    if (survivor.assignedRole !== 'survivor' || survivor.isTagged || survivor.escaped) continue;
    if (!Number.isFinite(survivor.lat) || !Number.isFinite(survivor.lng)) continue;

    // Check Cloak immunity
    const isCloaked = survivor.activeEffects.cloakUntil > now;
    if (isCloaked) {
      if (survivor.chaseProgress) survivor.chaseProgress = { seconds: 0, zombieId: null };
      continue;
    }

    // Check if inside Extraction Zone during EXTRACTION phase
    if (room.state === 'EXTRACTION') {
      const activeExtractionZone = room.config.zones.find((z) => z.type === 'EXTRACTION_ZONE' && z.active);
      if (activeExtractionZone) {
        const dist = haversineDistance(survivor.lat, survivor.lng, activeExtractionZone.lat, activeExtractionZone.lng);
        if (dist <= activeExtractionZone.radius) {
          survivor.escaped = true;
          survivor.escapedAt = now;
          broadcastToRoom(room, {
            type: 'SURVIVOR_ESCAPED',
            survivorId: survivor.id,
            survivorName: survivor.name
          });
          checkEndConditions(room);
          continue;
        }
      }
    }

    // Find nearest chasing Zombie within 5 meters
    let nearestZombie = null;
    let minDistance = Infinity;

    for (const zombie of room.players.values()) {
      if (zombie.assignedRole !== 'zombie') continue; // Zombie cannot infect zombie!
      if (!Number.isFinite(zombie.lat) || !Number.isFinite(zombie.lng)) continue;

      const d = haversineDistance(zombie.lat, zombie.lng, survivor.lat, survivor.lng);
      if (d <= 5.0 && d < minDistance) {
        minDistance = d;
        nearestZombie = zombie;
      }
    }

    if (!survivor.chaseProgress) {
      survivor.chaseProgress = { seconds: 0, zombieId: null };
    }

    if (nearestZombie) {
      // Zombie is within 5 meters!
      if (survivor.chaseProgress.zombieId === nearestZombie.id) {
        survivor.chaseProgress.seconds += 1;
      } else {
        survivor.chaseProgress.zombieId = nearestZombie.id;
        survivor.chaseProgress.seconds = 1;
      }

      const secondsRemaining = Math.max(0, 10 - survivor.chaseProgress.seconds);

      broadcastToRoom(room, {
        type: 'CHASE_WARNING',
        survivorId: survivor.id,
        survivorName: survivor.name,
        zombieId: nearestZombie.id,
        zombieName: nearestZombie.name,
        distance: Math.round(minDistance * 10) / 10,
        secondsRemaining,
        chaseDuration: survivor.chaseProgress.seconds
      });

      if (survivor.chaseProgress.seconds >= 10) {
        // 10 continuous seconds under 5 meters: INFECTED!
        executeInfection(room, nearestZombie, survivor, '5M_CHASE_10S', Math.round(minDistance));
        survivor.chaseProgress = { seconds: 0, zombieId: null };
      }
    } else {
      // Survivor broke out of 5-meter radius!
      if (survivor.chaseProgress.seconds > 0) {
        survivor.chaseProgress.seconds = Math.max(0, survivor.chaseProgress.seconds - 2);
        if (survivor.chaseProgress.seconds === 0) {
          const prevZombieId = survivor.chaseProgress.zombieId;
          survivor.chaseProgress.zombieId = null;
          broadcastToRoom(room, {
            type: 'CHASE_ESCAPED',
            survivorId: survivor.id,
            survivorName: survivor.name,
            zombieId: prevZombieId
          });
        }
      }
    }
  }

  // 2. Periodic Broadcasts
  broadcastToRoom(room, {
    type: 'CLOCK_TICK',
    state: room.state,
    timeRemaining: room.timeRemaining,
    players: serializePlayers(room)
  });

  broadcastTacticalRadar(room);
}

function checkProximityInfectionsForZombie(room, zombie) {
  // Bluetooth proximity infection has been replaced with the GPS 5m/10s chase rule
}

function executeInfection(room, killerZombie, victim, method, distance = 0) {
  if (victim.isTagged || victim.assignedRole !== 'survivor') return; // Zombie cannot infect zombie!

  victim.isTagged = true;
  victim.taggedAt = Date.now();
  victim.assignedRole = 'zombie'; // Role switches to Zombie!
  victim.deathType = method;
  victim.taggedBy = killerZombie ? killerZombie.name : (method === 'OUT_OF_BOUNDS_60S' ? 'Toxic Wasteland (Out of Bounds)' : 'Chase Proximity');
  victim.outOfBoundsRemaining = null;
  victim.outOfBoundsSince = null;

  if (killerZombie) {
    killerZombie.tagsCount = (killerZombie.tagsCount || 0) + 1;
  }

  // 1. Log infection event for post-game recap
  const eventRecord = {
    victimId: victim.id,
    victimName: victim.name,
    killerId: killerZombie?.id || null,
    killerName: victim.taggedBy,
    method,
    distance,
    time: Date.now()
  };
  room.eventsLog.push(eventRecord);

  // 2. Broadcast infection event
  broadcastToRoom(room, {
    type: 'PLAYER_INFECTED',
    victimId: victim.id,
    victimName: victim.name,
    killerId: killerZombie?.id || null,
    killerName: victim.taggedBy,
    method,
    distance,
    players: serializePlayers(room)
  });

  // 3. Post live infection alert into the Tactical Chatbox
  const methodLabel = method === 'OUT_OF_BOUNDS_60S'
    ? '60s Boundary Breach'
    : (method === '5M_CHASE_10S' ? '5m Chase Proximity' : 'Physical QR Tag');
  const chatAlertText = method === 'OUT_OF_BOUNDS_60S'
    ? `☠️ ELIMINATED: ${victim.name} failed to return within 60s and was infected by the toxic wasteland! ${victim.name} is now a ZOMBIE!`
    : `☣️ INFECTION: ${victim.name} was infected by ${victim.taggedBy} via ${methodLabel}! ${victim.name} is now a ZOMBIE!`;

  const infectionChatMsg = {
    id: 'sys_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    senderId: 'SYSTEM',
    senderName: '☣️ TACTICAL ALERT',
    role: 'system',
    text: chatAlertText,
    photoUrl: null,
    timestamp: Date.now()
  };
  room.chatHistory.push(infectionChatMsg);
  if (room.chatHistory.length > 50) room.chatHistory.shift();

  broadcastToRoom(room, {
    type: 'CHAT_MESSAGE',
    message: infectionChatMsg
  });

  checkEndConditions(room);
  broadcastTacticalRadar(room);
}

function checkEndConditions(room) {
  const survivors = Array.from(room.players.values()).filter((p) => p.assignedRole === 'survivor' && !p.isTagged);
  const activeSurvivors = survivors.filter((p) => !p.escaped);

  // If no more survivors alive
  if (activeSurvivors.length === 0) {
    const escapedCount = Array.from(room.players.values()).filter((p) => p.escaped).length;
    if (escapedCount > 0) {
      endGame(room, 'SURVIVORS_ESCAPED');
    } else {
      endGame(room, 'ZOMBIES_INFECTED_ALL');
    }
  }
}

function endGame(room, reason) {
  room.state = 'ENDED';
  if (room.timer) clearInterval(room.timer);

  const players = Array.from(room.players.values());
  const survivorsEscaped = players.filter((p) => p.escaped);
  const isZombiesWin = survivorsEscaped.length === 0;

  room.winner = isZombiesWin ? 'ZOMBIES' : 'SURVIVORS';

  broadcastToRoom(room, {
    type: 'GAME_OVER',
    winner: room.winner,
    reason,
    stats: {
      durationSeconds: Math.floor((Date.now() - (room.phaseStartTime || Date.now())) / 1000),
      escapedSurvivors: survivorsEscaped.map((p) => p.name),
      firstInfected: players.filter((p) => p.taggedAt).sort((a, b) => a.taggedAt - b.taggedAt)[0]?.name || null,
      topZombie: players.slice().sort((a, b) => (b.tagsCount || 0) - (a.tagsCount || 0))[0]?.name || null,
      topAssister: players.slice().sort((a, b) => (b.assistsCount || 0) - (a.assistsCount || 0))[0]?.name || null,
      infectionLog: room.eventsLog,
      players: serializePlayers(room)
    }
  });
}

function broadcastTacticalRadar(room) {
  const now = Date.now();
  const playerList = Array.from(room.players.values());
  const playersCount = playerList.length;
  const survivorsCount = playerList.filter((p) => p.assignedRole === 'survivor' && !p.isTagged && !p.escaped).length;
  const zombiesCount = playerList.filter((p) => p.assignedRole === 'zombie' || p.isTagged).length;
  const escapedCount = playerList.filter((p) => p.escaped).length;

  for (const [pId, socket] of room.sockets.entries()) {
    const me = room.players.get(pId);
    if (!me || socket.readyState !== WebSocket.OPEN) continue;

    const myRadarRange = me.activeEffects.radarExtendUntil > now ? 450 : 250;
    const hasAntiCloak = me.activeEffects.antiCloakUntil > now;

    // Detectable blips with live GPS coordinates
    const blips = [];
    const myLat = Number.isFinite(me.lat) ? me.lat : room.config.arena.lat;
    const myLng = Number.isFinite(me.lng) ? me.lng : room.config.arena.lng;

    for (const other of playerList) {
      if (other.id === me.id) continue;
      if (!Number.isFinite(other.lat) || !Number.isFinite(other.lng)) continue;

      const isTeammate = me.assignedRole === other.assignedRole;
      const isOtherCloaked = other.activeEffects.cloakUntil > now;
      if (isOtherCloaked && !hasAntiCloak && !isTeammate) continue; // Cloaked player invisible to enemies

      const dist = haversineDistance(myLat, myLng, other.lat, other.lng);
      const bearing = calculateBearing(myLat, myLng, other.lat, other.lng);
      blips.push({
        id: other.id,
        name: other.name,
        role: other.assignedRole,
        lat: other.lat,
        lng: other.lng,
        heading: typeof other.heading === 'number' && Number.isFinite(other.heading) ? other.heading : 0,
        dist: Math.round(dist),
        bearing: Math.round(bearing),
        isInfectious: Boolean(other.isInfectious),
        isTeammate,
        isCloaked: Boolean(isOtherCloaked),
        isTagged: Boolean(other.isTagged),
        escaped: Boolean(other.escaped)
      });
    }

    // Include Fresh Meat scent if zombie active
    let freshMeatTarget = null;
    if (me.assignedRole === 'zombie' && me.activeEffects.freshMeatUntil > now) {
      let closestDist = Infinity;
      for (const survivor of playerList) {
        if (survivor.assignedRole === 'survivor' && !survivor.isTagged && !survivor.escaped) {
          if (!Number.isFinite(survivor.lat) || !Number.isFinite(survivor.lng)) continue;
          const d = haversineDistance(myLat, myLng, survivor.lat, survivor.lng);
          if (d < closestDist) {
            closestDist = d;
            freshMeatTarget = {
              id: survivor.id,
              name: survivor.name,
              lat: survivor.lat,
              lng: survivor.lng,
              dist: Math.round(d),
              bearing: Math.round(calculateBearing(myLat, myLng, survivor.lat, survivor.lng))
            };
          }
        }
      }

      if (freshMeatTarget && !blips.some((b) => b.id === freshMeatTarget.id)) {
        blips.push({
          id: freshMeatTarget.id,
          name: freshMeatTarget.name,
          role: 'survivor',
          lat: freshMeatTarget.lat,
          lng: freshMeatTarget.lng,
          heading: 0,
          dist: freshMeatTarget.dist,
          bearing: freshMeatTarget.bearing,
          isInfectious: false,
          isTeammate: false,
          isCloaked: false,
          isTagged: false,
          escaped: false,
          isFreshMeat: true
        });
      }
    }

    // Relative bearings to Zones
    const relativeZones = room.config.zones.map((zone) => {
      const dist = haversineDistance(myLat, myLng, zone.lat, zone.lng);
      const bearing = calculateBearing(myLat, myLng, zone.lat, zone.lng);
      return {
        id: zone.id,
        name: zone.name,
        type: zone.type,
        lat: zone.lat,
        lng: zone.lng,
        radius: zone.radius,
        powerupShop: zone.powerupShop,
        active: zone.active,
        dist: Math.round(dist),
        bearing: Math.round(bearing)
      };
    });

    socket.send(
      JSON.stringify({
        type: 'RADAR_UPDATE',
        outOfBounds: Boolean(me.outOfBounds),
        outOfBoundsRemaining: typeof me.outOfBoundsRemaining === 'number' ? me.outOfBoundsRemaining : null,
        playersCount,
        survivorsCount,
        zombiesCount,
        escapedCount,
        myBounties: me.bountiesEarned,
        myPowerups: me.powerups,
        myActiveEffects: {
          cloaked: me.activeEffects.cloakUntil > now,
          antiCloak: me.activeEffects.antiCloakUntil > now,
          radarExtended: me.activeEffects.radarExtendUntil > now,
          freshMeat: me.activeEffects.freshMeatUntil > now
        },
        isInfectious: me.isInfectious,
        infectCooldownRemaining: Math.max(0, Math.ceil((me.nextInfectAvailableAt - now) / 1000)),
        blips,
        freshMeatTarget,
        zones: relativeZones
      })
    );
  }
}

function serializePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    tagCode: p.tagCode,
    assignedRole: p.assignedRole,
    volunteerZombie: p.volunteerZombie,
    healthCoins: p.healthCoins,
    powerups: p.powerups,
    isTagged: p.isTagged,
    taggedBy: p.taggedBy,
    deathType: p.deathType,
    escaped: p.escaped,
    tagsCount: p.tagsCount,
    assistsCount: p.assistsCount,
    bountiesEarned: p.bountiesEarned,
    outOfBounds: p.outOfBounds,
    outOfBoundsRemaining: p.outOfBoundsRemaining,
    distFromCenter: p.distFromCenter,
    taggedAt: p.taggedAt,
    currentZoneId: p.currentZoneId,
    connected: p.connected
  };
}

function serializePlayers(room) {
  return Array.from(room.players.values()).map(serializePlayer);
}

function broadcastRoomState(room) {
  broadcastToRoom(room, {
    type: 'ROOM_STATE',
    roomCode: room.code,
    hostId: room.hostId,
    state: room.state,
    config: room.config,
    players: serializePlayers(room),
    timeRemaining: room.timeRemaining
  });
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  console.log(`\n======================================================`);
  console.log(`  🧟 RUN FOR YOUR LIFE - REAL-LIFE SURVIVAL SERVER`);
  console.log(`======================================================`);
  console.log(`  Local URL:      http://localhost:${PORT}`);
  console.log(`  Samsung Phone:  http://${ip}:${PORT}`);
  console.log(`  (Open this on your Samsung Phone in Chrome/Samsung Browser)`);
  console.log(`======================================================\n`);
});
