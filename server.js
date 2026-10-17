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
  '.woff2': 'font/woff2'
};

// Rooms state
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
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous chars 0/O, 1/I
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
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
      console.error('Error handling message:', e);
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client && client.roomId) {
      const room = rooms.get(client.roomId);
      if (room) {
        room.sockets.delete(playerId);
        const player = room.players.get(playerId);
        if (player) {
          player.connected = false;
        }

        // If host disconnected, assign new host or clean up
        if (room.hostId === playerId) {
          const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
          if (connectedPlayers.length > 0) {
            room.hostId = connectedPlayers[0].id;
          }
        }

        const remainingCount = Array.from(room.players.values()).filter((p) => p.connected).length;
        if (remainingCount === 0) {
          clearInterval(room.timer);
          rooms.delete(client.roomId);
        } else {
          broadcastRoomState(room);
        }
      }
    }
    clients.delete(ws);
  });
});

function handleMessage(ws, playerId, msg) {
  switch (msg.type) {
    case 'CREATE_ROOM': {
      const code = generateRoomCode();
      const room = {
        code,
        hostId: playerId,
        state: 'LOBBY', // LOBBY, HEAD_START, HUNT, ENDED
        config: {
          arena: msg.arena || { lat: 37.7749, lng: -122.4194, radius: 300 }, // Default 300m
          roundLength: msg.roundLength || 45 * 60, // 45 minutes
          headStart: msg.headStart || 3 * 60, // 3 minutes
          pingInterval: msg.pingInterval || 5 * 60 // 5 minutes
        },
        players: new Map(),
        sockets: new Map(),
        phaseStartTime: null,
        timeRemaining: 0,
        nextPingIn: 0,
        lastPing: null,
        pingsHistory: [],
        winner: null,
        timer: null
      };

      const hostPlayer = {
        id: playerId,
        name: msg.name || 'Host',
        rolePreference: 'random',
        assignedRole: null, // 'hunter' | 'runner'
        connected: true,
        isTagged: false,
        lat: room.config.arena.lat,
        lng: room.config.arena.lng,
        lastSeen: Date.now(),
        path: []
      };

      room.players.set(playerId, hostPlayer);
      room.sockets.set(playerId, ws);
      rooms.set(code, room);

      const client = clients.get(ws);
      if (client) client.roomId = code;

      ws.send(JSON.stringify({ type: 'ROOM_CREATED', roomCode: code, playerId }));
      broadcastRoomState(room);
      break;
    }

    case 'JOIN_ROOM': {
      const room = rooms.get(msg.roomCode?.toUpperCase());
      if (!room) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found. Check the 6-letter code!' }));
        return;
      }
      if (room.state !== 'LOBBY') {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Game has already started!' }));
        return;
      }

      const player = {
        id: playerId,
        name: msg.name || 'Agent ' + (room.players.size + 1),
        rolePreference: msg.rolePreference || 'random',
        assignedRole: null,
        connected: true,
        isTagged: false,
        lat: room.config.arena.lat,
        lng: room.config.arena.lng,
        lastSeen: Date.now(),
        path: []
      };

      room.players.set(playerId, player);
      room.sockets.set(playerId, ws);

      const client = clients.get(ws);
      if (client) client.roomId = room.code;

      ws.send(JSON.stringify({ type: 'ROOM_JOINED', roomCode: room.code, playerId }));
      broadcastRoomState(room);
      break;
    }

    case 'UPDATE_CONFIG': {
      const client = clients.get(ws);
      if (!client?.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room || room.hostId !== playerId || room.state !== 'LOBBY') return;

      if (msg.arena) room.config.arena = msg.arena;
      if (msg.roundLength) room.config.roundLength = msg.roundLength;
      if (msg.headStart) room.config.headStart = msg.headStart;
      if (msg.pingInterval) room.config.pingInterval = msg.pingInterval;

      broadcastRoomState(room);
      break;
    }

    case 'SELECT_ROLE': {
      const client = clients.get(ws);
      if (!client?.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room || room.state !== 'LOBBY') return;

      const player = room.players.get(playerId);
      if (player && ['hunter', 'runner', 'random'].includes(msg.role)) {
        player.rolePreference = msg.role;
        broadcastRoomState(room);
      }
      break;
    }

    case 'START_GAME': {
      const client = clients.get(ws);
      if (!client?.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room || room.hostId !== playerId || room.state !== 'LOBBY') return;

      if (room.players.size < 2) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Need at least 2 players to start!' }));
        return;
      }

      assignRolesFairly(room);
      startHeadStartPhase(room);
      break;
    }

    case 'UPDATE_LOCATION': {
      const client = clients.get(ws);
      if (!client?.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room || (room.state !== 'HEAD_START' && room.state !== 'HUNT')) return;

      const player = room.players.get(playerId);
      if (player && typeof msg.lat === 'number' && typeof msg.lng === 'number') {
        player.lat = msg.lat;
        player.lng = msg.lng;
        player.lastSeen = Date.now();
        player.path.push({ lat: msg.lat, lng: msg.lng, time: Date.now() });

        // Check if runner is out of bounds
        const distFromCenter = haversineDistance(
          player.lat,
          player.lng,
          room.config.arena.lat,
          room.config.arena.lng
        );
        player.outOfBounds = distFromCenter > room.config.arena.radius;

        // Broadcast tactical updates:
        // - Hunters see live updates of fellow hunters
        // - Runners see their own updates
        broadcastTacticalLocations(room);
      }
      break;
    }

    case 'TAG_CLAIM': {
      const client = clients.get(ws);
      if (!client?.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room || room.state !== 'HUNT') return;

      const hunter = room.players.get(playerId);
      const targetRunner = room.players.get(msg.targetRunnerId);

      if (hunter?.assignedRole === 'hunter' && targetRunner?.assignedRole === 'runner' && !targetRunner.isTagged) {
        // Tag confirmation: either instantaneous if close (< 30m) or tagged directly
        const dist = haversineDistance(hunter.lat, hunter.lng, targetRunner.lat, targetRunner.lng);
        targetRunner.isTagged = true;
        targetRunner.taggedAt = Date.now();
        targetRunner.taggedBy = hunter.name;

        broadcastToRoom(room, {
          type: 'PLAYER_TAGGED',
          runnerId: targetRunner.id,
          runnerName: targetRunner.name,
          hunterName: hunter.name,
          distance: Math.round(dist)
        });

        checkEndConditions(room);
      }
      break;
    }

    case 'CONFIRM_TAGGED_SELF': {
      const client = clients.get(ws);
      if (!client?.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room || room.state !== 'HUNT') return;

      const runner = room.players.get(playerId);
      if (runner?.assignedRole === 'runner' && !runner.isTagged) {
        runner.isTagged = true;
        runner.taggedAt = Date.now();

        broadcastToRoom(room, {
          type: 'PLAYER_TAGGED',
          runnerId: runner.id,
          runnerName: runner.name,
          hunterName: 'Hunters'
        });

        checkEndConditions(room);
      }
      break;
    }

    case 'FORCE_PING': {
      // Allows host or testing to force a ping immediately
      const client = clients.get(ws);
      if (!client?.roomId) return;
      const room = rooms.get(client.roomId);
      if (room && room.state === 'HUNT') {
        triggerPing(room);
      }
      break;
    }
  }
}

