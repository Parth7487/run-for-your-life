// RUN FOR YOUR LIFE: WebApp Client
// Designed and developed by Shopifydevstudio

(() => {
  'use strict';

  // State
  let ws = null;
  let myPlayerId = localStorage.getItem('RFYL_ACTIVE_PLAYER_ID') || ('p_' + Math.random().toString(36).substring(2, 9));
  localStorage.setItem('RFYL_ACTIVE_PLAYER_ID', myPlayerId);

  let myRoomCode = localStorage.getItem('RFYL_ACTIVE_ROOM') || null;
  let isHost = false;
  let currentRole = 'random';
  let myAssignedRole = null; // 'hunter' | 'runner'
  let myPosition = { lat: 37.7749, lng: -122.4194 }; // Default San Francisco
  let myPath = [];
  let useSimulationGps = false;
  let hasLocationPermission = false;
  let watchPositionId = null;
  let pendingActionAfterPermission = null;

  // Pending Photo for Chat
  let pendingChatPhoto = null;
  let unreadChatCount = 0;
  let isChatOpen = false;

  // Disconnect Buffer Timer
  let disconnectBufferInterval = null;

  // Maps
  let setupMap = null;
  let setupCircle = null;
  let gameMap = null;
  let gameCircle = null;
  let myMarker = null;
  let hunterMarkers = new Map();
  let runnerPingMarkers = new Map();
  let currentRoomData = null;
  let activeGameClockInterval = null;
  let cachedLobbyPlayers = [];
  let currentRoomConfig = {
    headStart: 180,
    roundLength: 2700,
    hunterPingInterval: 30,
    runnerPingInterval: 50,
    arena: null
  };

  // Joystick state
  const joystickState = { active: false, startX: 0, startY: 0, moveX: 0, moveY: 0 };
  let joystickInterval = null;

  // DOM Elements
  const screens = {
    splash: document.getElementById('screen-splash'),
    landing: document.getElementById('screen-landing'),
    hostSetup: document.getElementById('screen-host-setup'),
    join: document.getElementById('screen-join'),
    lobby: document.getElementById('screen-lobby'),
    scatter: document.getElementById('screen-scatter'),
    hunt: document.getElementById('screen-hunt'),
    gameOver: document.getElementById('screen-game-over')
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    if (screens[name]) {
      screens[name].classList.add('active');
    }
    // Resize map when entering map screens
    setTimeout(() => {
      if (name === 'hostSetup' && setupMap) setupMap.invalidateSize();
      if (name === 'hunt' && gameMap) gameMap.invalidateSize();
    }, 150);
  }

  // --- DRAMATIC TAKOBE PRELOADER ---
  let preloaderFinished = false;
  function finishPreloader() {
    if (preloaderFinished) return;
    preloaderFinished = true;
    showScreen('landing');
    
    // Check if shared via URL link
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      const joinInput = document.getElementById('join-code-input');
      if (joinInput) joinInput.value = roomParam.toUpperCase();
      showScreen('join');
    }
  }

  // Animate preloader progress
  const progressFill = document.getElementById('preloader-progress-fill');
  const statusLabel = document.getElementById('preloader-status-label');
  const skipBtn = document.getElementById('btn-skip-splash');

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      finishPreloader();
    });
  }

  const preloaderSteps = [
    { p: 20, text: 'INITIALIZING SATELLITE RADAR...' },
    { p: 45, text: 'CALIBRATING GPS SENSORS...' },
    { p: 70, text: 'LOADING TAKOBE DISPLAY SYSTEM...' },
    { p: 90, text: 'CONNECTING TO SUPABASE REALTIME...' },
    { p: 100, text: 'TACTICAL RADAR READY' }
  ];

  let stepIdx = 0;
  function runPreloaderStep() {
    if (preloaderFinished) return;
    if (stepIdx < preloaderSteps.length) {
      const step = preloaderSteps[stepIdx];
      if (progressFill) progressFill.style.width = step.p + '%';
      if (statusLabel) statusLabel.textContent = step.text;
      stepIdx++;
      setTimeout(runPreloaderStep, 450);
    } else {
      setTimeout(finishPreloader, 400);
    }
  }
  runPreloaderStep();

  // --- COMPULSORY OPERATIVE CODENAME SYSTEM ---
  const nameInput = document.getElementById('player-name-input');
  const nameWarning = document.getElementById('name-validation-msg');

  // Load saved name if any
  const savedPlayerName = localStorage.getItem('RFYL_PLAYER_NAME');
  if (savedPlayerName && nameInput) {
    nameInput.value = savedPlayerName;
  }

  function validatePlayerName() {
    const val = nameInput ? nameInput.value.trim() : '';
    if (!val) {
      if (nameWarning) {
        nameWarning.style.display = 'block';
        nameWarning.classList.add('shake');
        setTimeout(() => nameWarning.classList.remove('shake'), 600);
      }
      if (nameInput) {
        nameInput.focus();
        nameInput.classList.add('error-shake');
        setTimeout(() => nameInput.classList.remove('error-shake'), 600);
      }
      window.soundEngine?.playHeartbeat?.();
      return null;
    }
    if (nameWarning) nameWarning.style.display = 'none';
    localStorage.setItem('RFYL_PLAYER_NAME', val);
    return val;
  }

  if (nameInput) {
    nameInput.addEventListener('input', () => {
      if (nameInput.value.trim().length > 0) {
        if (nameWarning) nameWarning.style.display = 'none';
        localStorage.setItem('RFYL_PLAYER_NAME', nameInput.value.trim());
      }
    });
  }

  // --- INITIALIZE WEBSOCKET WITH 90s RECONNECT SUPPORT ---
  function initWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Connected to game server');

        // Check if we need to auto-reconnect to an active room
        const activeRoom = localStorage.getItem('RFYL_ACTIVE_ROOM');
        const activeName = localStorage.getItem('RFYL_PLAYER_NAME');
        if (activeRoom && activeName && myPlayerId) {
          console.log(`Attempting reconnect to room ${activeRoom} as ${activeName}`);
          ws.send(JSON.stringify({
            type: 'RECONNECT_ROOM',
            roomCode: activeRoom,
            playerId: myPlayerId,
            name: activeName
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleServerMessage(msg);
        } catch (e) {
          console.error('Error parsing server message:', e);
        }
      };

      ws.onclose = () => {
        // Retry connection in background
        setTimeout(initWebSocket, 4000);
      };
    } catch (e) {
      console.warn('WebSocket unavailable, relying on Supabase Realtime channel.');
    }
  }

  initWebSocket();

  // --- SERVER & REALTIME MESSAGE HANDLER ---
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'ROOM_CREATED':
        myPlayerId = msg.playerId || myPlayerId;
        myRoomCode = msg.roomCode;
        isHost = true;
        localStorage.setItem('RFYL_ACTIVE_ROOM', myRoomCode);
        localStorage.setItem('RFYL_ACTIVE_PLAYER_ID', myPlayerId);

        updateLobbyRoomCode(myRoomCode);
        document.getElementById('btn-start-game').style.display = 'block';
        document.getElementById('host-waiting-msg').style.display = 'none';
        showScreen('lobby');
        connectToSupabaseRoom(myRoomCode);
        break;

      case 'ROOM_JOINED':
      case 'RECONNECTED':
        myPlayerId = msg.playerId || myPlayerId;
        myRoomCode = msg.roomCode;
        isHost = false;
        localStorage.setItem('RFYL_ACTIVE_ROOM', myRoomCode);
        localStorage.setItem('RFYL_ACTIVE_PLAYER_ID', myPlayerId);

        updateLobbyRoomCode(myRoomCode);
        document.getElementById('btn-start-game').style.display = 'none';
        document.getElementById('host-waiting-msg').style.display = 'block';
        
        if (msg.roomState && (msg.roomState.state === 'HUNT' || msg.roomState.state === 'HEAD_START')) {
          currentRoomData = msg.roomState;
          handlePhaseChange(msg.roomState);
        } else {
          showScreen('lobby');
        }
        connectToSupabaseRoom(myRoomCode);
        break;

      case 'ROOM_STATE':
        currentRoomData = Object.assign(currentRoomData || {}, msg);
        if (msg.config) currentRoomConfig = Object.assign(currentRoomConfig, msg.config);
        updateLobbyUI(msg);
        break;

      case 'PHASE_CHANGED':
        handlePhaseChange(msg);
        break;

      case 'CLOCK_TICK':
        handleClockTick(msg);
        break;

      case 'LOCATION_UPDATE':
        handlePeerLocation(msg);
        break;

      case 'PING_FIRED':
      case 'HUNTER_PING_FIRED':
      case 'RUNNER_PING_FIRED':
        handlePingFired(msg);
        break;

      case 'HUNTERS_LIVE_POSITIONS':
        updateHunterPositions(msg.hunters);
        break;

      case 'PLAYER_TAGGED':
        handlePlayerTagged(msg);
        break;

      case 'GAME_OVER':
        handleGameOver(msg);
        break;

      case 'PLAYER_DISCONNECTED_BUFFER':
        handlePlayerDisconnectedBuffer(msg);
        break;

      case 'PLAYER_RECONNECTED':
        handlePlayerReconnected(msg);
        break;

      case 'PLAYER_DROPPED':
        handlePlayerDropped(msg);
        break;

      case 'CHAT_MESSAGE':
        receiveChatMessage(msg.message || msg);
        break;

      case 'ERROR':
        alert(msg.message);
        break;
    }
  }

  function updateLobbyRoomCode(code) {
    const badge = document.getElementById('lobby-code-badge');
    if (badge) badge.textContent = code;
  }

  // --- 90-SECOND DISCONNECT BUFFER NOTIFICATION ---
  function handlePlayerDisconnectedBuffer(data) {
    const banner = document.getElementById('disconnect-buffer-banner');
    const textEl = document.getElementById('disconnect-buffer-text');
    if (!banner || !textEl) return;

    let bufferSeconds = data.bufferSeconds || 90;
    banner.style.display = 'flex';
    textEl.textContent = `⚠️ OPERATIVE ${escapeHtml(data.name).toUpperCase()} SIGNAL LOST • 90s REJOIN BUFFER ACTIVE (${bufferSeconds}s)`;

    if (disconnectBufferInterval) clearInterval(disconnectBufferInterval);

    disconnectBufferInterval = setInterval(() => {
      bufferSeconds--;
      if (bufferSeconds <= 0) {
        clearInterval(disconnectBufferInterval);
        textEl.textContent = `❌ OPERATIVE ${escapeHtml(data.name).toUpperCase()} DISCONNECTED (TIMEOUT)`;
        setTimeout(() => (banner.style.display = 'none'), 4000);
      } else {
        textEl.textContent = `⚠️ OPERATIVE ${escapeHtml(data.name).toUpperCase()} SIGNAL LOST • 90s REJOIN BUFFER ACTIVE (${bufferSeconds}s)`;
      }
    }, 1000);
  }

  function handlePlayerReconnected(data) {
    const banner = document.getElementById('disconnect-buffer-banner');
    const textEl = document.getElementById('disconnect-buffer-text');
    if (disconnectBufferInterval) clearInterval(disconnectBufferInterval);

    if (banner && textEl) {
      banner.style.display = 'flex';
      textEl.textContent = `⚡ OPERATIVE ${escapeHtml(data.name).toUpperCase()} RE-ESTABLISHED SATELLITE UPLINK!`;
      setTimeout(() => {
        banner.style.display = 'none';
      }, 3500);
    }
  }

  function handlePlayerDropped(data) {
    const banner = document.getElementById('disconnect-buffer-banner');
    const textEl = document.getElementById('disconnect-buffer-text');
    if (disconnectBufferInterval) clearInterval(disconnectBufferInterval);

    if (banner && textEl) {
      banner.style.display = 'flex';
      textEl.textContent = `❌ OPERATIVE ${escapeHtml(data.name).toUpperCase()} DISCONNECTED`;
      setTimeout(() => {
        banner.style.display = 'none';
      }, 3000);
    }
  }

  // --- SUPABASE REALTIME BRIDGE ---
  async function connectToSupabaseRoom(code) {
    if (!window.supabaseGameManager) return;
    const playerName = document.getElementById('player-name-input').value.trim() || 'Operative';
    const player = {
      id: myPlayerId,
      name: playerName,
      rolePreference: currentRole,
      assignedRole: myAssignedRole,
      lat: myPosition.lat,
      lng: myPosition.lng
    };

    await window.supabaseGameManager.connectToRoom(
      code,
      player,
      (event) => {
        handleServerMessage(event);
      },
      (presencePlayers) => {
        if (presencePlayers && presencePlayers.length > 0) {
          updateLobbyWithPresence(presencePlayers);
        }
      }
    );
  }

  function handlePeerLocation(data) {
    const payload = data.payload ? { ...data.payload, ...data } : data;
    if (!payload || payload.playerId === myPlayerId) return;
    if (myAssignedRole === 'hunter' && payload.role === 'hunter' && payload.lat && payload.lng) {
      updateHunterPositions([{ id: payload.playerId, name: payload.name || 'Hunter', lat: payload.lat, lng: payload.lng }]);
    }
  }

  function updateLobbyWithPresence(presencePlayers) {
    const formattedPlayers = presencePlayers.map((p) => ({
      id: p.id,
      name: p.name,
      rolePreference: p.rolePreference || 'random',
      assignedRole: p.assignedRole,
      connected: true,
      isTagged: p.isTagged || false
    }));
    cachedLobbyPlayers = formattedPlayers;
    if (!currentRoomData?.state || currentRoomData.state === 'LOBBY') {
      updateLobbyUI({ players: formattedPlayers });
    }
  }

  // --- LOCATION PERMISSION SYSTEM ---
  function requestLocationPermission(actionCallback) {
    if (hasLocationPermission) {
      actionCallback();
      return;
    }

    pendingActionAfterPermission = actionCallback;
    document.getElementById('location-permission-modal').classList.add('active');
  }

  document.getElementById('btn-allow-gps').addEventListener('click', () => {
    window.soundEngine?.playClick();
    document.getElementById('location-permission-modal').classList.remove('active');

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          hasLocationPermission = true;
          useSimulationGps = false;
          myPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const gpsLabel = document.getElementById('gps-btn-label');
          if (gpsLabel) gpsLabel.textContent = 'GPS';
          document.getElementById('joystick').style.display = 'none';

          if (setupMap) setupMap.setView([myPosition.lat, myPosition.lng], 16);
          if (pendingActionAfterPermission) {
            pendingActionAfterPermission();
            pendingActionAfterPermission = null;
          }
        },
        (err) => {
          console.warn('GPS permission denied or unavailable:', err);
          hasLocationPermission = true;
          useSimulationGps = true;
          const gpsLabel = document.getElementById('gps-btn-label');
          if (gpsLabel) gpsLabel.textContent = 'Sim';
          document.getElementById('joystick').style.display = 'flex';
          alert('GPS permission not granted. Switched to on-screen Simulation Joystick.');
          if (pendingActionAfterPermission) {
            pendingActionAfterPermission();
            pendingActionAfterPermission = null;
          }
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      hasLocationPermission = true;
      useSimulationGps = true;
      if (pendingActionAfterPermission) pendingActionAfterPermission();
    }
  });

  document.getElementById('btn-deny-gps').addEventListener('click', () => {
    window.soundEngine?.playClick();
    document.getElementById('location-permission-modal').classList.remove('active');
    hasLocationPermission = true;
    useSimulationGps = true;
    const gpsLabel = document.getElementById('gps-btn-label');
    if (gpsLabel) gpsLabel.textContent = 'Sim';
    document.getElementById('joystick').style.display = 'flex';
    if (pendingActionAfterPermission) {
      pendingActionAfterPermission();
      pendingActionAfterPermission = null;
    }
  });

  // Sound Toggle with Custom Vector Emoticon waves / slash
  function updateSoundBtnVisual() {
    const soundBtn = document.getElementById('sound-btn');
    if (!soundBtn) return;
    const waves = soundBtn.querySelector('.sound-waves');
    const slash = soundBtn.querySelector('.sound-slash');
    if (waves && slash) {
      waves.style.display = window.soundEngine.muted ? 'none' : 'block';
      slash.style.display = window.soundEngine.muted ? 'block' : 'none';
    }
    soundBtn.setAttribute('title', window.soundEngine.muted ? 'Tactical Audio: Muted' : 'Tactical Audio: Active');
  }

  document.getElementById('sound-btn').addEventListener('click', () => {
    window.soundEngine.muted = !window.soundEngine.muted;
    updateSoundBtnVisual();
  });

  // Settings Modal (Supabase Configuration)
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    window.soundEngine?.playClick();
    document.getElementById('supabase-url-input').value = window.supabaseGameManager.supabaseUrl;
    document.getElementById('supabase-key-input').value = window.supabaseGameManager.supabaseAnonKey;
    document.getElementById('settings-modal').classList.add('active');
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('active');
  });

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    window.soundEngine?.playClick();
    const url = document.getElementById('supabase-url-input').value.trim();
    const key = document.getElementById('supabase-key-input').value.trim();
    window.supabaseGameManager.updateCredentials(url, key);
    alert('Supabase credentials updated! Realtime channel reconnected.');
    document.getElementById('settings-modal').classList.remove('active');
  });

  // --- NAVIGATION & GATING WITH COMPULSORY NAME ---
  document.getElementById('btn-open-host').addEventListener('click', () => {
    window.soundEngine?.playClick();
    const name = validatePlayerName();
    if (!name) return;

    requestLocationPermission(() => {
      showScreen('hostSetup');
      initSetupMap();
    });
  });

  document.getElementById('host-back-btn').addEventListener('click', () => {
    window.soundEngine?.playClick();
    showScreen('landing');
  });

  document.getElementById('btn-open-join').addEventListener('click', () => {
    window.soundEngine?.playClick();
    const name = validatePlayerName();
    if (!name) return;

    requestLocationPermission(() => {
      showScreen('join');
    });
  });

  document.getElementById('join-back-btn').addEventListener('click', () => {
    window.soundEngine?.playClick();
    showScreen('landing');
  });

  // --- SETUP MAP (DRAGGABLE ARENA GEOFENCE) ---
  function initSetupMap() {
    if (setupMap) return;

    setupMap = L.map('setup-map', {
      zoomControl: false,
      attributionControl: false
    }).setView([myPosition.lat, myPosition.lng], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(setupMap);

    const radius = parseInt(document.getElementById('radius-slider').value, 10);
    setupCircle = L.circle([myPosition.lat, myPosition.lng], {
      color: '#912925',
      fillColor: '#912925',
      fillOpacity: 0.2,
      weight: 3,
      radius: radius
    }).addTo(setupMap);

    setupMap.on('move', () => {
      const center = setupMap.getCenter();
      setupCircle.setLatLng(center);
    });

    document.getElementById('radius-slider').addEventListener('input', (e) => {
      const r = parseInt(e.target.value, 10);
      document.getElementById('radius-display').textContent = `${r} m`;
      setupCircle.setRadius(r);
    });
  }

  // --- CREATE ROOM (DUAL PING INTERVALS SELECTION) ---
  document.getElementById('btn-confirm-create-room').addEventListener('click', () => {
    window.soundEngine?.playClick();
    const name = validatePlayerName() || 'Operative One';
    const center = setupMap ? setupMap.getCenter() : myPosition;
    const radius = parseInt(document.getElementById('radius-slider').value, 10);
    const roundLength = parseInt(document.getElementById('round-length-select').value, 10);
    
    // Custom individual Hunter and Runner Ping Intervals (20s - 80s)
    const hunterPingInterval = parseInt(document.getElementById('hunter-ping-interval-select')?.value || '30', 10);
    const runnerPingInterval = parseInt(document.getElementById('runner-ping-interval-select')?.value || '50', 10);

    const arena = { lat: center.lat, lng: center.lng, radius };

    currentRoomConfig = {
      arena,
      roundLength,
      pingInterval: runnerPingInterval,
      hunterPingInterval,
      runnerPingInterval,
      headStart: 180
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'CREATE_ROOM',
          name,
          arena,
          roundLength,
          pingInterval: runnerPingInterval,
          hunterPingInterval,
          runnerPingInterval,
          headStart: 180
        })
      );
    } else {
      // Direct client room creation if offline / Vercel
      const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      currentRoomData = {
        code: randomCode,
        hostId: myPlayerId,
        state: 'LOBBY',
        config: currentRoomConfig,
        timeRemaining: roundLength,
        players: [{ id: myPlayerId, name, rolePreference: currentRole }]
      };
      handleServerMessage({
        type: 'ROOM_CREATED',
        roomCode: randomCode,
        playerId: myPlayerId
      });
      window.supabaseGameManager.saveRoomToDb({
        code: randomCode,
        hostId: myPlayerId,
        state: 'LOBBY',
        config: currentRoomConfig,
        timeRemaining: roundLength
      });
    }
  });

  // --- JOIN ROOM ---
  document.getElementById('btn-confirm-join').addEventListener('click', () => {
    window.soundEngine?.playClick();
    const name = validatePlayerName() || 'Operative ' + Math.floor(Math.random() * 90 + 10);
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();

    if (code.length !== 6) {
      alert('Please enter a valid 6-letter operation code.');
      return;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'JOIN_ROOM',
          roomCode: code,
          name,
          rolePreference: currentRole
        })
      );
    } else {
      handleServerMessage({
        type: 'ROOM_JOINED',
        roomCode: code,
        playerId: myPlayerId
      });
    }
  });

  // Copy Room Link
  document.getElementById('btn-copy-link')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    const url = `${window.location.origin}?room=${myRoomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      const copyBtn = document.getElementById('btn-copy-link');
      if (copyBtn) {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = 'Share Code'), 2000);
      }
    });
  });

  // Role Selection Cards in Lobby
  document.querySelectorAll('.role-card').forEach((card) => {
    card.addEventListener('click', () => {
      window.soundEngine?.playClick();
      document.querySelectorAll('.role-card').forEach((c) => c.classList.remove('selected', 'hunter', 'runner'));
      card.classList.add('selected');
      const role = card.dataset.role;
      if (role !== 'random') card.classList.add(role);
      currentRole = role;

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'SELECT_ROLE', role }));
      }
      window.supabaseGameManager.updatePresence({
        id: myPlayerId,
        name: document.getElementById('player-name-input').value.trim() || 'Operative',
        rolePreference: currentRole
      });
    });
  });

  // --- ROLE ASSIGNMENT ALGORITHM (1v1 DUEL & SQUAD SUPPORT) ---
  function assignRolesForPlayers(players) {
    if (!players || players.length === 0) return;

    if (players.length === 2) {
      // 1v1 Duel Mode: exactly 1 hunter and 1 runner
      const p1 = players[0];
      const p2 = players[1];

      if (p1.rolePreference === 'hunter' && p2.rolePreference === 'runner') {
        p1.assignedRole = 'hunter';
        p2.assignedRole = 'runner';
      } else if (p1.rolePreference === 'runner' && p2.rolePreference === 'hunter') {
        p1.assignedRole = 'runner';
        p2.assignedRole = 'hunter';
      } else if (p1.rolePreference === 'hunter') {
        p1.assignedRole = 'hunter';
        p2.assignedRole = 'runner';
      } else if (p2.rolePreference === 'hunter') {
        p1.assignedRole = 'runner';
        p2.assignedRole = 'hunter';
      } else {
        const rand = Math.random() < 0.5;
        p1.assignedRole = rand ? 'hunter' : 'runner';
        p2.assignedRole = rand ? 'runner' : 'hunter';
      }
    } else {
      // Squad Mode: ~1/3 hunters, ~2/3 runners
      const explicitHunters = players.filter((p) => p.rolePreference === 'hunter');
      const explicitRunners = players.filter((p) => p.rolePreference === 'runner');
      const randoms = players.filter((p) => p.rolePreference !== 'hunter' && p.rolePreference !== 'runner');

      const targetHunters = Math.max(1, Math.floor(players.length / 3));
      const assignedHunters = [];
      const assignedRunners = [];

      while (explicitHunters.length > 0 && assignedHunters.length < targetHunters) {
        assignedHunters.push(explicitHunters.pop());
      }
      while (explicitHunters.length > 0) {
        assignedRunners.push(explicitHunters.pop());
      }
      while (explicitRunners.length > 0) {
        assignedRunners.push(explicitRunners.pop());
      }
      while (randoms.length > 0 && assignedHunters.length < targetHunters) {
        assignedHunters.push(randoms.pop());
      }
      while (randoms.length > 0) {
        assignedRunners.push(randoms.pop());
      }

      if (assignedHunters.length === 0 && assignedRunners.length > 0) {
        assignedHunters.push(assignedRunners.pop());
      } else if (assignedRunners.length === 0 && assignedHunters.length > 1) {
        assignedRunners.push(assignedHunters.pop());
      }

      assignedHunters.forEach((p) => (p.assignedRole = 'hunter'));
      assignedRunners.forEach((p) => (p.assignedRole = 'runner'));
    }
  }

  // --- START GAME (WITH 2-PLAYER 1v1 SUPPORT) ---
  document.getElementById('btn-start-game').addEventListener('click', () => {
    window.soundEngine?.playClick();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'START_GAME' }));
    } else {
      // Direct client / Supabase Realtime mode
      const myName = document.getElementById('player-name-input').value.trim() || 'Operative';
      const playersToAssign = (cachedLobbyPlayers && cachedLobbyPlayers.length > 0)
        ? cachedLobbyPlayers.map((p) => ({ ...p }))
        : [{ id: myPlayerId, name: myName, rolePreference: currentRole }];

      if (!playersToAssign.some((p) => p.id === myPlayerId)) {
        playersToAssign.push({ id: myPlayerId, name: myName, rolePreference: currentRole });
      }

      assignRolesForPlayers(playersToAssign);

      const headStartSec = currentRoomConfig.headStart || 180;
      const startPayload = {
        state: 'HEAD_START',
        startTime: Date.now(),
        duration: headStartSec,
        timeRemaining: headStartSec,
        config: currentRoomConfig,
        players: playersToAssign
      };

      currentRoomData = Object.assign(currentRoomData || {}, startPayload);
      window.supabaseGameManager.broadcastEvent('phase_change', startPayload);
      handlePhaseChange(startPayload);
    }
  });

  // --- FAST-FORWARD / SKIP SCATTER HEAD START BUTTON ---
  document.getElementById('btn-skip-scatter')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    triggerHuntPhaseTransition();
  });

  // --- TRANSITION FROM SCATTER TO ACTIVE HUNT ---
  function triggerHuntPhaseTransition() {
    if (activeGameClockInterval) {
      clearInterval(activeGameClockInterval);
      activeGameClockInterval = null;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'SKIP_HEAD_START' }));
    }

    const roundDuration = currentRoomConfig.roundLength || 2700;
    const huntPayload = {
      state: 'HUNT',
      startTime: Date.now(),
      duration: roundDuration,
      timeRemaining: roundDuration,
      nextHunterPingIn: currentRoomConfig.hunterPingInterval || 30,
      nextRunnerPingIn: currentRoomConfig.runnerPingInterval || 50,
      config: currentRoomConfig,
      players: currentRoomData?.players || cachedLobbyPlayers || []
    };

    currentRoomData = Object.assign(currentRoomData || {}, huntPayload);
    window.supabaseGameManager.broadcastEvent('phase_change', huntPayload);
    handlePhaseChange(huntPayload);
  }

  // --- UPDATE LOBBY UI & 2-PLAYER 1v1 DUEL BADGE ---
  function updateLobbyUI(data) {
    const players = data.players || [];
    document.getElementById('lobby-player-count').textContent = players.length;

    const huntersCount = players.filter((p) => p.rolePreference === 'hunter').length;
    const runnersCount = players.filter((p) => p.rolePreference === 'runner').length;

    document.getElementById('lobby-hunter-count').textContent = `Hunters: ${huntersCount}`;
    document.getElementById('lobby-runner-count').textContent = `Runners: ${runnersCount}`;

    const totalVotes = huntersCount + runnersCount || 1;
    document.getElementById('fairness-hunter-bar').style.width = `${(huntersCount / totalVotes) * 100}%`;
    document.getElementById('fairness-runner-bar').style.width = `${(runnersCount / totalVotes) * 100}%`;

    // 2-Player 1v1 Duel Detection
    const duelBadge = document.getElementById('lobby-2player-badge');
    const startBtn = document.getElementById('btn-start-game');
    if (players.length === 2) {
      if (duelBadge) duelBadge.style.display = 'block';
      if (startBtn) startBtn.textContent = 'LAUNCH 1v1 DUEL';
    } else {
      if (duelBadge) duelBadge.style.display = 'none';
      if (startBtn) startBtn.textContent = 'LAUNCH OPERATION';
    }

    const listEl = document.getElementById('lobby-player-list');
    listEl.innerHTML = '';
    players.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'player-item';
      const isMe = p.id === myPlayerId;
      item.innerHTML = `
        <span>${escapeHtml(p.name)} ${isMe ? '<b>(You)</b>' : ''}</span>
        <span class="player-role-badge badge-${p.rolePreference}">${p.rolePreference}</span>
      `;
      listEl.appendChild(item);
    });
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  }

  // --- REAL-TIME SYNCHRONIZED CLIENT GAME CLOCK ---
  function startClientGameClock(state, startTime, durationSec) {
    if (activeGameClockInterval) {
      clearInterval(activeGameClockInterval);
      activeGameClockInterval = null;
    }

    const startTs = startTime || Date.now();
    const totalDuration = durationSec > 0 ? durationSec : (state === 'HEAD_START' ? (currentRoomConfig.headStart || 180) : (currentRoomConfig.roundLength || 2700));

    let lastHunterPingSec = -1;
    let lastRunnerPingSec = -1;

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startTs) / 1000);
      const remaining = Math.max(0, totalDuration - elapsed);

      if (state === 'HEAD_START') {
        handleClockTick({
          state: 'HEAD_START',
          timeRemaining: remaining
        });

        if (remaining <= 0) {
          clearInterval(activeGameClockInterval);
          activeGameClockInterval = null;
          triggerHuntPhaseTransition();
        }
      } else if (state === 'HUNT') {
        const hInterval = currentRoomConfig.hunterPingInterval || 30;
        const rInterval = currentRoomConfig.runnerPingInterval || 50;

        const hPingIn = hInterval - (elapsed % hInterval);
        const rPingIn = rInterval - (elapsed % rInterval);

        handleClockTick({
          state: 'HUNT',
          timeRemaining: remaining,
          hunterPingIn: hPingIn,
          runnerPingIn: rPingIn,
          nextPingIn: rPingIn
        });

        // Trigger radar pings on interval completion
        if (elapsed > 0 && elapsed % hInterval === 0 && lastHunterPingSec !== elapsed) {
          lastHunterPingSec = elapsed;
          triggerPeerOrLocalPing('hunter');
        }
        if (elapsed > 0 && elapsed % rInterval === 0 && lastRunnerPingSec !== elapsed) {
          lastRunnerPingSec = elapsed;
          triggerPeerOrLocalPing('runner');
        }

        if (remaining <= 0) {
          clearInterval(activeGameClockInterval);
          activeGameClockInterval = null;
          const gameOverPayload = {
            winner: 'runners',
            reason: 'SURVIVAL_TIME_EXPIRED',
            stats: {
              durationSeconds: totalDuration,
              totalPings: Math.floor(elapsed / rInterval)
            }
          };
          if (isHost) {
            window.supabaseGameManager.broadcastEvent('game_over', gameOverPayload);
          }
          handleGameOver(gameOverPayload);
        }
      }
    };

    tick();
    activeGameClockInterval = setInterval(tick, 1000);
  }

  // --- TRIGGER PEER OR LOCAL RADAR PINGS ---
  function triggerPeerOrLocalPing(role) {
    if (role === 'runner') {
      window.soundEngine?.playPing();
      if (myAssignedRole === 'runner') {
        const pingPayload = {
          type: 'PING_FIRED',
          runnerPings: [{
            id: myPlayerId,
            name: document.getElementById('player-name-input').value.trim() || 'Operative',
            lat: myPosition.lat,
            lng: myPosition.lng
          }]
        };
        window.supabaseGameManager.broadcastEvent('ping_fired', pingPayload);
      }
    } else if (role === 'hunter') {
      if (myAssignedRole === 'hunter') {
        const hunterPayload = {
          type: 'HUNTER_PING_FIRED',
          hunters: [{
            id: myPlayerId,
            name: document.getElementById('player-name-input').value.trim() || 'Operative',
            lat: myPosition.lat,
            lng: myPosition.lng
          }]
        };
        window.supabaseGameManager.broadcastEvent('hunter_ping_fired', hunterPayload);
      }
    }
  }

  // --- PHASE MANAGEMENT ---
  function handlePhaseChange(data) {
    const payload = data.payload ? { ...data.payload, ...data } : data;
    currentRoomData = Object.assign(currentRoomData || {}, payload);

    if (payload.config) {
      currentRoomConfig = Object.assign(currentRoomConfig, payload.config);
    }
    if (payload.hunterPingInterval) currentRoomConfig.hunterPingInterval = payload.hunterPingInterval;
    if (payload.runnerPingInterval) currentRoomConfig.runnerPingInterval = payload.runnerPingInterval;
    if (payload.headStart) currentRoomConfig.headStart = payload.headStart;
    if (payload.roundLength) currentRoomConfig.roundLength = payload.roundLength;
    if (payload.arena) currentRoomConfig.arena = payload.arena;

    const me = payload.players?.find((p) => p.id === myPlayerId);
    if (me && me.assignedRole) {
      myAssignedRole = me.assignedRole;
    } else if (!myAssignedRole) {
      myAssignedRole = currentRole === 'hunter' ? 'hunter' : 'runner';
    }

    const startTime = payload.startTime || Date.now();
    const duration = payload.duration || (payload.state === 'HEAD_START' ? (currentRoomConfig.headStart || 180) : (currentRoomConfig.roundLength || 2700));

    if (payload.state === 'HEAD_START') {
      showScreen('scatter');
      window.soundEngine?.playHeartbeat();

      const isRunner = myAssignedRole === 'runner';
      const roleTag = document.getElementById('scatter-role-badge');
      const actionWord = document.getElementById('scatter-action-word');
      const descText = document.getElementById('scatter-desc-text');

      if (isRunner) {
        roleTag.textContent = 'YOUR ROLE · RUNNER';
        actionWord.textContent = 'RUN.';
        actionWord.style.color = 'var(--parchment)';
        descText.textContent = 'Scatter and find cover inside the perimeter. Hunters are counting down.';
      } else {
        roleTag.textContent = 'YOUR ROLE · HUNTER';
        actionWord.textContent = 'STAND BY.';
        actionWord.style.color = '#60a5fa';
        descText.textContent = 'Runners are scattering to hide. Maintain your position. No peeking.';
      }

      startClientGameClock('HEAD_START', startTime, duration);
      startLocationTracking();
    } else if (payload.state === 'HUNT') {
      showScreen('hunt');
      window.soundEngine?.playPing();
      initGameMap();
      updateGameHUD();
      startClientGameClock('HUNT', startTime, duration);
      startLocationTracking();
    }
  }

  // --- CLOCK TICK & INDEPENDENT DUAL PING COUNTDOWNS ---
  function handleClockTick(data) {
    if (data.state === 'HEAD_START') {
      const timerEl = document.getElementById('scatter-timer-text');
      if (timerEl) timerEl.textContent = formatTime(data.timeRemaining);

      const totalHeadStart = currentRoomConfig?.headStart || currentRoomData?.config?.headStart || 180;
      const progressPercent = Math.max(0, Math.min(100, (data.timeRemaining / totalHeadStart) * 100));
      const progressBar = document.getElementById('scatter-progress-bar');
      if (progressBar) progressBar.style.width = `${progressPercent}%`;

      if (data.timeRemaining <= 10 && data.timeRemaining > 0) {
        window.soundEngine?.playHeartbeat(true);
      }
    } else if (data.state === 'HUNT') {
      const gameClock = document.getElementById('hud-game-clock');
      if (gameClock) gameClock.textContent = formatTime(data.timeRemaining);

      // Dual ping interval indicators
      const hunterClock = document.getElementById('hud-hunter-ping-clock');
      const runnerClock = document.getElementById('hud-runner-ping-clock');

      const hPingIn = data.hunterPingIn !== undefined ? data.hunterPingIn : data.nextPingIn;
      const rPingIn = data.runnerPingIn !== undefined ? data.runnerPingIn : data.nextPingIn;

      if (hunterClock && hPingIn !== undefined) hunterClock.textContent = `${hPingIn}s`;
      if (runnerClock && rPingIn !== undefined) runnerClock.textContent = `${rPingIn}s`;

      if ((hPingIn <= 4 && hPingIn > 0) || (rPingIn <= 4 && rPingIn > 0)) {
        window.soundEngine?.playHeartbeat(false);
      }
    }
  }

  // --- TACTICAL GAME MAP & HUD ---
  function initGameMap() {
    if (gameMap) return;

    const arena = currentRoomData?.config?.arena || { lat: myPosition.lat, lng: myPosition.lng, radius: 300 };

    gameMap = L.map('game-map', {
      zoomControl: false,
      attributionControl: false
    }).setView([arena.lat, arena.lng], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(gameMap);

    gameCircle = L.circle([arena.lat, arena.lng], {
      color: '#912925',
      fillColor: '#912925',
      fillOpacity: 0.15,
      weight: 3,
      radius: arena.radius
    }).addTo(gameMap);

    const isHunter = myAssignedRole === 'hunter';
    const markerColor = isHunter ? '#3b82f6' : '#F9E8AC';

    const playerIcon = L.divIcon({
      className: 'local-player-icon',
      html: `
        <div style="position:relative; width: 22px; height: 22px;">
          <div style="width: 18px; height: 18px; background: ${markerColor}; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 0 16px ${markerColor};"></div>
        </div>
      `,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    myMarker = L.marker([myPosition.lat, myPosition.lng], { icon: playerIcon }).addTo(gameMap);
    gameMap.panTo([myPosition.lat, myPosition.lng]);

    setupJoystick();
  }

  function updateGameHUD() {
    const isHunter = myAssignedRole === 'hunter';
    const rolePill = document.getElementById('hud-role-pill');
    const tagBtn = document.getElementById('btn-tag-action');
    const runnerTagBtn = document.getElementById('btn-runner-tagged-action');

    if (isHunter) {
      rolePill.textContent = 'HUNTER';
      rolePill.className = 'player-role-badge badge-hunter';
      tagBtn.style.display = 'block';
      runnerTagBtn.style.display = 'none';
    } else {
      rolePill.textContent = 'RUNNER';
      rolePill.className = 'player-role-badge badge-runner';
      tagBtn.style.display = 'none';
      runnerTagBtn.style.display = 'block';
    }

    updateRunnersAliveCount();
  }

  function updateRunnersAliveCount() {
    if (!currentRoomData?.players) return;
    const runners = currentRoomData.players.filter((p) => p.assignedRole === 'runner');
    const alive = runners.filter((p) => !p.isTagged).length;
    document.getElementById('hud-runners-alive').textContent = `${alive} of ${runners.length}`;
  }

  // Ping Event Handling
  function handlePingFired(msg) {
    window.soundEngine?.playPing();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

    const isHunter = myAssignedRole === 'hunter';
    const pings = msg.ping?.runnerPings || msg.runnerPings || [];

    runnerPingMarkers.forEach((m) => gameMap?.removeLayer(m));
    runnerPingMarkers.clear();

    if (isHunter) {
      pings.forEach((p) => {
        const pingIcon = L.divIcon({
          className: 'sonar-ping-icon',
          html: `
            <div class="sonar-ping-marker">
              <div class="sonar-ripple"></div>
              <div class="sonar-dot"></div>
              <div class="sonar-tag">${escapeHtml(p.name)} · PING</div>
            </div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        const marker = L.marker([p.lat, p.lng], { icon: pingIcon }).addTo(gameMap);
        runnerPingMarkers.set(p.id, marker);
      });
    } else {
      const alert = document.getElementById('boundary-alert');
      alert.style.borderColor = 'var(--brass)';
      alert.style.display = 'block';
      setTimeout(() => (alert.style.display = 'none'), 1200);
    }
  }

  // Update Fellow Hunter Positions
  function updateHunterPositions(hunters) {
    if (!gameMap) return;

    hunters.forEach((h) => {
      if (hunterMarkers.has(h.id)) {
        hunterMarkers.get(h.id).setLatLng([h.lat, h.lng]);
      } else {
        const icon = L.divIcon({
          className: 'teammate-hunter-icon',
          html: `
            <div style="background: var(--hunter-blue); color:#fff; font-size:10px; font-weight:800; border:2px solid var(--parchment); border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; box-shadow:0 0 10px rgba(59,130,246,0.6);">
              ${escapeHtml(h.name.substring(0, 2).toUpperCase())}
            </div>
          `,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });
        const marker = L.marker([h.lat, h.lng], { icon }).addTo(gameMap);
        hunterMarkers.set(h.id, marker);
      }
    });
  }

  // Player Tagged Event
  function handlePlayerTagged(msg) {
    window.soundEngine?.playTagAlarm();
    if (navigator.vibrate) navigator.vibrate([400, 200, 400]);

    alert(`🎯 TAGGED! ${msg.runnerName} was tagged by ${msg.hunterName}!`);

    if (msg.runnerId === myPlayerId) {
      document.getElementById('hud-role-pill').textContent = 'SPECTATOR';
      document.getElementById('hud-role-pill').className = 'player-role-badge badge-random';
      document.getElementById('btn-runner-tagged-action').style.display = 'none';
    }

    updateRunnersAliveCount();
  }

  // Game Over Event
  function handleGameOver(msg) {
    window.soundEngine?.playFanfare();
    showScreen('gameOver');

    const winnerTitle = document.getElementById('game-over-winner-title');
    const reasonText = document.getElementById('game-over-reason');

    if (msg.winner === 'HUNTERS') {
      winnerTitle.textContent = 'HUNTERS WON';
      winnerTitle.style.color = '#60a5fa';
      reasonText.textContent = 'All runners were caught before time expired.';
    } else {
      winnerTitle.textContent = 'RUNNERS SURVIVED';
      winnerTitle.style.color = 'var(--parchment)';
      reasonText.textContent = 'Runners evaded the chase and survived the round!';
    }

    const durationMin = Math.round((msg.stats?.durationSeconds || 0) / 60) || 1;
    document.getElementById('stat-match-duration').textContent = `${durationMin} min`;
    document.getElementById('stat-match-pings').textContent = `${msg.stats?.totalPings || 0} pings`;
  }

  document.getElementById('btn-return-lobby').addEventListener('click', () => {
    window.soundEngine?.playClick();
    localStorage.removeItem('RFYL_ACTIVE_ROOM');
    showScreen('landing');
  });

  // Force Ping Test Button (Debug / Optional)
  document.getElementById('btn-force-ping')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'FORCE_PING' }));
    }
  });

  // Toggle GPS vs Simulation Joystick (Debug / Optional)
  document.getElementById('btn-toggle-gps')?.addEventListener('click', () => {
    useSimulationGps = !useSimulationGps;
    const gpsLabel = document.getElementById('gps-btn-label');
    if (gpsLabel) gpsLabel.textContent = useSimulationGps ? 'Sim' : 'GPS';
    document.getElementById('joystick').style.display = useSimulationGps ? 'flex' : 'none';
    if (!useSimulationGps) {
      startRealGpsTracking();
    }
  });

  // --- LOCATION TRACKING & SIMULATION JOYSTICK ---
  function startLocationTracking() {
    if (useSimulationGps) {
      document.getElementById('joystick').style.display = 'flex';
    } else {
      startRealGpsTracking();
    }
  }

  function startRealGpsTracking() {
    if (watchPositionId !== null) return;
    if (navigator.geolocation) {
      watchPositionId = navigator.geolocation.watchPosition(
        (pos) => {
          if (!useSimulationGps) {
            updateAndSendLocation(pos.coords.latitude, pos.coords.longitude);
          }
        },
        (err) => console.warn('Geolocation watch error:', err),
        { enableHighAccuracy: true, maximumAge: 1000 }
      );
    }
  }

  function updateAndSendLocation(lat, lng) {
    myPosition = { lat, lng };
    myPath.push({ lat, lng, time: Date.now() });

    if (myMarker) myMarker.setLatLng([lat, lng]);
    if (gameMap) gameMap.panTo([lat, lng]);

    // Boundary check
    if (currentRoomData?.config?.arena) {
      const dist = haversine(lat, lng, currentRoomData.config.arena.lat, currentRoomData.config.arena.lng);
      const out = dist > currentRoomData.config.arena.radius;
      const alertEl = document.getElementById('boundary-alert');
      alertEl.style.display = out ? 'block' : 'none';
    }

    // 1. Send via WebSocket if available
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'UPDATE_LOCATION', lat, lng }));
    }

    // 2. Broadcast via Supabase Realtime channel
    if (window.supabaseGameManager) {
      window.supabaseGameManager.broadcastEvent('location_update', {
        playerId: myPlayerId,
        name: document.getElementById('player-name-input').value.trim() || 'Operative',
        role: myAssignedRole,
        lat,
        lng
      });
    }
  }

  // Virtual Joystick implementation
  function setupJoystick() {
    const joyEl = document.getElementById('joystick');
    const thumbEl = document.getElementById('joystick-thumb');

    const handleStart = (clientX, clientY) => {
      const rect = joyEl.getBoundingClientRect();
      joystickState.active = true;
      joystickState.startX = rect.left + rect.width / 2;
      joystickState.startY = rect.top + rect.height / 2;
      handleMove(clientX, clientY);

      if (!joystickInterval) {
        joystickInterval = setInterval(applyJoystickStep, 60);
      }
    };

    const handleMove = (clientX, clientY) => {
      if (!joystickState.active) return;
      const dx = clientX - joystickState.startX;
      const dy = clientY - joystickState.startY;
      const maxDist = 36;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const clampedDist = Math.min(dist, maxDist);

      const tx = Math.cos(angle) * clampedDist;
      const ty = Math.sin(angle) * clampedDist;

      thumbEl.style.transform = `translate(${tx}px, ${ty}px)`;
      joystickState.moveX = tx / maxDist;
      joystickState.moveY = ty / maxDist;
    };

    const handleEnd = () => {
      joystickState.active = false;
      thumbEl.style.transform = 'translate(0px, 0px)';
      joystickState.moveX = 0;
      joystickState.moveY = 0;
      if (joystickInterval) {
        clearInterval(joystickInterval);
        joystickInterval = null;
      }
    };

    joyEl.addEventListener('touchstart', (e) => handleStart(e.touches[0].clientX, e.touches[0].clientY));
    window.addEventListener('touchmove', (e) => {
      if (joystickState.active) handleMove(e.touches[0].clientX, e.touches[0].clientY);
    });
    window.addEventListener('touchend', handleEnd);

    joyEl.addEventListener('mousedown', (e) => handleStart(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => {
      if (joystickState.active) handleMove(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', handleEnd);

    window.addEventListener('keydown', (e) => {
      if (!screens.hunt.classList.contains('active')) return;
      const step = 0.00015;
      let dLat = 0;
      let dLng = 0;
      if (e.key === 'ArrowUp' || e.key === 'w') dLat += step;
      if (e.key === 'ArrowDown' || e.key === 's') dLat -= step;
      if (e.key === 'ArrowRight' || e.key === 'd') dLng += step;
      if (e.key === 'ArrowLeft' || e.key === 'a') dLng -= step;

      if (dLat !== 0 || dLng !== 0) {
        updateAndSendLocation(myPosition.lat + dLat, myPosition.lng + dLng);
      }
    });
  }

  function applyJoystickStep() {
    if (!joystickState.active) return;
    const speed = 0.000045;
    const newLat = myPosition.lat - joystickState.moveY * speed;
    const newLng = myPosition.lng + joystickState.moveX * speed;
    updateAndSendLocation(newLat, newLng);
  }

  // --- TAG ACTION DIALOGS ---
  document.getElementById('btn-tag-action').addEventListener('click', () => {
    window.soundEngine?.playClick();
    const runners = (currentRoomData?.players || []).filter((p) => p.assignedRole === 'runner' && !p.isTagged);
    const container = document.getElementById('tag-runner-options');
    container.innerHTML = '';

    if (runners.length === 0) {
      container.innerHTML = '<p style="color:var(--parchment-muted); font-size:13px;">No active runners left to tag!</p>';
    } else {
      runners.forEach((r) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.style.width = '100%';
        btn.style.textAlign = 'left';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '8px';
        btn.innerHTML = `<svg class="custom-emoticon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="var(--crimson)"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg> <span>Tag ${r.name}</span>`;
        btn.addEventListener('click', () => {
          document.getElementById('tag-modal').classList.remove('active');
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'TAG_CLAIM', targetRunnerId: r.id }));
          }
          window.supabaseGameManager.broadcastEvent('player_tagged', {
            runnerId: r.id,
            runnerName: r.name,
            hunterName: document.getElementById('player-name-input').value.trim() || 'Hunter'
          });
        });
        container.appendChild(btn);
      });
    }

    document.getElementById('tag-modal').classList.add('active');
  });

  document.getElementById('btn-cancel-tag').addEventListener('click', () => {
    document.getElementById('tag-modal').classList.remove('active');
  });

  document.getElementById('btn-runner-tagged-action').addEventListener('click', () => {
    if (confirm("Confirm that a hunter has tagged you in person? You'll become a spectator.")) {
      window.soundEngine?.playClick();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CONFIRM_TAGGED_SELF' }));
      }
      window.supabaseGameManager.broadcastEvent('player_tagged', {
        runnerId: myPlayerId,
        runnerName: document.getElementById('player-name-input').value.trim() || 'Runner',
        hunterName: 'Hunters'
      });
    }
  });

  // --- LIVE TACTICAL CHAT & INLINE PHOTO UPLOAD ---
  const chatDrawer = document.getElementById('chat-drawer');
  const chatStream = document.getElementById('chat-stream');
  const chatMessageInput = document.getElementById('chat-message-input');
  const chatPhotoFileInput = document.getElementById('chat-photo-file-input');
  const chatPhotoPreviewBar = document.getElementById('chat-photo-preview-bar');
  const chatPreviewThumbnail = document.getElementById('chat-preview-thumbnail');
  const chatUnreadBadge = document.getElementById('chat-unread-badge');

  // Toggle Chat Drawer
  document.getElementById('btn-open-chat')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    isChatOpen = true;
    chatDrawer?.classList.add('open');
    unreadChatCount = 0;
    if (chatUnreadBadge) chatUnreadBadge.style.display = 'none';
    chatStream.scrollTop = chatStream.scrollHeight;
  });

  document.getElementById('btn-close-chat')?.addEventListener('click', () => {
    isChatOpen = false;
    chatDrawer?.classList.remove('open');
  });

  // Attach Photo Click
  document.getElementById('btn-attach-photo')?.addEventListener('click', () => {
    chatPhotoFileInput?.click();
  });

  // Photo Selected & Compressed via Canvas
  chatPhotoFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Client-side canvas compression down to max 800px width/height and 0.75 JPEG
        const maxDim = 800;
        let width = img.width;
        let height = img.height;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        pendingChatPhoto = canvas.toDataURL('image/jpeg', 0.75);

        // Display preview bar
        if (chatPreviewThumbnail) chatPreviewThumbnail.src = pendingChatPhoto;
        if (chatPhotoPreviewBar) chatPhotoPreviewBar.style.display = 'flex';
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  // Remove pending photo
  document.getElementById('btn-remove-photo')?.addEventListener('click', () => {
    pendingChatPhoto = null;
    if (chatPhotoPreviewBar) chatPhotoPreviewBar.style.display = 'none';
    if (chatPhotoFileInput) chatPhotoFileInput.value = '';
  });

  // Send Chat Message
  function sendCurrentChat() {
    const text = chatMessageInput ? chatMessageInput.value.trim() : '';
    if (!text && !pendingChatPhoto) return;

    const playerName = document.getElementById('player-name-input').value.trim() || 'Operative';
    const messagePayload = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      senderId: myPlayerId,
      senderName: playerName,
      role: myAssignedRole || currentRole,
      text: text,
      photoUrl: pendingChatPhoto || null,
      timestamp: Date.now()
    };

    // 1. Send to server via WS
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'SEND_CHAT', ...messagePayload }));
    }

    // 2. Broadcast via Supabase
    if (window.supabaseGameManager) {
      window.supabaseGameManager.sendChatMessage(messagePayload);
    }

    // Render locally immediately
    receiveChatMessage(messagePayload);

    // Reset inputs
    if (chatMessageInput) chatMessageInput.value = '';
    pendingChatPhoto = null;
    if (chatPhotoPreviewBar) chatPhotoPreviewBar.style.display = 'none';
    if (chatPhotoFileInput) chatPhotoFileInput.value = '';
  }

  document.getElementById('btn-send-chat')?.addEventListener('click', sendCurrentChat);
  chatMessageInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendCurrentChat();
    }
  });

  // Receive Chat Message
  function receiveChatMessage(msg) {
    if (!chatStream) return;

    // Check if duplicate
    const existing = document.getElementById(msg.id);
    if (existing) return;

    const isMe = msg.senderId === myPlayerId;
    const msgEl = document.createElement('div');
    msgEl.id = msg.id;
    msgEl.className = `chat-msg ${isMe ? 'outgoing' : 'incoming'}`;

    const roleClass = msg.role === 'hunter' ? 'chat-badge-hunter' : (msg.role === 'runner' ? 'chat-badge-runner' : '');
    const timeFormatted = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let photoHtml = '';
    if (msg.photoUrl) {
      photoHtml = `<div class="chat-photo-wrapper"><img src="${msg.photoUrl}" alt="Intel Photo" class="chat-attached-photo" onclick="window.viewPhotoLightbox('${msg.photoUrl}')"></div>`;
    }

    msgEl.innerHTML = `
      <div class="chat-msg-header">
        <span class="chat-sender-badge ${roleClass}">${escapeHtml(msg.senderName)}</span>
        <span class="chat-time">${timeFormatted}</span>
      </div>
      ${msg.text ? `<div class="chat-msg-text">${escapeHtml(msg.text)}</div>` : ''}
      ${photoHtml}
    `;

    chatStream.appendChild(msgEl);
    chatStream.scrollTop = chatStream.scrollHeight;

    if (!isChatOpen && !isMe) {
      unreadChatCount++;
      if (chatUnreadBadge) {
        chatUnreadBadge.textContent = unreadChatCount;
        chatUnreadBadge.style.display = 'flex';
      }
      window.soundEngine?.playClick();
    }
  }

  // Lightbox Viewer
  window.viewPhotoLightbox = (url) => {
    const modal = document.getElementById('photo-lightbox-modal');
    const img = document.getElementById('lightbox-full-img');
    if (modal && img) {
      img.src = url;
      modal.classList.add('active');
    }
  };

  document.getElementById('btn-close-lightbox')?.addEventListener('click', () => {
    document.getElementById('photo-lightbox-modal')?.classList.remove('active');
  });

  document.getElementById('photo-lightbox-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'photo-lightbox-modal') {
      document.getElementById('photo-lightbox-modal').classList.remove('active');
    }
  });

  // =========================================================
  // INTERACTIVE ASCII TACTICAL RADAR & CRT TERMINAL ENGINE
  // =========================================================
  let asciiSweepAngle = 0;
  let asciiRadarInterval = null;
  let asciiRunnerInterval = null;
  let asciiShockwaveRadius = -1; // -1 means inactive
  let isAsciiModalOpen = false;
  let sprintBoostFrames = 0;

  // Multi-frame ASCII Runner Animation
  const asciiRunnerFrames = [
    [
      "        __O      >> RUN FOR YOUR LIFE >>",
      "       / /\\_,    ZONE: PERIMETER SECURE",
      "     _/\\/_       STATUS: HUNTER IN PURSUIT",
      "        /  \\     RADAR: 360° SATELLITE ACTIVE"
    ].join("\n"),
    [
      "         _O      >> RUN FOR YOUR LIFE >>",
      "       /\\_/\\     ZONE: PERIMETER SECURE",
      "      /  \\       STATUS: ACCELERATING SPRINT",
      "        _/\\_     RADAR: 360° SATELLITE ACTIVE"
    ].join("\n"),
    [
      "         O__     >> RUN FOR YOUR LIFE >>",
      "        /  /\\_   ZONE: PERIMETER SECURE",
      "       /  /  \\   STATUS: EVADING ENEMY SONAR",
      "      / _/    \\  RADAR: 360° SATELLITE ACTIVE"
    ].join("\n"),
    [
      "          o      >> RUN FOR YOUR LIFE >>",
      "        </ \\>    ZONE: PERIMETER SECURE",
      "        /   \\    STATUS: PING BURST DETECTED",
      "       _>   <_   RADAR: 360° SATELLITE ACTIVE"
    ].join("\n")
  ];

  let currentRunnerFrameIdx = 0;
  function updateAsciiRunner() {
    currentRunnerFrameIdx = (currentRunnerFrameIdx + 1) % asciiRunnerFrames.length;
    const bannerEl = document.getElementById('ascii-runner-banner');
    const landingEl = document.getElementById('landing-ascii-runner');
    const frame = asciiRunnerFrames[currentRunnerFrameIdx];

    if (bannerEl) bannerEl.textContent = frame;
    if (landingEl) landingEl.textContent = frame;

    if (sprintBoostFrames > 0) {
      sprintBoostFrames--;
    }
  }

  // Generate 19x19 ASCII Circular Radar Grid
  function renderAsciiRadar() {
    const radarEl = document.getElementById('ascii-radar-display');
    if (!radarEl) return;

    const size = 19;
    const center = Math.floor(size / 2); // 9
    const maxRadius = center - 0.5; // ~8.5

    // Initialize blank grid
    const grid = [];
    for (let r = 0; r < size; r++) {
      grid[r] = [];
      for (let c = 0; c < size; c++) {
        grid[r][c] = ' ';
      }
    }

    // Draw range rings
    const ringRadii = [3, 6, 8.5];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const dx = c - center;
        const dy = (r - center) * 1.0;
        const dist = Math.sqrt(dx * dx + dy * dy);

        for (const radius of ringRadii) {
          if (Math.abs(dist - radius) < 0.5) {
            grid[r][c] = (radius === 8.5) ? '·' : '.';
          }
        }

        // Crosshairs
        if (dist <= maxRadius) {
          if (r === center && Math.abs(c - center) % 3 === 0 && grid[r][c] === ' ') grid[r][c] = '-';
          if (c === center && Math.abs(r - center) % 2 === 0 && grid[r][c] === ' ') grid[r][c] = '|';
        }
      }
    }

    // Draw rotating sweep ray
    const sweepRad = (asciiSweepAngle * Math.PI) / 180;
    const sweepRayLength = 8.5;
    for (let d = 1; d <= sweepRayLength; d += 0.8) {
      const sx = Math.round(center + Math.cos(sweepRad) * d);
      const sy = Math.round(center + Math.sin(sweepRad) * d);
      if (sx >= 0 && sx < size && sy >= 0 && sy < size) {
        const modDeg = ((asciiSweepAngle % 180) + 180) % 180;
        let beamChar = '*';
        if (modDeg >= 25 && modDeg < 65) beamChar = '\\';
        else if (modDeg >= 65 && modDeg < 115) beamChar = '|';
        else if (modDeg >= 115 && modDeg < 155) beamChar = '/';
        else beamChar = '-';

        grid[sy][sx] = beamChar;
      }
    }

    // Draw expanding sonar shockwave if active
    if (asciiShockwaveRadius >= 0 && asciiShockwaveRadius <= 9) {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const dx = c - center;
          const dy = r - center;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (Math.abs(dist - asciiShockwaveRadius) < 0.6) {
            grid[r][c] = '~';
          }
        }
      }
      asciiShockwaveRadius += 0.7;
      if (asciiShockwaveRadius > 9) asciiShockwaveRadius = -1;
    }

    // Plot other operatives from active room
    let targetsInRange = 0;
    const players = currentRoomData?.players || [];
    players.forEach((p) => {
      if (p.id === myPlayerId) return;
      if (p.lat && p.lng) {
        const dLat = (p.lat - myPosition.lat) * 111000;
        const dLng = (p.lng - myPosition.lng) * 111000 * Math.cos((myPosition.lat * Math.PI) / 180);
        const distMeters = Math.hypot(dLat, dLng);
        const maxDisplayMeters = currentRoomData?.config?.arena?.radius || 300;

        if (distMeters <= maxDisplayMeters) {
          targetsInRange++;
          const normDist = (distMeters / maxDisplayMeters) * (center - 1);
          const angle = Math.atan2(dLat, dLng);
          const tx = Math.round(center + Math.cos(angle) * normDist);
          const ty = Math.round(center - Math.sin(angle) * normDist);
          if (tx >= 0 && tx < size && ty >= 0 && ty < size) {
            grid[ty][tx] = p.assignedRole === 'hunter' ? '▲' : '●';
          }
        }
      }
    });

    if (targetsInRange === 0) {
      targetsInRange = 1;
      grid[center - 3][center + 4] = '●';
      grid[center + 2][center - 3] = '▲';
    }

    // Center player
    grid[center][center] = '@';

    // Format grid to text
    const textLines = grid.map((row) => row.join(' ')).join('\n');
    radarEl.textContent = textLines;

    // Update Telemetry Panel
    const opNameEl = document.getElementById('ascii-op-name');
    const opRoleEl = document.getElementById('ascii-op-role');
    const opCoordsEl = document.getElementById('ascii-op-coords');
    const sweepDegEl = document.getElementById('ascii-radar-sweep-deg');
    const targetsCountEl = document.getElementById('ascii-targets-count');

    if (opNameEl) opNameEl.textContent = (document.getElementById('player-name-input')?.value.trim() || 'GHOST').toUpperCase();
    if (opRoleEl) opRoleEl.textContent = (myAssignedRole || currentRole || 'OPERATIVE').toUpperCase();
    if (opCoordsEl) opCoordsEl.textContent = `${myPosition.lat.toFixed(4)}° N, ${Math.abs(myPosition.lng).toFixed(4)}° W`;
    if (sweepDegEl) sweepDegEl.textContent = `${Math.floor(asciiSweepAngle)}°`;
    if (targetsCountEl) targetsCountEl.textContent = `${targetsInRange} TARGETS IN ARENA`;

    // Increment sweep angle
    asciiSweepAngle = (asciiSweepAngle + 12) % 360;
  }

  // Interactive Terminal Command Interpreter
  function executeAsciiCommand(cmdStr) {
    const raw = cmdStr.trim().toLowerCase();
    if (!raw) return;

    logAscii(`> ${cmdStr}`, 'cmd');
    window.soundEngine?.playClick();

    if (raw === 'help') {
      logAscii('AVAILABLE TACTICAL COMMANDS:');
      logAscii('  scan   - 360° radar sweep & calculate target ranges in meters');
      logAscii('  ping   - Emit high-frequency microwave sonar shockwave');
      logAscii('  sprint - Trigger 3x operative adrenaline sprint animation');
      logAscii('  status - Print live satellite telemetry & room credentials');
      logAscii('  matrix - Toggle digital rain telemetry mode');
      logAscii('  clear  - Clear terminal screen log');
    } else if (raw === 'scan') {
      logAscii('[SCAN] Initiating 360° microwave phased-array sweep...', 'sys');
      window.soundEngine?.playPing();
      asciiShockwaveRadius = 0;

      const players = currentRoomData?.players || [];
      const others = players.filter((p) => p.id !== myPlayerId);

      if (others.length === 0) {
        logAscii('  > TARGET [RUNNER-01]: 142m BEARING 054° NE [ECHO RETURN STRONG]');
        logAscii('  > TARGET [HUNTER-02]: 86m  BEARING 220° SW [VELOCITY: 3.4 m/s]');
      } else {
        others.forEach((p) => {
          if (p.lat && p.lng) {
            const dist = Math.round(haversine(myPosition.lat, myPosition.lng, p.lat, p.lng));
            const role = (p.assignedRole || p.rolePreference || 'unknown').toUpperCase();
            logAscii(`  > ${p.name.toUpperCase()} (${role}): ${dist}m away [TRACKED]`);
          } else {
            logAscii(`  > ${p.name.toUpperCase()}: Signal acquired, triangulating GPS...`);
          }
        });
      }
    } else if (raw === 'ping') {
      logAscii('[SONAR] Sonar burst emitted. Sweeping all operatives in zone.', 'sys');
      window.soundEngine?.playPing();
      asciiShockwaveRadius = 0;
    } else if (raw === 'sprint') {
      sprintBoostFrames = 25;
      logAscii('[SPRINT] Adrenaline overdrive activated! Sprite speed: 300%.', 'sys');
      window.soundEngine?.playHeartbeat?.(true);
    } else if (raw === 'status') {
      const room = myRoomCode || 'OFFLINE';
      const name = document.getElementById('player-name-input')?.value.trim() || 'Operative';
      const role = (myAssignedRole || currentRole).toUpperCase();
      logAscii(`[TELEMETRY] ROOM: ${room} | OPERATIVE: ${name.toUpperCase()} | ROLE: ${role}`);
      logAscii(`[GPS] LAT: ${myPosition.lat.toFixed(6)} | LNG: ${myPosition.lng.toFixed(6)} | SATELLITES: 12 LOCK`);
      logAscii(`[BUFFER] 90s DISCONNECT GRACE PERIOD: ARMED & READY`);
    } else if (raw === 'clear') {
      const logEl = document.getElementById('ascii-terminal-log');
      if (logEl) logEl.innerHTML = '<div class="log-line sys">-- TERMINAL SCREEN CLEARED --</div>';
    } else if (raw === 'matrix') {
      logAscii('01010010 01010101 01001110 00100000 01000110 01001111 01010010', 'sys');
      logAscii('01011001 01001111 01010101 01010010 00100000 01001100 01001001', 'sys');
      logAscii('RUN FOR YOUR LIFE // SYSTEM MATRIX ONLINE', 'sys');
    } else if (raw === 'rules') {
      logAscii('[RULES] Opening official tactical rulebook...', 'sys');
      openTutorialModal('rules');
    } else if (raw === 'tutorial') {
      logAscii('[TUTORIAL] Launching animated tactical visualizer...', 'sys');
      openTutorialModal('tutorial');
    } else {
      logAscii(`[ERROR] Unknown command: "${raw}". Type "help" for tactical commands.`, 'err');
    }
  }

  function logAscii(text, type = 'log') {
    const logEl = document.getElementById('ascii-terminal-log');
    if (!logEl) return;
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.textContent = text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // Open & Close ASCII Terminal Modal
  function openAsciiTerminal() {
    window.soundEngine?.playClick();
    isAsciiModalOpen = true;
    const modal = document.getElementById('ascii-terminal-modal');
    if (modal) modal.classList.add('active');

    if (!asciiRadarInterval) {
      asciiRadarInterval = setInterval(renderAsciiRadar, 70);
    }
    const input = document.getElementById('ascii-cmd-input');
    if (input) setTimeout(() => input.focus(), 150);
  }

  function closeAsciiTerminal() {
    isAsciiModalOpen = false;
    const modal = document.getElementById('ascii-terminal-modal');
    if (modal) modal.classList.remove('active');
  }

  // Event Listeners for ASCII Terminal
  document.getElementById('btn-open-ascii-terminal')?.addEventListener('click', openAsciiTerminal);
  document.getElementById('btn-hud-ascii')?.addEventListener('click', openAsciiTerminal);
  document.getElementById('ascii-hero-widget')?.addEventListener('click', openAsciiTerminal);
  document.getElementById('btn-close-ascii')?.addEventListener('click', closeAsciiTerminal);

  document.getElementById('ascii-terminal-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'ascii-terminal-modal') closeAsciiTerminal();
  });

  // ASCII Command Input
  const asciiInput = document.getElementById('ascii-cmd-input');
  const asciiExecBtn = document.getElementById('btn-exec-ascii-cmd');

  function handleAsciiInputSubmit() {
    if (!asciiInput) return;
    const val = asciiInput.value;
    if (val.trim()) {
      executeAsciiCommand(val);
      asciiInput.value = '';
    }
  }

  if (asciiExecBtn) asciiExecBtn.addEventListener('click', handleAsciiInputSubmit);
  if (asciiInput) {
    asciiInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAsciiInputSubmit();
    });
  }

  // Quick Action Chips
  document.querySelectorAll('.ascii-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cmd = chip.dataset.cmd;
      if (cmd) executeAsciiCommand(cmd);
    });
  });

  // Start ASCII Runner Loop (Runs continuously for landing widget and modal)
  asciiRunnerInterval = setInterval(updateAsciiRunner, 190);
  renderAsciiRadar();

  // =========================================================
  // INTERACTIVE ANIMATED TUTORIAL & OFFICIAL RULEBOOK
  // =========================================================
  let currentTutorialStep = 0;
  const totalTutorialSteps = 5;

  function openTutorialModal(initialTab = 'tutorial') {
    window.soundEngine?.playClick();
    const modal = document.getElementById('tutorial-modal');
    if (!modal) return;
    modal.classList.add('active');

    if (initialTab === 'rules') {
      switchTutorialTab('rules');
    } else {
      switchTutorialTab('tutorial');
    }
  }

  function closeTutorialModal() {
    const modal = document.getElementById('tutorial-modal');
    if (modal) modal.classList.remove('active');
  }

  function switchTutorialTab(tabName) {
    window.soundEngine?.playClick();
    const btnTut = document.getElementById('tab-btn-tutorial');
    const btnRules = document.getElementById('tab-btn-rules');
    const bodyTut = document.getElementById('tutorial-content-walkthrough');
    const bodyRules = document.getElementById('tutorial-content-rules');

    if (tabName === 'tutorial') {
      btnTut?.classList.add('active');
      btnRules?.classList.remove('active');
      bodyTut?.classList.add('active');
      bodyRules?.classList.remove('active');
    } else {
      btnTut?.classList.remove('active');
      btnRules?.classList.add('active');
      bodyTut?.classList.remove('active');
      bodyRules?.classList.add('active');
    }
  }

  function goToTutorialStep(stepIndex) {
    if (stepIndex < 0 || stepIndex >= totalTutorialSteps) return;
    window.soundEngine?.playClick();
    currentTutorialStep = stepIndex;

    // Update active stage slide
    document.querySelectorAll('.tutorial-stage').forEach((st, idx) => {
      st.classList.toggle('active', idx === currentTutorialStep);
    });

    // Update step chips
    document.querySelectorAll('.step-chip').forEach((chip) => {
      const chipStep = parseInt(chip.dataset.step, 10);
      chip.classList.toggle('active', chipStep === currentTutorialStep);
    });

    // Update dots
    document.querySelectorAll('.t-dot').forEach((dot) => {
      const dotStep = parseInt(dot.dataset.step, 10);
      dot.classList.toggle('active', dotStep === currentTutorialStep);
    });

    // Update Next/Finish button text
    const nextBtn = document.getElementById('btn-tutorial-next');
    if (nextBtn) {
      nextBtn.textContent = (currentTutorialStep === totalTutorialSteps - 1) ? 'Finish ✓' : 'Next →';
    }
  }

  // Tutorial open/close listeners
  document.getElementById('btn-open-tutorial')?.addEventListener('click', () => openTutorialModal('tutorial'));
  document.getElementById('btn-open-tutorial-card')?.addEventListener('click', () => openTutorialModal('tutorial'));
  document.getElementById('btn-hud-help')?.addEventListener('click', () => openTutorialModal('tutorial'));
  document.getElementById('btn-close-tutorial')?.addEventListener('click', closeTutorialModal);

  document.getElementById('tutorial-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'tutorial-modal') closeTutorialModal();
  });

  // Tab buttons
  document.getElementById('tab-btn-tutorial')?.addEventListener('click', () => switchTutorialTab('tutorial'));
  document.getElementById('tab-btn-rules')?.addEventListener('click', () => switchTutorialTab('rules'));

  // Step chips
  document.querySelectorAll('.step-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const step = parseInt(chip.dataset.step, 10);
      goToTutorialStep(step);
    });
  });

  // Dots
  document.querySelectorAll('.t-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      const step = parseInt(dot.dataset.step, 10);
      goToTutorialStep(step);
    });
  });

  // Prev / Next buttons
  document.getElementById('btn-tutorial-prev')?.addEventListener('click', () => {
    if (currentTutorialStep > 0) {
      goToTutorialStep(currentTutorialStep - 1);
    }
  });

  document.getElementById('btn-tutorial-next')?.addEventListener('click', () => {
    if (currentTutorialStep < totalTutorialSteps - 1) {
      goToTutorialStep(currentTutorialStep + 1);
    } else {
      closeTutorialModal();
    }
  });

  // Interactive Stage Simulators
  document.getElementById('btn-sim-breach')?.addEventListener('click', () => {
    window.soundEngine?.playHeartbeat?.(true);
    const alertEl = document.getElementById('boundary-alert');
    if (alertEl) {
      alertEl.style.borderColor = 'var(--crimson)';
      alertEl.style.display = 'block';
      setTimeout(() => (alertEl.style.display = 'none'), 1500);
    }
  });

  let simIsDuel = true;
  document.getElementById('btn-sim-duel-toggle')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    simIsDuel = !simIsDuel;
    const badge = document.querySelector('.anim-vs-badge');
    const runnerCardP = document.querySelector('.anim-role-card.runner p');
    if (badge && runnerCardP) {
      badge.textContent = simIsDuel ? 'VS' : '2v4';
      runnerCardP.textContent = simIsDuel ? '1v1 Duel Mode' : 'Multiplayer Squad';
    }
  });

  document.getElementById('btn-sim-heartbeat')?.addEventListener('click', () => {
    window.soundEngine?.playHeartbeat?.(true);
  });

  document.getElementById('btn-sim-sonar-ping')?.addEventListener('click', () => {
    window.soundEngine?.playPing();
    const blip = document.querySelector('.anim-ping-blip');
    if (blip) {
      blip.style.transform = 'scale(1.4)';
      setTimeout(() => (blip.style.transform = 'scale(1)'), 400);
    }
  });

  document.getElementById('btn-sim-tag-alert')?.addEventListener('click', () => {
    window.soundEngine?.playFanfare();
  });

  // Utilities
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
