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
          player.disconnectedAt = Date.now();
          player.graceSeconds = 90;

          // Broadcast 90s reconnect buffer to all operatives
          broadcastToRoom(room, {
            type: 'PLAYER_DISCONNECTED_BUFFER',
            playerId: player.id,
            playerName: player.name,
            graceSeconds: 90
          });

          // 90 second grace timer before eliminating/removing disconnected operative
          if (player.graceTimeout) clearTimeout(player.graceTimeout);
          player.graceTimeout = setTimeout(() => {
            if (!player.connected) {
              console.log(`[DISCONNECT] 90s buffer expired for ${player.name} (${player.id}) in room ${room.code}`);
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

        // If host disconnected, assign new host if other connected players exist
        if (room.hostId === playerId) {
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

function handleMessage(ws, playerId, msg) {
  switch (msg.type) {
    case 'CREATE_ROOM': {
      const code = generateRoomCode();
      const hunterPingInterval = parseInt(msg.hunterPingInterval, 10) || 30; // 20-80s
      const runnerPingInterval = parseInt(msg.runnerPingInterval, 10) || 50; // 20-80s

      const room = {
        code,
        hostId: playerId,
        state: 'LOBBY', // LOBBY, HEAD_START, HUNT, ENDED
        config: {
          arena: msg.arena || { lat: 37.7749, lng: -122.4194, radius: 300 },
          roundLength: msg.roundLength || 45 * 60,
          headStart: msg.headStart || 3 * 60,
          hunterPingInterval, // Hunter location update frequency
          runnerPingInterval, // Runner location update frequency
          pingInterval: runnerPingInterval // fallback compatibility
        },
        players: new Map(),
        sockets: new Map(),
        phaseStartTime: null,
        timeRemaining: 0,
        nextHunterPingIn: hunterPingInterval,
        nextRunnerPingIn: runnerPingInterval,
        nextPingIn: runnerPingInterval,
        lastHunterPing: null,
        lastRunnerPing: null,
        pingsHistory: [],
        chatHistory: [],
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

      // Check if this is a player reconnecting within the 90s grace buffer with the same name
      let reconnectingPlayer = null;
      for (const p of room.players.values()) {
        if (!p.connected && (p.name.toLowerCase() === msg.name?.toLowerCase().trim() || p.id === msg.playerId)) {
          reconnectingPlayer = p;
          break;
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
        const client = clients.get(ws);
        if (client) {
          client.roomId = room.code;
          client.playerId = reconnectingPlayer.id;
        }

        ws.send(JSON.stringify({
          type: 'RECONNECT_SUCCESS',
          roomCode: room.code,
          playerId: reconnectingPlayer.id,
          assignedRole: reconnectingPlayer.assignedRole,
          state: room.state,
          arena: room.config.arena,
          config: room.config,
          timeRemaining: room.timeRemaining,
          nextHunterPingIn: room.nextHunterPingIn,
          nextRunnerPingIn: room.nextRunnerPingIn
        }));

        broadcastToRoom(room, {
          type: 'PLAYER_RECONNECTED',
          playerId: reconnectingPlayer.id,
          playerName: reconnectingPlayer.name
        });
        broadcastRoomState(room);
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

    case 'RECONNECT_ROOM': {
      const room = rooms.get(msg.roomCode?.toUpperCase());
      if (!room) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found or expired.' }));
        return;
      }

      let targetPlayer = null;
      for (const p of room.players.values()) {
        if (p.name.toLowerCase() === msg.name?.toLowerCase().trim() || p.id === msg.playerId) {
          targetPlayer = p;
          break;
        }
      }

      if (!targetPlayer) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'No registered operative found with this name.' }));
        return;
      }

      if (targetPlayer.graceTimeout) {
        clearTimeout(targetPlayer.graceTimeout);
        targetPlayer.graceTimeout = null;
      }
      targetPlayer.connected = true;
      targetPlayer.disconnectedAt = null;

      room.sockets.set(targetPlayer.id, ws);
      const client = clients.get(ws);
      if (client) {
        client.roomId = room.code;
        client.playerId = targetPlayer.id;
      }

      ws.send(JSON.stringify({
        type: 'RECONNECT_SUCCESS',
        roomCode: room.code,
        playerId: targetPlayer.id,
        assignedRole: targetPlayer.assignedRole,
        state: room.state,
        arena: room.config.arena,
        config: room.config,
        timeRemaining: room.timeRemaining,
        nextHunterPingIn: room.nextHunterPingIn,
        nextRunnerPingIn: room.nextRunnerPingIn,
        players: serializePlayers(room)
      }));

      broadcastToRoom(room, {
        type: 'PLAYER_RECONNECTED',
        playerId: targetPlayer.id,
        playerName: targetPlayer.name
      });
      broadcastRoomState(room);
      break;
    }

    case 'SEND_CHAT': {
      const client = clients.get(ws);
      if (!client?.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room) return;

      const player = room.players.get(playerId);
      if (!player) return;

      const chatMsg = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        senderId: player.id,
        senderName: player.name,
        role: player.assignedRole || player.rolePreference,
        text: msg.text || '',
        photoUrl: msg.photoUrl || null,
        targetChannel: msg.targetChannel || 'ALL',
        timestamp: Date.now()
      };

      if (!room.chatHistory) room.chatHistory = [];
      room.chatHistory.push(chatMsg);
      if (room.chatHistory.length > 100) room.chatHistory.shift();

      broadcastToRoom(room, {
        type: 'CHAT_MESSAGE',
        message: chatMsg
      });
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
      if (msg.hunterPingInterval) {
        room.config.hunterPingInterval = parseInt(msg.hunterPingInterval, 10);
        room.nextHunterPingIn = room.config.hunterPingInterval;
      }
      if (msg.runnerPingInterval) {
        room.config.runnerPingInterval = parseInt(msg.runnerPingInterval, 10);
        room.config.pingInterval = room.config.runnerPingInterval;
        room.nextRunnerPingIn = room.config.runnerPingInterval;
        room.nextPingIn = room.config.runnerPingInterval;
      }

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

    case 'SKIP_HEAD_START': {
      const client = clients.get(ws);
      if (!client?.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room || room.state !== 'HEAD_START') return;
      startHuntPhase(room);
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
  room.nextHunterPingIn = room.config.hunterPingInterval || 30;
  room.nextRunnerPingIn = room.config.runnerPingInterval || 50;
  room.nextPingIn = room.nextRunnerPingIn;

  // Immediate initial pings so both teams establish initial radar contact
  triggerHunterPing(room);
  triggerRunnerPing(room);

  broadcastToRoom(room, {
    type: 'PHASE_CHANGED',
    state: room.state,
    startTime: room.phaseStartTime,
    duration: room.config.roundLength,
    timeRemaining: room.timeRemaining,
    nextHunterPingIn: room.nextHunterPingIn,
    nextRunnerPingIn: room.nextRunnerPingIn,
    config: room.config,
    players: serializePlayers(room)
  });

  if (room.timer) clearInterval(room.timer);

  room.timer = setInterval(() => {
    room.timeRemaining--;
    room.nextHunterPingIn--;
    room.nextRunnerPingIn--;
    room.nextPingIn = room.nextRunnerPingIn;

    // Check Hunter Ping Interval trigger
    if (room.nextHunterPingIn <= 0) {
      triggerHunterPing(room);
      room.nextHunterPingIn = room.config.hunterPingInterval || 30;
    }

    // Check Runner Ping Interval trigger
    if (room.nextRunnerPingIn <= 0) {
      triggerRunnerPing(room);
      room.nextRunnerPingIn = room.config.runnerPingInterval || 50;
      room.nextPingIn = room.nextRunnerPingIn;
    }

    if (room.timeRemaining <= 0) {
      endGame(room, 'RUNNERS_SURVIVED');
    } else {
      broadcastToRoom(room, {
        type: 'CLOCK_TICK',
        state: room.state,
        timeRemaining: room.timeRemaining,
        nextHunterPingIn: room.nextHunterPingIn,
        nextRunnerPingIn: room.nextRunnerPingIn,
        nextPingIn: room.nextRunnerPingIn
      });
    }
  }, 1000);
}

function triggerRunnerPing(room) {
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
    type: 'RUNNER_PING',
    timestamp: Date.now(),
    runnerPings
  };

  room.lastRunnerPing = pingEvent;
  room.lastPing = pingEvent;
  room.pingsHistory.push(pingEvent);

  broadcastToRoom(room, {
    type: 'PING_FIRED',
    pingType: 'RUNNER',
    ping: pingEvent,
    totalPings: room.pingsHistory.length
  });
}

function triggerHunterPing(room) {
  const hunterPings = [];
  for (const p of room.players.values()) {
    if (p.assignedRole === 'hunter') {
      hunterPings.push({
        id: p.id,
        name: p.name,
        lat: p.lat,
        lng: p.lng
      });
    }
  }

  const pingEvent = {
    type: 'HUNTER_PING',
    timestamp: Date.now(),
    hunterPings
  };

  room.lastHunterPing = pingEvent;

  broadcastToRoom(room, {
    type: 'HUNTER_PING_FIRED',
    pingType: 'HUNTER',
    ping: pingEvent
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
    nextHunterPingIn: room.nextHunterPingIn,
    nextRunnerPingIn: room.nextRunnerPingIn,
    nextPingIn: room.nextRunnerPingIn,
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