function assignRolesFairly(room) {
  const playerList = Array.from(room.players.values());
  const total = playerList.length;

  // SCRAM rule of thumb: ~1 hunter per 2-4 runners
  // 2 players: 1 hunter, 1 runner
  // 3 players: 1 hunter, 2 runners
  // 4-5 players: 1 or 2 hunters
  // 6+ players: 2 or 3 hunters
  let targetHunters = 1;
  if (total >= 4 && total <= 5) targetHunters = Math.random() < 0.5 ? 1 : 2;
  else if (total >= 6 && total <= 8) targetHunters = 2;
  else if (total > 8) targetHunters = Math.max(2, Math.floor(total / 3));

  const explicitHunters = playerList.filter((p) => p.rolePreference === 'hunter');
  const explicitRunners = playerList.filter((p) => p.rolePreference === 'runner');
  const randoms = playerList.filter((p) => p.rolePreference === 'random');

  // Shuffle arrays
  const shuffle = (a) => a.sort(() => Math.random() - 0.5);
  shuffle(explicitHunters);
  shuffle(explicitRunners);
  shuffle(randoms);

  const assignedHunters = [];
  const assignedRunners = [];

  // Add explicit hunters up to target
  while (explicitHunters.length > 0 && assignedHunters.length < targetHunters) {
    assignedHunters.push(explicitHunters.pop());
  }

  // Any leftover explicit hunters become runners if hunter slots full
  while (explicitHunters.length > 0) {
    assignedRunners.push(explicitHunters.pop());
  }

  // Add explicit runners
  while (explicitRunners.length > 0) {
    assignedRunners.push(explicitRunners.pop());
  }

  // Fill remaining hunter slots from random pool
  while (randoms.length > 0 && assignedHunters.length < targetHunters) {
    assignedHunters.push(randoms.pop());
  }

  // Rest of randoms become runners
  while (randoms.length > 0) {
    assignedRunners.push(randoms.pop());
  }

  // Ensure at least 1 hunter and 1 runner
  if (assignedHunters.length === 0 && assignedRunners.length > 0) {
    assignedHunters.push(assignedRunners.pop());
  } else if (assignedRunners.length === 0 && assignedHunters.length > 1) {
    assignedRunners.push(assignedHunters.pop());
  }

  assignedHunters.forEach((p) => (p.assignedRole = 'hunter'));
  assignedRunners.forEach((p) => (p.assignedRole = 'runner'));
}

function startHeadStartPhase(room) {
  room.state = 'HEAD_START';
  room.phaseStartTime = Date.now();
  room.timeRemaining = room.config.headStart;

  broadcastToRoom(room, {
    type: 'PHASE_CHANGED',
    state: room.state,
    timeRemaining: room.timeRemaining,
    players: serializePlayers(room)
  });

  if (room.timer) clearInterval(room.timer);

  room.timer = setInterval(() => {
    room.timeRemaining--;

    if (room.timeRemaining <= 0) {
      startHuntPhase(room);
    } else {
      broadcastToRoom(room, {
        type: 'CLOCK_TICK',
        state: room.state,
        timeRemaining: room.timeRemaining
      });
    }
  }, 1000);
}

function startHuntPhase(room) {
  room.state = 'HUNT';
  room.phaseStartTime = Date.now();
  room.timeRemaining = room.config.roundLength;
  room.nextPingIn = room.config.pingInterval;

  // Immediate initial ping so hunters get an initial clue where runners scattered to!
  triggerPing(room);

  broadcastToRoom(room, {
    type: 'PHASE_CHANGED',
    state: room.state,
    timeRemaining: room.timeRemaining,
    nextPingIn: room.nextPingIn,
    players: serializePlayers(room)
  });

  if (room.timer) clearInterval(room.timer);

  room.timer = setInterval(() => {
    room.timeRemaining--;
    room.nextPingIn--;

    if (room.nextPingIn <= 0) {
      triggerPing(room);
      room.nextPingIn = room.config.pingInterval;
    }

    if (room.timeRemaining <= 0) {
      endGame(room, 'RUNNERS_SURVIVED');
    } else {
      broadcastToRoom(room, {
        type: 'CLOCK_TICK',
        state: room.state,
        timeRemaining: room.timeRemaining,
        nextPingIn: room.nextPingIn
      });
    }
  }, 1000);
}

function triggerPing(room) {
  const runnerPings = [];
  for (const p of room.players.values()) {
    if (p.assignedRole === 'runner' && !p.isTagged) {
      runnerPings.push({
        id: p.id,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        outOfBounds: p.outOfBounds
      });
    }
  }

  const pingEvent = {
    timestamp: Date.now(),
    runnerPings
  };

  room.lastPing = pingEvent;
  room.pingsHistory.push(pingEvent);

  broadcastToRoom(room, {
    type: 'PING_FIRED',
    ping: pingEvent,
    totalPings: room.pingsHistory.length
  });
}

function checkEndConditions(room) {
  const runners = Array.from(room.players.values()).filter((p) => p.assignedRole === 'runner');
  const activeRunners = runners.filter((p) => !p.isTagged);

  if (activeRunners.length === 0) {
    endGame(room, 'HUNTERS_WON');
  } else {
    broadcastRoomState(room);
  }
}

function endGame(room, reason) {
  room.state = 'ENDED';
  room.winner = reason === 'HUNTERS_WON' ? 'HUNTERS' : 'RUNNERS';
  if (room.timer) clearInterval(room.timer);

  broadcastToRoom(room, {
    type: 'GAME_OVER',
    winner: room.winner,
    reason,
    stats: {
      durationSeconds: Math.floor((Date.now() - room.phaseStartTime) / 1000),
      totalPings: room.pingsHistory.length,
      players: serializePlayers(room)
    }
  });
}

function serializePlayers(room) {
  return Array.from(room.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    rolePreference: p.rolePreference,
    assignedRole: p.assignedRole,
    connected: p.connected,
    isTagged: p.isTagged,
    taggedBy: p.taggedBy,
    outOfBounds: p.outOfBounds,
    pathLength: p.path.length
  }));
}

function broadcastRoomState(room) {
  broadcastToRoom(room, {
    type: 'ROOM_STATE',
    roomCode: room.code,
    hostId: room.hostId,
    state: room.state,
    config: room.config,
    players: serializePlayers(room),
    timeRemaining: room.timeRemaining,
    nextPingIn: room.nextPingIn,
    lastPing: room.lastPing
  });
}

function broadcastTacticalLocations(room) {
  // Hunters receive live coordinates of other hunters
  const hunterPositions = [];
  for (const p of room.players.values()) {
    if (p.assignedRole === 'hunter') {
      hunterPositions.push({ id: p.id, name: p.name, lat: p.lat, lng: p.lng });
    }
  }

  for (const [pId, socket] of room.sockets.entries()) {
    const player = room.players.get(pId);
    if (!player || socket.readyState !== WebSocket.OPEN) continue;

    if (player.assignedRole === 'hunter') {
      socket.send(
        JSON.stringify({
          type: 'HUNTERS_LIVE_POSITIONS',
          hunters: hunterPositions.filter((h) => h.id !== pId)
        })
      );
    }
  }
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  console.log(`\n======================================================`);
  console.log(`  🎯 SCRAM: REAL-LIFE HIDE & SEEK WEB APP`);
  console.log(`======================================================`);
  console.log(`  Local URL:      http://localhost:${PORT}`);
  console.log(`  Mobile Network: http://${ip}:${PORT}`);
  console.log(`  Share this URL with friends on your Wi-Fi to play!`);
  console.log(`======================================================\n`);
});
