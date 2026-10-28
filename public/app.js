// RUN FOR YOUR LIFE: WebApp Client
// Designed and developed by Shopifydevstudio

(() => {
  'use strict';

  // Force portrait orientation lock across browsers and native webview
  try {
    if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
      window.screen.orientation.lock('portrait').catch(() => {});
    }
  } catch (e) {}

  // State
  let ws = null;
  // Use sessionStorage so multiple tabs in the same browser have independent player sessions
  let myPlayerId = sessionStorage.getItem('RFYL_ACTIVE_PLAYER_ID');
  if (!myPlayerId) {
    myPlayerId = 'p_' + Math.random().toString(36).substring(2, 9);
    sessionStorage.setItem('RFYL_ACTIVE_PLAYER_ID', myPlayerId);
  }

  let myRoomCode = sessionStorage.getItem('RFYL_ACTIVE_ROOM') || null;
  let isHost = false;
  let currentRole = 'random';
  let myAssignedRole = null; // 'hunter' | 'runner'
  let myPosition = { lat: 37.7749, lng: -122.4194 }; // Default San Francisco
  let myPath = [];
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
  let peerMarkers = new Map();
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
  let currentPhase = 'LOBBY';
  let lastProximityBeepTime = 0;
  let gpsPollInterval = null;

  // --- ZOMBIES SURVIVAL MECHANICS STATE ---
  let myBounties = 0;
  let myPowerups = [];
  let myActiveEffects = { cloaked: false, antiCloak: false, radarExtended: false, freshMeat: false };
  let myTagCode = 'TAG_' + Math.random().toString(36).substring(2, 8).toUpperCase();
  let zoneMarkers = new Map();
  let isInfectiousState = false;
  let infectCooldownRemaining = 0;
  let scannerStream = null;
  let screenWakeLock = null;
  let userIsDraggingMap = false;
  let userDragTimeout = null;
  let clientOobState = {
    active: false,
    remainingSeconds: 60,
    intervalId: null
  };

  const CLIENT_POWERUP_CATALOG = {
    CLOAK: { id: 'CLOAK', name: 'Cloak', cost: 25, role: 'survivor', durationSeconds: 30, desc: 'Stealth: Invisible from radar & immune to proximity burst for 30s.' },
    CLOAK_PLUS: { id: 'CLOAK_PLUS', name: 'Cloak+', cost: 45, role: 'survivor', durationSeconds: 60, desc: 'Extended stealth for 60s.' },
    ANTI_CLOAK: { id: 'ANTI_CLOAK', name: 'Anti-Cloak', cost: 30, role: 'both', durationSeconds: 30, desc: 'Sensor: Reveals cloaked players on radar within 100m.' },
    RADAR_EXTEND: { id: 'RADAR_EXTEND', name: 'Radar Extend', cost: 20, role: 'both', durationSeconds: 45, desc: 'Expands radar range by 1.5x.' },
    RADAR_EXTEND_PLUS: { id: 'RADAR_EXTEND_PLUS', name: 'Radar Extend+', cost: 35, role: 'both', durationSeconds: 60, desc: 'Expands radar range by 2.5x.' },
    FRESH_MEAT: { id: 'FRESH_MEAT', name: 'Fresh Meat', cost: 25, role: 'zombie', durationSeconds: 30, desc: 'Scent Trail: Pings bearing & distance to closest living survivor.' }
  };

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
      if (joinInput) {
        joinInput.value = roomParam.toUpperCase();
        updateCodeDigits(roomParam);
      }
      showScreen('join');
    }
  }

  // --- JOIN CODE VISUAL DIGITS SYNC ---
  const joinCodeInput = document.getElementById('join-code-input');
  const codeDigits = document.querySelectorAll('#join-code-container .code-digit');
  function updateCodeDigits(val) {
    const clean = (val || '').toUpperCase().slice(0, 6);
    codeDigits.forEach((digit, idx) => {
      if (idx < clean.length) {
        digit.textContent = clean[idx];
        digit.classList.add('filled');
      } else {
        digit.textContent = '';
        digit.classList.remove('filled');
      }
    });
  }
  if (joinCodeInput) {
    joinCodeInput.addEventListener('input', (e) => {
      updateCodeDigits(e.target.value);
    });
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
  const joinNameInput = document.getElementById('join-player-name-input');
  const nameWarning = document.getElementById('name-validation-msg');

  // Load saved name if any
  const savedPlayerName = sessionStorage.getItem('RFYL_PLAYER_NAME') || localStorage.getItem('RFYL_PLAYER_NAME');
  if (savedPlayerName) {
    if (nameInput) nameInput.value = savedPlayerName;
    if (joinNameInput) joinNameInput.value = savedPlayerName;
  }

  function validatePlayerName() {
    const val = (nameInput ? nameInput.value.trim() : '') || (joinNameInput ? joinNameInput.value.trim() : '');
    if (!val) {
      if (nameWarning) {
        nameWarning.style.display = 'block';
        nameWarning.classList.add('shake');
        setTimeout(() => nameWarning.classList.remove('shake'), 600);
      }
      if (nameInput && screens.landing?.classList.contains('active')) {
        nameInput.focus();
        nameInput.classList.add('error-shake');
        setTimeout(() => nameInput.classList.remove('error-shake'), 600);
      }
      if (joinNameInput && screens.join?.classList.contains('active')) {
        joinNameInput.focus();
        joinNameInput.classList.add('error-shake');
        setTimeout(() => joinNameInput.classList.remove('error-shake'), 600);
      }
      window.soundEngine?.playHeartbeat?.();
      return null;
    }
    if (nameWarning) nameWarning.style.display = 'none';
    sessionStorage.setItem('RFYL_PLAYER_NAME', val);
    localStorage.setItem('RFYL_PLAYER_NAME', val);
    return val;
  }

  if (nameInput) {
    nameInput.addEventListener('input', () => {
      const val = nameInput.value.trim();
      if (joinNameInput && joinNameInput.value !== nameInput.value) {
        joinNameInput.value = nameInput.value;
      }
      if (val.length > 0) {
        if (nameWarning) nameWarning.style.display = 'none';
        sessionStorage.setItem('RFYL_PLAYER_NAME', val);
        localStorage.setItem('RFYL_PLAYER_NAME', val);
      }
    });
  }

  if (joinNameInput) {
    joinNameInput.addEventListener('input', () => {
      const val = joinNameInput.value.trim();
      if (nameInput && nameInput.value !== joinNameInput.value) {
        nameInput.value = joinNameInput.value;
      }
      if (val.length > 0) {
        if (nameWarning) nameWarning.style.display = 'none';
        sessionStorage.setItem('RFYL_PLAYER_NAME', val);
        localStorage.setItem('RFYL_PLAYER_NAME', val);
      }
    });
  }

  // --- INITIALIZE WEBSOCKET WITH 90s RECONNECT SUPPORT & MOBILE LAN FALLBACK ---
  let wsHostIdx = 0;
  function getWsCandidateUrl() {
    // If running in browser on Render or custom web host
    if (window.location.hostname && window.location.hostname.includes('onrender.com')) {
      return `wss://${window.location.host}`;
    }
    // If running in browser with explicit port (e.g. :3000), use that directly
    if (window.location.port && window.location.port !== '80' && window.location.port !== '443') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.host}`;
    }
    // When running inside Android Capacitor APK (or on 4G/5G mobile data), connect directly to Render Cloud
    const candidates = [
      'wss://run-for-your-life-y58o.onrender.com',
      'ws://192.168.0.212:3000',
      'ws://192.168.0.109:3000',
      'ws://localhost:3000'
    ];
    return candidates[wsHostIdx % candidates.length];
  }

  function initWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      const wsUrl = getWsCandidateUrl();
      console.log(`Connecting WebSocket to: ${wsUrl}`);
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log(`Connected to game server at ${wsUrl}`);

        // Check if we need to auto-reconnect to an active room for THIS tab
        const activeRoom = sessionStorage.getItem('RFYL_ACTIVE_ROOM');
        const activeName = sessionStorage.getItem('RFYL_PLAYER_NAME') || localStorage.getItem('RFYL_PLAYER_NAME');
        if (activeRoom && myPlayerId) {
          console.log(`Attempting reconnect to room ${activeRoom} as ${activeName || myPlayerId}`);
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

      ws.onerror = () => {
        wsHostIdx++;
      };

      ws.onclose = () => {
        // Retry connection in background with next candidate host if disconnected
        wsHostIdx++;
        setTimeout(initWebSocket, 3000);
      };
    } catch (e) {
      console.warn('WebSocket init exception, will retry:', e);
      wsHostIdx++;
      setTimeout(initWebSocket, 4000);
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
        sessionStorage.setItem('RFYL_ACTIVE_ROOM', myRoomCode);
        sessionStorage.setItem('RFYL_ACTIVE_PLAYER_ID', myPlayerId);

        currentRoomData = Object.assign(currentRoomData || {}, msg);
        if (msg.config) currentRoomConfig = Object.assign(currentRoomConfig, msg.config);
        currentPhase = msg.state || 'LOBBY';

        updateLobbyRoomCode(myRoomCode);
        document.getElementById('btn-start-game').style.display = 'block';
        document.getElementById('host-waiting-msg').style.display = 'none';
        showScreen('lobby');
        if (msg.players) {
          updateLobbyUI(msg);
        }
        if (msg.chatHistory && Array.isArray(msg.chatHistory)) {
          msg.chatHistory.forEach((c) => receiveChatMessage(c));
        }
        connectToSupabaseRoom(myRoomCode);
        break;

      case 'ROOM_JOINED':
      case 'RECONNECTED':
      case 'RECONNECT_SUCCESS':
        myPlayerId = msg.playerId || myPlayerId;
        myRoomCode = msg.roomCode;
        isHost = (msg.hostId && msg.hostId === myPlayerId) || false;
        sessionStorage.setItem('RFYL_ACTIVE_ROOM', myRoomCode);
        sessionStorage.setItem('RFYL_ACTIVE_PLAYER_ID', myPlayerId);

        currentRoomData = Object.assign(currentRoomData || {}, msg);
        if (msg.config) currentRoomConfig = Object.assign(currentRoomConfig, msg.config);
        currentPhase = msg.state || 'LOBBY';

        updateLobbyRoomCode(myRoomCode);
        if (isHost) {
          document.getElementById('btn-start-game').style.display = 'block';
          document.getElementById('host-waiting-msg').style.display = 'none';
        } else {
          document.getElementById('btn-start-game').style.display = 'none';
          document.getElementById('host-waiting-msg').style.display = 'block';
        }
        
        const activeState = msg.state || msg.roomState?.state;
        const isActiveGame = activeState === 'THE_HUNT' || activeState === 'HEAD_START' || activeState === 'EXTRACTION';

        if (isActiveGame) {
          currentRoomData = Object.assign(currentRoomData || {}, msg);
          if (msg.config) currentRoomConfig = Object.assign(currentRoomConfig, msg.config);
          myAssignedRole = msg.role || 'survivor';
          currentRole = myAssignedRole;
          handlePhaseChange(msg);
          startLocationTracking();
        } else {
          showScreen('lobby');
        }
        if (msg.players) {
          updateLobbyUI(msg);
        }
        if (msg.chatHistory && Array.isArray(msg.chatHistory)) {
          msg.chatHistory.forEach((c) => receiveChatMessage(c));
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

      case 'RADAR_UPDATE':
        handleRadarUpdate(msg);
        break;

      case 'ZOMBIE_INFECTION_TRIGGERED':
        handleZombieInfectionTriggered(msg);
        break;

      case 'ZOMBIE_INFECTION_EXPIRED':
        handleZombieInfectionExpired(msg);
        break;

      case 'CHASE_WARNING':
        handleChaseWarning(msg);
        break;

      case 'CHASE_ESCAPED':
        handleChaseEscaped(msg);
        break;

      case 'PLAYER_INFECTED':
        handlePlayerInfected(msg);
        break;

      case 'POWERUP_BOUGHT':
        handlePowerupBought(msg);
        break;

      case 'POWERUP_ACTIVATED':
        handlePowerupActivated(msg);
        break;

      case 'EXTRACTION_PHASE_STARTED':
        handleExtractionStarted(msg);
        break;

      case 'SURVIVOR_ESCAPED':
        handleSurvivorEscaped(msg);
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

      case 'WALKIE_TALKIE_RECEIVE':
        handleWalkieTalkieReceive(msg);
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
    const playerName = (document.getElementById('join-player-name-input')?.value.trim()) ||
                       (document.getElementById('player-name-input')?.value.trim()) ||
                       sessionStorage.getItem('RFYL_PLAYER_NAME') ||
                       'Operative';
    const myRole = myAssignedRole || currentRole || (isHost ? 'hunter' : 'runner');
    const player = {
      id: myPlayerId,
      name: playerName,
      rolePreference: myRole,
      assignedRole: myAssignedRole || myRole,
      role: myRole,
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

    if (!currentRoomData) currentRoomData = { players: [] };
    if (!currentRoomData.players) currentRoomData.players = [];

    const isHunter = myAssignedRole === 'hunter' || myAssignedRole === 'zombie' || currentRole === 'zombie';
    let role = payload.role;
    if (!role || role === 'random') {
      role = isHunter ? 'runner' : 'hunter';
    }

    const existing = currentRoomData.players.find((p) => p.id === payload.playerId);
    if (existing) {
      existing.assignedRole = role;
      existing.role = role;
      existing.name = payload.name || existing.name || 'Operative';
      existing.lat = payload.lat;
      existing.lng = payload.lng;
    } else {
      currentRoomData.players.push({
        id: payload.playerId,
        name: payload.name || 'Operative',
        assignedRole: role,
        role: role,
        rolePreference: role,
        lat: payload.lat,
        lng: payload.lng,
        isTagged: false
      });
    }
    updateRunnersAliveCount();

    if (Number.isFinite(payload.lat) && Number.isFinite(payload.lng)) {
      const myLat = myPosition?.lat;
      const myLng = myPosition?.lng;
      let dist = 0;
      let bearing = 0;
      if (Number.isFinite(myLat) && Number.isFinite(myLng)) {
        dist = Math.round(haversine(myLat, myLng, payload.lat, payload.lng));
      }
      const isTeammate = role === myAssignedRole;

      // In peer mode, show teammates anywhere, and opponents within 250m radar range
      if (isTeammate || dist <= 250) {
        updatePeerMapMarkers([{
          id: payload.playerId,
          name: payload.name || 'Operative',
          role: role,
          lat: payload.lat,
          lng: payload.lng,
          dist,
          bearing,
          isTeammate,
          isInfectious: Boolean(payload.isInfectious)
        }], false);
      }
    }
  }

  function updateLobbyWithPresence(presencePlayers) {
    // If WebSocket is open and connected to server, WebSocket is authoritative for room roster
    if (ws && ws.readyState === WebSocket.OPEN) {
      return;
    }

    const formattedPlayers = presencePlayers.map((p) => {
      let role = p.assignedRole || p.role;
      if (!role || role === 'random') {
        if (p.rolePreference && p.rolePreference !== 'random') {
          role = p.rolePreference;
        } else if (p.id === myPlayerId) {
          role = (myAssignedRole === 'hunter' || myAssignedRole === 'zombie' || currentRole === 'zombie') ? 'hunter' : 'runner';
        } else {
          const amHunter = (myAssignedRole === 'hunter' || myAssignedRole === 'zombie' || currentRole === 'zombie');
          role = amHunter ? 'runner' : 'hunter';
        }
      }
      return {
        id: p.id,
        name: p.name,
        rolePreference: role || 'runner',
        assignedRole: role || 'runner',
        role: role || 'runner',
        connected: true,
        isTagged: p.isTagged || false
      };
    });
    cachedLobbyPlayers = formattedPlayers;

    // Always sync into currentRoomData.players
    if (!currentRoomData) currentRoomData = { players: [] };
    if (!currentRoomData.players) currentRoomData.players = [];

    formattedPlayers.forEach((fp) => {
      const existing = currentRoomData.players.find((p) => p.id === fp.id);
      if (existing) {
        Object.assign(existing, fp);
      } else {
        currentRoomData.players.push(fp);
      }
    });

    if (!currentRoomData?.state || currentRoomData.state === 'LOBBY') {
      updateLobbyUI({ players: currentRoomData.players });
    }

    // Always recompute runners alive count on presence change
    updateRunnersAliveCount();
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

    if (window.AndroidNative?.requestLocationPermission) {
      window.AndroidNative.requestLocationPermission();
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          hasLocationPermission = true;
          myPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const gpsLabel = document.getElementById('gps-btn-label');
          if (gpsLabel) gpsLabel.textContent = 'GPS';
          refreshHardwareStatus();

          if (setupMap) setupMap.setView([myPosition.lat, myPosition.lng], 16);
          if (pendingActionAfterPermission) {
            pendingActionAfterPermission();
            pendingActionAfterPermission = null;
          }
        },
        (err) => {
          console.warn('GPS permission denied or unavailable:', err);
          hasLocationPermission = true;
          const gpsLabel = document.getElementById('gps-btn-label');
          if (gpsLabel) gpsLabel.textContent = 'GPS';
          refreshHardwareStatus();
          if (pendingActionAfterPermission) {
            pendingActionAfterPermission();
            pendingActionAfterPermission = null;
          }
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      hasLocationPermission = true;
      refreshHardwareStatus();
      if (pendingActionAfterPermission) pendingActionAfterPermission();
    }
  });

  document.getElementById('btn-deny-gps')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    document.getElementById('location-permission-modal')?.classList.remove('active');
    hasLocationPermission = true;
    const gpsLabel = document.getElementById('gps-btn-label');
    if (gpsLabel) gpsLabel.textContent = 'GPS';
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

  document.getElementById('sound-btn')?.addEventListener('click', () => {
    window.soundEngine.muted = !window.soundEngine.muted;
    updateSoundBtnVisual();
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
    if (setupMap) {
      if (myPosition && (myPosition.lat !== 37.7749 || myPosition.lng !== -122.4194)) {
        setupMap.setView([myPosition.lat, myPosition.lng], 16);
        if (setupCircle) setupCircle.setLatLng([myPosition.lat, myPosition.lng]);
      }
      return;
    }

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

    // Request immediate GPS fix to snap arena geofence to host's real location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          myPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (setupMap) {
            setupMap.setView([myPosition.lat, myPosition.lng], 16);
            if (setupCircle) setupCircle.setLatLng([myPosition.lat, myPosition.lng]);
          }
        },
        (err) => console.warn('GPS initial fix notice:', err),
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
      );
    }

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

  // --- CREATE ROOM (WITH STARTING ZOMBIES COUNT) ---
  const setupZombiesSlider = document.getElementById('setup-zombies-slider');
  const setupZombiesDisplay = document.getElementById('setup-zombies-display');
  if (setupZombiesSlider && setupZombiesDisplay) {
    setupZombiesSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      setupZombiesDisplay.textContent = `${val} ${val === 1 ? 'Zombie' : 'Zombies'}`;
    });
  }

  document.getElementById('btn-confirm-create-room').addEventListener('click', () => {
    window.soundEngine?.playClick();
    const name = validatePlayerName() || 'Operative One';
    let center = setupMap ? setupMap.getCenter() : myPosition;
    if (center.lat === 37.7749 && center.lng === -122.4194 && (myPosition.lat !== 37.7749 || myPosition.lng !== -122.4194)) {
      center = myPosition;
    }
    const radius = parseInt(document.getElementById('radius-slider').value, 10);
    const roundLength = parseInt(document.getElementById('round-length-select').value, 10);
    const startingZombiesCount = parseInt(document.getElementById('setup-zombies-slider')?.value || '1', 10);

    const arena = { lat: center.lat, lng: center.lng, radius };

    currentRoomConfig = {
      arena,
      roundLength,
      startingZombiesCount,
      headStart: 180
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'CREATE_ROOM',
          name,
          arena,
          roundLength,
          startingZombiesCount,
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
  document.getElementById('btn-confirm-join').addEventListener('click', async () => {
    window.soundEngine?.playClick();
    const joinNameEl = document.getElementById('join-player-name-input');
    const landingNameEl = document.getElementById('player-name-input');
    let name = (joinNameEl ? joinNameEl.value.trim() : '') ||
               (landingNameEl ? landingNameEl.value.trim() : '') ||
               sessionStorage.getItem('RFYL_PLAYER_NAME') ||
               localStorage.getItem('RFYL_PLAYER_NAME') ||
               'Operative ' + Math.floor(Math.random() * 90 + 10);

    sessionStorage.setItem('RFYL_PLAYER_NAME', name);
    localStorage.setItem('RFYL_PLAYER_NAME', name);

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
          playerId: myPlayerId,
          name,
          rolePreference: currentRole
        })
      );
    } else {
      // Query room state from Supabase database if available
      const dbRoom = await window.supabaseGameManager.getRoomFromDb(code);
      if (dbRoom) {
        currentRoomData = Object.assign(currentRoomData || {}, dbRoom);
        if (dbRoom.config) currentRoomConfig = Object.assign(currentRoomConfig, dbRoom.config);
      }

      handleServerMessage({
        type: 'ROOM_JOINED',
        roomCode: code,
        playerId: myPlayerId,
        roomState: dbRoom
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

  // --- INITIAL ZOMBIES STEPPER & 100% RANDOM ROLE ASSIGNMENT ---
  let lobbyStartingZombies = 1;

  function updateLobbyZombiesDisplay() {
    const valEl = document.getElementById('lobby-zombies-count-val');
    const highlightEl = document.getElementById('zombies-count-text-highlight');
    const guestValEl = document.getElementById('guest-zombies-val');
    const ratioEl = document.getElementById('zombies-ratio-preview');

    if (valEl) valEl.textContent = lobbyStartingZombies;
    if (highlightEl) {
      highlightEl.textContent = `${lobbyStartingZombies} operative${lobbyStartingZombies > 1 ? 's' : ''}`;
    }
    if (guestValEl) guestValEl.textContent = lobbyStartingZombies;

    const totalPlayers = currentRoomData?.players?.length || (cachedLobbyPlayers ? cachedLobbyPlayers.length : 1);
    const survivors = Math.max(0, totalPlayers - lobbyStartingZombies);
    if (ratioEl) {
      ratioEl.textContent = `🎲 ${lobbyStartingZombies} Zombie${lobbyStartingZombies > 1 ? 's' : ''} • ${survivors} Survivor${survivors !== 1 ? 's' : ''}`;
    }
  }

  document.getElementById('btn-zombies-minus')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    if (lobbyStartingZombies > 1) {
      lobbyStartingZombies--;
      updateLobbyZombiesDisplay();
      if (ws && ws.readyState === WebSocket.OPEN && isHost) {
        ws.send(JSON.stringify({ type: 'UPDATE_CONFIG', startingZombiesCount: lobbyStartingZombies }));
      }
    }
  });

  document.getElementById('btn-zombies-plus')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    if (lobbyStartingZombies < 10) {
      lobbyStartingZombies++;
      updateLobbyZombiesDisplay();
      if (ws && ws.readyState === WebSocket.OPEN && isHost) {
        ws.send(JSON.stringify({ type: 'UPDATE_CONFIG', startingZombiesCount: lobbyStartingZombies }));
      }
    }
  });

  // --- 100% RANDOM ROLE ASSIGNMENT ALGORITHM ---
  function assignRolesForPlayers(players) {
    if (!players || players.length === 0) return;

    const targetZombies = Math.max(1, lobbyStartingZombies || 1);
    const N = players.length;
    const actualZombies = N > 1 ? Math.min(targetZombies, N - 1) : 1;

    // Cryptographically fair Fisher-Yates shuffle
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [players[i], players[j]] = [players[j], players[i]];
    }

    players.forEach((p, idx) => {
      if (idx < actualZombies) {
        p.assignedRole = 'hunter';
        p.role = 'hunter';
      } else {
        p.assignedRole = 'runner';
        p.role = 'runner';
      }
    });
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

  // --- UPDATE LOBBY UI (OPERATIVES LIST & STARTING ZOMBIES) ---
  function updateLobbyUI(data) {
    const players = data.players || [];
    const countEl = document.getElementById('lobby-player-count');
    if (countEl) countEl.textContent = players.length;

    // Check if host
    if (data.hostId) isHost = (data.hostId === myPlayerId);

    // Sync startingZombiesCount from config if present
    if (data.config?.startingZombiesCount) {
      lobbyStartingZombies = parseInt(data.config.startingZombiesCount, 10);
    }

    const hostStepper = document.getElementById('host-zombies-stepper');
    const guestIndicator = document.getElementById('guest-zombies-indicator');
    const startBtn = document.getElementById('btn-start-game');
    const waitingMsg = document.getElementById('host-waiting-msg');

    if (isHost) {
      if (hostStepper) hostStepper.style.display = 'flex';
      if (guestIndicator) guestIndicator.style.display = 'none';
      if (startBtn) {
        startBtn.style.display = 'block';
        startBtn.textContent = `LAUNCH MATCH (${lobbyStartingZombies} ZOMBIE${lobbyStartingZombies > 1 ? 'S' : ''})`;
      }
      if (waitingMsg) waitingMsg.style.display = 'none';
    } else {
      if (hostStepper) hostStepper.style.display = 'none';
      if (guestIndicator) guestIndicator.style.display = 'block';
      if (startBtn) startBtn.style.display = 'none';
      if (waitingMsg) waitingMsg.style.display = 'block';
    }

    updateLobbyZombiesDisplay();

    const listEl = document.getElementById('lobby-player-list');
    if (listEl) {
      listEl.innerHTML = '';
      players.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'player-item';
        const isMe = p.id === myPlayerId;
        const isPlayerHost = p.id === (data.hostId || (isHost && isMe ? myPlayerId : null));
        item.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-family: var(--font-mono); font-size: 11px; color: var(--parchment-dim);">#${idx + 1}</span>
            <span style="font-weight: 700; color: #fff;">${escapeHtml(p.name)} ${isMe ? '<b style="color: var(--parchment);">(You)</b>' : ''}</span>
          </div>
          <span class="player-role-badge ${isPlayerHost ? 'badge-host' : 'badge-operative'}" style="font-size: 10px; padding: 3px 8px;">
            ${isPlayerHost ? 'HOST' : 'OPERATIVE'}
          </span>
        `;
        listEl.appendChild(item);
      });
    }
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
      } else if (state === 'HUNT' || state === 'THE_HUNT' || state === 'EXTRACTION') {
        handleClockTick({
          state: 'HUNT',
          timeRemaining: remaining
        });

        if (remaining <= 0) {
          clearInterval(activeGameClockInterval);
          activeGameClockInterval = null;
          const gameOverPayload = {
            winner: 'survivors',
            reason: 'SURVIVAL_TIME_EXPIRED',
            stats: {
              durationSeconds: totalDuration
            }
          };
          if (isHost) {
            window.supabaseGameManager?.broadcastEvent?.('game_over', gameOverPayload);
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
    requestScreenWakeLock();
    const payload = data.payload ? { ...data.payload, ...data } : data;
    currentRoomData = Object.assign(currentRoomData || {}, payload);
    if (payload.state) currentPhase = payload.state;

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
      myAssignedRole = (me.assignedRole === 'hunter' || me.assignedRole === 'zombie') ? 'zombie' : 'survivor';
    } else if (!myAssignedRole) {
      myAssignedRole = (currentRole === 'zombie' || currentRole === 'hunter') ? 'zombie' : 'survivor';
    }

    const startTime = payload.startTime || Date.now();
    const duration = payload.duration || (payload.state === 'HEAD_START' ? (currentRoomConfig.headStart || 180) : (currentRoomConfig.roundLength || 2700));

    if (payload.state === 'HEAD_START') {
      showScreen('scatter');
      window.soundEngine?.playBell?.();
      window.soundEngine?.playHeartbeat();

      const isRunner = myAssignedRole === 'survivor' || myAssignedRole === 'runner';
      const roleTag = document.getElementById('scatter-role-badge');
      const actionWord = document.getElementById('scatter-action-word');
      const descText = document.getElementById('scatter-desc-text');

      if (isRunner) {
        roleTag.textContent = 'YOUR ROLE · SURVIVOR';
        actionWord.textContent = 'RUN.';
        actionWord.style.color = 'var(--parchment)';
        descText.textContent = 'Scatter and find cover inside the perimeter. Zombies are counting down.';
      } else {
        roleTag.textContent = 'YOUR ROLE · ZOMBIE';
        actionWord.textContent = 'STAND BY.';
        actionWord.style.color = '#ec3013';
        descText.textContent = 'Survivors are scattering to hide. Maintain your position. Prepare to hunt.';
      }

      startClientGameClock('HEAD_START', startTime, duration);
      startLocationTracking();
    } else if (payload.state === 'HUNT' || payload.state === 'THE_HUNT' || payload.state === 'EXTRACTION') {
      showScreen('hunt');
      window.soundEngine?.playBell?.();
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
    } else if (data.state === 'HUNT' || data.state === 'THE_HUNT' || data.state === 'EXTRACTION') {
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

    function getLocalPlayerIcon() {
      const isZombie = myAssignedRole === 'zombie' || myAssignedRole === 'hunter' || currentRole === 'zombie';
      const markerColor = isZombie ? '#ec3013' : '#2563eb';
      const markerGlow = isZombie ? 'rgba(236, 48, 19, 0.9)' : 'rgba(37, 99, 235, 0.9)';
      const roleIcon = isZombie ? '💀' : '🏃';

      return L.divIcon({
        className: 'local-player-icon',
        html: `
          <div style="position:relative; width: 26px; height: 26px;">
            <div style="position:absolute; inset:-4px; border-radius:50%; border:2px solid ${markerColor}; animation: peerPulse 2s infinite ease-out; opacity:0.8;"></div>
            <div style="width: 22px; height: 22px; background: ${markerColor}; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 0 16px ${markerGlow}; display:flex; align-items:center; justify-content:center; color:#fff; font-size:11px;">
              ${roleIcon}
            </div>
          </div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
    }

    myMarker = L.marker([myPosition.lat, myPosition.lng], { icon: getLocalPlayerIcon() }).addTo(gameMap);
    gameMap.panTo([myPosition.lat, myPosition.lng]);

    // Track user map dragging so auto-center doesn't fight manual inspection
    gameMap.on('dragstart', () => {
      userIsDraggingMap = true;
      if (userDragTimeout) clearTimeout(userDragTimeout);
    });
    gameMap.on('dragend', () => {
      if (userDragTimeout) clearTimeout(userDragTimeout);
      userDragTimeout = setTimeout(() => {
        userIsDraggingMap = false;
      }, 7000);
    });

    setupWalkieTalkie();
  }

  function updateMyMarkerVisual() {
    if (myMarker && typeof myMarker.setIcon === 'function') {
      const isZombie = myAssignedRole === 'zombie' || myAssignedRole === 'hunter' || currentRole === 'zombie';
      const markerColor = isZombie ? '#ec3013' : '#2563eb';
      const markerGlow = isZombie ? 'rgba(236, 48, 19, 0.9)' : 'rgba(37, 99, 235, 0.9)';
      const roleIcon = isZombie ? '💀' : '🏃';

      myMarker.setIcon(
        L.divIcon({
          className: 'local-player-icon',
          html: `
            <div style="position:relative; width: 26px; height: 26px;">
              <div style="position:absolute; inset:-4px; border-radius:50%; border:2px solid ${markerColor}; animation: peerPulse 2s infinite ease-out; opacity:0.8;"></div>
              <div style="width: 22px; height: 22px; background: ${markerColor}; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 0 16px ${markerGlow}; display:flex; align-items:center; justify-content:center; color:#fff; font-size:11px;">
                ${roleIcon}
              </div>
            </div>
          `,
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        })
      );
    }
  }

  function updateGameHUD() {
    const isZombie = myAssignedRole === 'zombie' || myAssignedRole === 'hunter';
    const rolePill = document.getElementById('hud-role-pill');
    const zombieControls = document.getElementById('zombie-action-controls');
    const survivorControls = document.getElementById('survivor-action-controls');

    if (isZombie) {
      if (rolePill) {
        rolePill.textContent = 'ZOMBIE';
        rolePill.className = 'player-role-badge badge-zombie';
      }
      if (zombieControls) zombieControls.style.display = 'flex';
      if (survivorControls) survivorControls.style.display = 'none';
    } else {
      if (rolePill) {
        rolePill.textContent = 'SURVIVOR';
        rolePill.className = 'player-role-badge badge-survivor';
      }
      if (zombieControls) zombieControls.style.display = 'none';
      if (survivorControls) survivorControls.style.display = 'flex';
    }

    updateRunnersAliveCount();
    updateMyMarkerVisual();
  }

  function updateRunnersAliveCount() {
    if (!currentRoomData) currentRoomData = { players: [] };
    if (!currentRoomData.players) currentRoomData.players = [];

    const allPlayersMap = new Map();

    // 1. Ingest players from authoritative currentRoomData
    (currentRoomData.players || []).forEach((p) => {
      if (p && p.id) allPlayersMap.set(p.id, { ...p });
    });

    // 2. Ingest from cached presence players
    (cachedLobbyPlayers || []).forEach((p) => {
      if (p && p.id && !allPlayersMap.has(p.id)) {
        allPlayersMap.set(p.id, { ...p });
      }
    });

    // 3. Ensure self is registered with active assignedRole
    const myName = document.getElementById('player-name-input')?.value?.trim() || 'Operative';
    const isSelfZombie = myAssignedRole === 'zombie' || myAssignedRole === 'hunter' || currentRole === 'zombie';
    const selfRole = isSelfZombie ? 'zombie' : 'survivor';

    if (!allPlayersMap.has(myPlayerId)) {
      allPlayersMap.set(myPlayerId, {
        id: myPlayerId,
        name: myName,
        assignedRole: selfRole,
        isTagged: isSelfZombie
      });
    } else {
      const me = allPlayersMap.get(myPlayerId);
      if (!me.assignedRole) me.assignedRole = selfRole;
    }

    const playersList = Array.from(allPlayersMap.values());
    currentRoomData.players = playersList;

    // Categorize
    let survivorsCount = 0;
    let survivorsAlive = 0;
    let zombiesCount = 0;
    let escapedCount = 0;

    playersList.forEach((p) => {
      const r = (p.assignedRole || p.role || p.rolePreference || '').toLowerCase();
      const isZombie = r === 'zombie' || r === 'hunter' || Boolean(p.isTagged);
      if (isZombie) {
        zombiesCount++;
      } else {
        survivorsCount++;
        if (p.escaped) {
          escapedCount++;
        } else {
          survivorsAlive++;
        }
      }
    });

    const totalPlayers = playersList.length;

    // Update bottom sheet counters
    const countEl = document.getElementById('hud-runners-alive');
    if (countEl) countEl.textContent = `${survivorsAlive} of ${survivorsCount}`;

    const zCountEl = document.getElementById('hud-zombies-count');
    if (zCountEl) zCountEl.textContent = `${zombiesCount}`;

    // Update top live stats telemetry strip
    const statTotalEl = document.getElementById('hud-stat-total-players');
    if (statTotalEl) statTotalEl.textContent = `${totalPlayers}`;

    const statSurvEl = document.getElementById('hud-stat-survivors-count');
    if (statSurvEl) statSurvEl.textContent = `${survivorsAlive}`;

    const statZombEl = document.getElementById('hud-stat-zombies-count');
    if (statZombEl) statZombEl.textContent = `${zombiesCount}`;

    const statEscCell = document.getElementById('hud-stat-escaped-cell');
    const statEscEl = document.getElementById('hud-stat-escaped-count');
    if (statEscEl) statEscEl.textContent = `${escapedCount}`;
    if (statEscCell) {
      statEscCell.style.display = escapedCount > 0 || currentPhase === 'EXTRACTION' ? 'flex' : 'none';
    }
  }

  // Ping Event Handling
  function handlePingFired(msg) {
    window.soundEngine?.playPing();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

    const isHunter = myAssignedRole === 'hunter' || currentRole === 'hunter';
    const pings = msg.ping?.runnerPings || msg.runnerPings || [];

    // Register pinging runners directly into active roster
    if (!currentRoomData) currentRoomData = { players: [] };
    if (!currentRoomData.players) currentRoomData.players = [];

    pings.forEach((p) => {
      const existing = currentRoomData.players.find((pl) => pl.id === p.id);
      if (existing) {
        existing.assignedRole = 'runner';
        existing.role = 'runner';
        existing.name = p.name || existing.name || 'Runner';
        existing.lat = p.lat;
        existing.lng = p.lng;
      } else {
        currentRoomData.players.push({
          id: p.id,
          name: p.name || 'Runner',
          assignedRole: 'runner',
          role: 'runner',
          rolePreference: 'runner',
          isTagged: false,
          lat: p.lat,
          lng: p.lng
        });
      }
    });

    updateRunnersAliveCount();

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
      if (alert) {
        alert.style.borderColor = 'var(--brass)';
        alert.style.display = 'block';
        setTimeout(() => (alert.style.display = 'none'), 1200);
      }
    }
  }

  // Update Fellow Hunter Positions (Zombies in red)
  function updateHunterPositions(hunters) {
    if (!gameMap) return;

    hunters.forEach((h) => {
      if (hunterMarkers.has(h.id)) {
        hunterMarkers.get(h.id).setLatLng([h.lat, h.lng]);
      } else {
        const icon = L.divIcon({
          className: 'teammate-hunter-icon',
          html: `
            <div style="background: #ec3013; color:#fff; font-size:10px; font-weight:800; border:2px solid #ffffff; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px rgba(236,48,19,0.85);">
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

  // Tactical Radar Live Peer & Opponent Map Markers
  // Zombies are ALWAYS RED (#ec3013), Survivors are ALWAYS BLUE (#2563eb)
  function createPeerIcon(p) {
    const isZombie = p.role === 'zombie' || p.role === 'hunter';
    const isTeammate = Boolean(p.isTeammate);
    const isInfectious = Boolean(p.isInfectious);

    let markerClass = isZombie
      ? ('peer-zombie-marker' + (isInfectious ? ' is-infectious' : ''))
      : 'peer-survivor-marker';
    let pulseClass = isZombie ? 'crimson-pulse' : 'blue-pulse';
    let badgeContent = isZombie ? (isInfectious ? '☣️' : '💀') : (isTeammate ? '🛡️' : '🏃');

    const shortName = (p.name || 'Operative').slice(0, 10);

    return L.divIcon({
      className: 'tactical-peer-icon-container',
      html: `
        <div class="peer-tactical-marker ${markerClass}" data-peer-id="${escapeHtml(p.id)}">
          <div class="peer-radar-pulse ${pulseClass}"></div>
          <div class="peer-core-badge">${badgeContent}</div>
          <div class="peer-callsign-pill">${escapeHtml(shortName)}</div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }

  function updatePeerMapMarkers(blips, pruneOthers = true) {
    if (!gameMap || !Array.isArray(blips)) return;

    const activeIds = new Set();

    blips.forEach((p) => {
      if (!p || p.id === myPlayerId) return;
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;

      activeIds.add(p.id);

      const distLabel = typeof p.dist === 'number' ? ` · ${p.dist}m` : '';
      const roleLabel = (p.role === 'zombie' || p.role === 'hunter') ? 'ZOMBIE' : 'SURVIVOR';
      const statusLabel = p.isInfectious ? ' [INFECTIOUS]' : (p.isFreshMeat ? ' [FRESH MEAT]' : '');
      const tooltipText = `<b>${escapeHtml(p.name || 'Operative')}</b> (${roleLabel}${statusLabel}${distLabel})`;

      if (peerMarkers.has(p.id)) {
        const entry = peerMarkers.get(p.id);
        entry.marker.setLatLng([p.lat, p.lng]);
        if (entry.marker.getTooltip()) {
          entry.marker.setTooltipContent(tooltipText);
        }

        // Refresh icon if role or infection status toggles
        if (entry.isInfectious !== Boolean(p.isInfectious) || entry.role !== p.role) {
          entry.role = p.role;
          entry.isInfectious = Boolean(p.isInfectious);
          entry.marker.setIcon(createPeerIcon(p));
        }
      } else {
        const icon = createPeerIcon(p);
        const marker = L.marker([p.lat, p.lng], {
          icon,
          zIndexOffset: p.isInfectious ? 1000 : 500
        }).addTo(gameMap);

        marker.bindTooltip(tooltipText, {
          permanent: false,
          direction: 'top',
          className: 'tactical-peer-tooltip'
        });

        peerMarkers.set(p.id, {
          marker,
          role: p.role,
          isInfectious: Boolean(p.isInfectious)
        });
      }
    });

    if (pruneOthers) {
      for (const [id, entry] of peerMarkers.entries()) {
        if (!activeIds.has(id)) {
          if (gameMap.hasLayer(entry.marker)) {
            gameMap.removeLayer(entry.marker);
          }
          peerMarkers.delete(id);
        }
      }
    }
  }

  function setClientOutOfBounds(isOob, serverRemaining) {
    const oobOverlay = document.getElementById('out-of-bounds-overlay');
    const boundaryAlert = document.getElementById('boundary-alert');
    const timerVal = document.getElementById('oob-timer-val');
    const progressFill = document.getElementById('oob-progress-fill');

    // Only active during match phases
    const activeState = currentPhase || currentRoomData?.state || (document.getElementById('screen-hunt')?.classList.contains('active') ? 'THE_HUNT' : 'LOBBY');
    const inActiveMatch = activeState === 'HEAD_START' || activeState === 'THE_HUNT' || activeState === 'HUNT' || activeState === 'EXTRACTION';

    if (!inActiveMatch || !isOob) {
      if (clientOobState.active || (oobOverlay && oobOverlay.style.display !== 'none')) {
        clientOobState.active = false;
        if (clientOobState.intervalId) {
          clearInterval(clientOobState.intervalId);
          clientOobState.intervalId = null;
        }
        if (oobOverlay) oobOverlay.style.display = 'none';
        if (boundaryAlert) boundaryAlert.style.display = 'none';
        if (timerVal) timerVal.textContent = '60s';
        if (progressFill) progressFill.style.width = '100%';
      }
      return;
    }

    // Operative IS Out of Bounds!
    if (!clientOobState.active) {
      clientOobState.active = true;
      clientOobState.remainingSeconds = typeof serverRemaining === 'number' ? serverRemaining : 60;
      if (oobOverlay) oobOverlay.style.display = 'flex';
      if (boundaryAlert) boundaryAlert.style.display = 'block';

      if (clientOobState.intervalId) clearInterval(clientOobState.intervalId);
      clientOobState.intervalId = setInterval(() => {
        if (!clientOobState.active) {
          clearInterval(clientOobState.intervalId);
          clientOobState.intervalId = null;
          return;
        }
        clientOobState.remainingSeconds = Math.max(0, clientOobState.remainingSeconds - 1);
        updateOobDisplay();
      }, 1000);
    } else if (typeof serverRemaining === 'number') {
      // Authoritative sync from server
      clientOobState.remainingSeconds = serverRemaining;
    }

    updateOobDisplay();
  }

  function updateOobDisplay() {
    const timerVal = document.getElementById('oob-timer-val');
    const progressFill = document.getElementById('oob-progress-fill');
    const zoneNameEl = document.getElementById('hud-zone-name');
    const threatTextEl = document.getElementById('hud-threat-text');
    const rem = clientOobState.remainingSeconds;

    if (timerVal) {
      timerVal.textContent = `${rem}s`;
      timerVal.style.color = rem <= 15 ? '#ff0000' : '#ffffff';
    }

    if (progressFill) {
      const pct = Math.max(0, Math.min(100, (rem / 60) * 100));
      progressFill.style.width = `${pct}%`;
      progressFill.style.background = pct <= 25 ? '#ff0000' : 'linear-gradient(90deg, #ff3131, #ff9100)';
    }

    if (clientOobState.active) {
      if (zoneNameEl) {
        zoneNameEl.textContent = `PERIMETER BREACH! (${rem}s TO ELIMINATION)`;
        zoneNameEl.style.color = '#ff3131';
      }
      if (threatTextEl) {
        threatTextEl.textContent = `⚠️ OUT OF BOUNDS (${rem}s)`;
        threatTextEl.style.color = '#ff3131';
      }
    }

    // Audio/tactile feedback on mobile in critical countdown zone
    if (clientOobState.active && rem <= 10 && rem > 0 && navigator.vibrate) {
      try {
        navigator.vibrate(rem <= 5 ? [150, 80, 150] : [100]);
      } catch (e) {}
    }
  }

  // --- ZOMBIES GAME MECHANICS HANDLERS ---

  function handleRadarUpdate(msg) {
    if (msg.myBounties !== undefined) myBounties = msg.myBounties;
    if (msg.myPowerups !== undefined) myPowerups = msg.myPowerups;
    if (msg.myActiveEffects !== undefined) myActiveEffects = msg.myActiveEffects;
    if (msg.isInfectious !== undefined) isInfectiousState = msg.isInfectious;
    if (msg.infectCooldownRemaining !== undefined) infectCooldownRemaining = msg.infectCooldownRemaining;

    // Handle 60s Out of Bounds Red Alert & Accurate On-Screen Countdown
    setClientOutOfBounds(Boolean(msg.outOfBounds), msg.outOfBoundsRemaining);

    // Update authoritative live match statistics across all devices
    if (msg.playersCount !== undefined) {
      const statTotal = document.getElementById('hud-stat-total-players');
      const statSurv = document.getElementById('hud-stat-survivors-count');
      const statZomb = document.getElementById('hud-stat-zombies-count');
      const statEsc = document.getElementById('hud-stat-escaped-count');
      const statEscCell = document.getElementById('hud-stat-escaped-cell');
      const countEl = document.getElementById('hud-runners-alive');
      const zCountEl = document.getElementById('hud-zombies-count');

      if (statTotal) statTotal.textContent = String(msg.playersCount);
      if (statSurv) statSurv.textContent = String(msg.survivorsCount);
      if (statZomb) statZomb.textContent = String(msg.zombiesCount);
      if (statEsc) statEsc.textContent = String(msg.escapedCount || 0);
      if (statEscCell) statEscCell.style.display = (msg.escapedCount > 0 || currentPhase === 'EXTRACTION') ? 'flex' : 'none';

      if (countEl) countEl.textContent = `${msg.survivorsCount} ALIVE`;
      if (zCountEl) zCountEl.textContent = String(msg.zombiesCount);
    }

    // 1. Health Coins removed per design requirement
    // 2. Update 2 Powerup Slots
    const slot0Label = document.getElementById('slot-0-label');
    const slot1Label = document.getElementById('slot-1-label');
    const btnSlot0 = document.getElementById('btn-powerup-slot-0');
    const btnSlot1 = document.getElementById('btn-powerup-slot-1');

    if (myPowerups[0]) {
      const def = CLIENT_POWERUP_CATALOG[myPowerups[0]];
      if (slot0Label) slot0Label.textContent = def ? def.name.toUpperCase() : myPowerups[0];
      if (btnSlot0) btnSlot0.classList.add('has-powerup');
    } else {
      if (slot0Label) slot0Label.textContent = 'EMPTY';
      if (btnSlot0) btnSlot0.classList.remove('has-powerup');
    }

    if (myPowerups[1]) {
      const def = CLIENT_POWERUP_CATALOG[myPowerups[1]];
      if (slot1Label) slot1Label.textContent = def ? def.name.toUpperCase() : myPowerups[1];
      if (btnSlot1) btnSlot1.classList.add('has-powerup');
    } else {
      if (slot1Label) slot1Label.textContent = 'EMPTY';
      if (btnSlot1) btnSlot1.classList.remove('has-powerup');
    }

    // 3. Update Zombie Infect Button State
    const infectBtn = document.getElementById('btn-zombie-infect-burst');
    const infectLabel = document.getElementById('infect-burst-label');
    if (infectBtn && infectLabel) {
      if (isInfectiousState) {
        infectBtn.className = 'btn btn-tag-action btn-infect-burst is-infectious';
        infectLabel.textContent = 'INFECTIOUS! (BURST ACTIVE)';
      } else if (infectCooldownRemaining > 0) {
        infectBtn.className = 'btn btn-tag-action btn-infect-burst is-cooldown';
        infectLabel.textContent = `RECHARGING (${infectCooldownRemaining}s)`;
      } else {
        infectBtn.className = 'btn btn-tag-action btn-infect-burst';
        infectLabel.textContent = 'TAP TO INFECT (10s BURST)';
      }
    }

    // 4. Update Zones on Map
    if (gameMap && msg.zones) {
      msg.zones.forEach((zone) => {
        if (zone.lat === undefined || zone.lng === undefined) return;
        if (!zoneMarkers.has(zone.id)) {
          let zoneColor = '#60a5fa';
          let zoneFill = '#60a5fa';
          if (zone.type === 'HEALTH_ZONE') {
            zoneColor = '#10b981';
            zoneFill = '#10b981';
          } else if (zone.type === 'HEALTH_PLUS_ZONE') {
            zoneColor = '#ffab00';
            zoneFill = '#ffab00';
          } else if (zone.type === 'EXTRACTION_ZONE') {
            zoneColor = '#f59e0b';
            zoneFill = '#ec3013';
          }

          const circle = L.circle([zone.lat, zone.lng], {
            color: zoneColor,
            fillColor: zoneFill,
            fillOpacity: zone.active ? 0.25 : 0.08,
            weight: 2,
            radius: zone.radius
          }).addTo(gameMap);

          circle.bindTooltip(`<b>${zone.name}</b>`, { permanent: false, direction: 'top' });
          zoneMarkers.set(zone.id, circle);
        } else {
          const circle = zoneMarkers.get(zone.id);
          circle.setLatLng([zone.lat, zone.lng]);
          if (zone.type === 'EXTRACTION_ZONE') {
            circle.setStyle({ fillOpacity: zone.active ? 0.35 : 0.08, color: zone.active ? '#ffab00' : '#888' });
          }
        }
      });
    }

    // 5. Update Threat / Zone Status in HUD
    const zoneNameEl = document.getElementById('hud-zone-name');
    const threatTextEl = document.getElementById('hud-threat-text');

    if (zoneNameEl && msg.zones) {
      const activeZone = msg.zones.find((z) => z.dist <= z.radius);
      if (activeZone) {
        if (activeZone.type === 'HEALTH_ZONE') {
          zoneNameEl.textContent = `${activeZone.name.toUpperCase()} (+2 HP/s)`;
          zoneNameEl.style.color = '#10b981';
        } else if (activeZone.type === 'HEALTH_PLUS_ZONE') {
          zoneNameEl.textContent = `${activeZone.name.toUpperCase()} (SHOP READY)`;
          zoneNameEl.style.color = '#ffab00';
        } else if (activeZone.type === 'ARENA_CENTER') {
          zoneNameEl.textContent = 'ARENA HUB (ZOMBIE BASE)';
          zoneNameEl.style.color = '#60a5fa';
        } else if (activeZone.type === 'EXTRACTION_ZONE') {
          zoneNameEl.textContent = activeZone.active ? 'EXTRACTION ZONE OPEN! ESCAPE NOW' : 'EXTRACTION LOCKED';
          zoneNameEl.style.color = '#ffab00';
        }
      } else {
        zoneNameEl.textContent = 'OPEN GROUND (DECAY ACTIVE)';
        zoneNameEl.style.color = 'var(--runner-gold)';
      }
    }

    if (threatTextEl) {
      if (myActiveEffects?.cloaked) {
        threatTextEl.textContent = 'CLOAK ACTIVE 🥷';
        threatTextEl.style.color = '#10b981';
      } else if (msg.freshMeatTarget) {
        threatTextEl.textContent = `FRESH MEAT: ${msg.freshMeatTarget.name} (${msg.freshMeatTarget.dist}m)`;
        threatTextEl.style.color = '#ec3013';
      } else {
        threatTextEl.textContent = isZombie ? 'HUNTING' : 'SURVIVING';
        threatTextEl.style.color = isZombie ? '#ec3013' : 'var(--runner-gold)';
      }
    }

    // 6. 20-Meter Zombie Proximity Threat: Scary Sound & Red Screen Vignette Pulse
    const isZombieRole = myAssignedRole === 'zombie' || myAssignedRole === 'hunter' || currentRole === 'zombie';
    const isSurvivor = !isZombieRole;
    const proxBanner = document.getElementById('proximity-warning-banner');
    const proxText = document.getElementById('proximity-warning-text');
    const vignetteEl = document.getElementById('zombie-proximity-vignette');

    if (isSurvivor && msg.blips && Array.isArray(msg.blips)) {
      let nearestZombieDist = Infinity;
      let nearestZombieName = '';
      for (const b of msg.blips) {
        const isEnemyZombie = (b.role === 'zombie' || b.role === 'hunter') && !b.isCloaked;
        if (isEnemyZombie && typeof b.dist === 'number') {
          if (b.dist < nearestZombieDist) {
            nearestZombieDist = b.dist;
            nearestZombieName = b.name || 'Zombie';
          }
        }
      }

      if (nearestZombieDist <= 20) {
        // Red screen horror threat pulse
        if (vignetteEl) {
          vignetteEl.style.display = 'block';
          vignetteEl.classList.add('zombie-threat-active');
        }

        // Trigger procedural horror scary sound effect
        window.soundEngine?.playZombieNearScarySound(nearestZombieDist);

        if (proxBanner) proxBanner.style.display = 'flex';
        if (proxText) proxText.textContent = `⚠️ ZOMBIE NEARBY (${nearestZombieName}) AT ${Math.round(nearestZombieDist)}m! RUN!`;

        // 15-meter sonar beep & haptic pulse when zombie closes in
        if (nearestZombieDist <= 15) {
          const now = Date.now();
          const cadence = nearestZombieDist <= 5 ? 250 : (nearestZombieDist <= 10 ? 500 : 1000);
          if (now - lastProximityBeepTime >= cadence) {
            lastProximityBeepTime = now;
            window.soundEngine?.playProximityBeep(nearestZombieDist);
            if (navigator.vibrate) {
              try { navigator.vibrate(nearestZombieDist <= 5 ? [150, 50, 150] : [80]); } catch (e) {}
            }
          }
        }
      } else {
        if (vignetteEl) {
          vignetteEl.style.display = 'none';
          vignetteEl.classList.remove('zombie-threat-active');
        }
        if (proxBanner) proxBanner.style.display = 'none';
      }
    } else {
      if (vignetteEl) {
        vignetteEl.style.display = 'none';
        vignetteEl.classList.remove('zombie-threat-active');
      }
      if (proxBanner) proxBanner.style.display = 'none';
    }

    // 7. Update Live Peer & Opponent Radar Markers on Map
    if (msg.blips && Array.isArray(msg.blips)) {
      updatePeerMapMarkers(msg.blips, true);
    }
  }

  function handleZombieInfectionTriggered(msg) {
    window.soundEngine?.playTagAlarm();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

    const boundaryAlert = document.getElementById('boundary-alert');
    if (boundaryAlert) {
      boundaryAlert.textContent = `☣️ ZOMBIE BURST! ${msg.zombieName} is INFECTIOUS for ${msg.duration}s!`;
      boundaryAlert.style.borderColor = '#ec3013';
      boundaryAlert.style.display = 'block';
      setTimeout(() => (boundaryAlert.style.display = 'none'), 3500);
    }
  }

  function handleZombieInfectionExpired(msg) {
    if (msg.zombieId === myPlayerId) {
      isInfectiousState = false;
    }
  }

  function handleChaseWarning(msg) {
    const alertEl = document.getElementById('boundary-alert');
    if (!alertEl) return;

    if (msg.survivorId === myPlayerId) {
      // Local player is the SURVIVOR being chased!
      alertEl.innerHTML = `⚠️ <b>ZOMBIE ON YOUR TAIL!</b> ${escapeHtml(msg.zombieName)} is ${msg.distance}m away!<br>RUN! Infection in <b>${msg.secondsRemaining}s</b>`;
      alertEl.style.borderColor = '#ec3013';
      alertEl.style.color = '#ffffff';
      alertEl.style.background = 'rgba(236, 48, 19, 0.95)';
      alertEl.style.display = 'block';
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    } else if (msg.zombieId === myPlayerId) {
      // Local player is the ZOMBIE chasing!
      alertEl.innerHTML = `🎯 <b>LOCKING IN!</b> Within ${msg.distance}m of ${escapeHtml(msg.survivorName)}!<br>Hold distance for <b>${msg.secondsRemaining}s</b> to infect!`;
      alertEl.style.borderColor = '#2563eb';
      alertEl.style.color = '#ffffff';
      alertEl.style.background = 'rgba(37, 99, 235, 0.95)';
      alertEl.style.display = 'block';
    }
  }

  function handleChaseEscaped(msg) {
    const alertEl = document.getElementById('boundary-alert');
    if (!alertEl) return;

    if (msg.survivorId === myPlayerId) {
      alertEl.innerHTML = `💨 <b>BROKE AWAY!</b> You escaped the 5m chase zone! Keep moving!`;
      alertEl.style.borderColor = '#10b981';
      alertEl.style.color = '#ffffff';
      alertEl.style.background = 'rgba(16, 185, 129, 0.95)';
      alertEl.style.display = 'block';
      setTimeout(() => (alertEl.style.display = 'none'), 2500);
    } else {
      setTimeout(() => (alertEl.style.display = 'none'), 1000);
    }
  }

  let crossInfectionTimeout = null;
  function showCrossDeviceInfectionBanner(msg) {
    const banner = document.getElementById('cross-device-infection-banner');
    const detailEl = document.getElementById('cross-infection-detail');
    if (!banner || !detailEl) return;

    const methodLabel = msg.method === 'OUT_OF_BOUNDS_60S'
      ? 'Toxic Wasteland Boundary Breach'
      : (msg.method === '5M_CHASE_10S' ? '5m Chase Proximity' : 'Physical QR Tag');

    detailEl.innerHTML = `<b>${escapeHtml(msg.victimName)}</b> was infected by <b>${escapeHtml(msg.killerName)}</b> via ${methodLabel}! Now a <b>ZOMBIE</b>!`;
    banner.style.display = 'flex';

    if (crossInfectionTimeout) clearTimeout(crossInfectionTimeout);
    crossInfectionTimeout = setTimeout(() => {
      banner.style.display = 'none';
    }, 4500);
  }

  let tacticalToastTimeout = null;
  function showTacticalToast(text, icon = '📍') {
    const toast = document.getElementById('tactical-toast');
    const msgEl = document.getElementById('tactical-toast-msg');
    const iconEl = document.getElementById('tactical-toast-icon');
    if (!toast) return;

    if (msgEl) msgEl.textContent = text;
    if (iconEl) iconEl.textContent = icon;
    toast.style.display = 'flex';

    if (tacticalToastTimeout) clearTimeout(tacticalToastTimeout);
    tacticalToastTimeout = setTimeout(() => {
      toast.style.display = 'none';
    }, 3000);
  }

  function refreshPlayerGpsAndMap() {
    window.soundEngine?.playClick();
    const btn = document.getElementById('btn-refresh-map');
    const fab = document.getElementById('btn-map-recenter-gps');
    btn?.classList.add('spinning');
    fab?.classList.add('spinning');
    setTimeout(() => {
      btn?.classList.remove('spinning');
      fab?.classList.remove('spinning');
    }, 1200);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, heading } = pos.coords;
          myPosition = { lat: latitude, lng: longitude };
          updateAndSendLocation(latitude, longitude, heading);
          if (gameMap) {
            gameMap.setView([latitude, longitude], 17);
            gameMap.invalidateSize();
          }
          if (myMarker) {
            myMarker.setLatLng([latitude, longitude]);
          }
          showTacticalToast('GPS Refreshed & Radar Synchronized!', '📍');
          window.soundEngine?.playPing();
        },
        (err) => {
          console.warn('GPS refresh notice:', err);
          showTacticalToast('GPS Signal Weak: Ensure Location is ON', '⚠️');
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
      );
    } else {
      showTacticalToast('Geolocation not supported on this device', '⚠️');
    }
  }

  function handlePlayerInfected(msg) {
    window.soundEngine?.playTagAlarm();
    if (navigator.vibrate) navigator.vibrate([500, 200, 500]);

    if (Array.isArray(msg.players) && msg.players.length > 0) {
      currentRoomData.players = msg.players;
    }

    // Trigger cross-device notification banner on every device
    showCrossDeviceInfectionBanner(msg);

    if (msg.victimId === myPlayerId) {
      setClientOutOfBounds(false);
      myAssignedRole = 'zombie';
      currentRole = 'zombie';

      const alertDesc = document.getElementById('infection-alert-desc');
      if (alertDesc) {
        if (msg.method === 'OUT_OF_BOUNDS_60S') {
          alertDesc.innerHTML = `Eliminated by <b>Toxic Wasteland (Out of Bounds)</b> for staying outside the zone 60s!<br><b>YOU ARE NOW INFECTED. JOIN THE HUNT!</b>`;
        } else {
          alertDesc.innerHTML = `Tagged by <b>${escapeHtml(msg.killerName)}</b> via ${msg.method}!<br><b>YOU ARE NOW INFECTED. JOIN THE HUNT!</b>`;
        }
      }

      const alertModal = document.getElementById('modal-infection-alert');
      if (alertModal) alertModal.style.display = 'flex';

      updateGameHUD();
    } else {
      const boundaryAlert = document.getElementById('boundary-alert');
      if (boundaryAlert) {
        boundaryAlert.textContent = `☣️ INFECTION! ${msg.victimName} was infected by ${msg.killerName}!`;
        boundaryAlert.style.borderColor = '#ec3013';
        boundaryAlert.style.display = 'block';
        setTimeout(() => (boundaryAlert.style.display = 'none'), 4000);
      }
    }

    updateRunnersAliveCount();
  }

  function handlePowerupBought(msg) {
    window.soundEngine?.playClick();
    myPowerups = msg.powerups || [];
    if (msg.bountiesEarned !== undefined) myBounties = msg.bountiesEarned;

    const def = CLIENT_POWERUP_CATALOG[msg.powerupId];
    alert(`Acquired ${def?.name || msg.powerupId}! Ready in inventory slot.`);
    document.getElementById('modal-powerup-shop').style.display = 'none';
  }

  function handlePowerupActivated(msg) {
    window.soundEngine?.playPing();
    const boundaryAlert = document.getElementById('boundary-alert');
    if (boundaryAlert) {
      boundaryAlert.textContent = `⚡ POWERUP: ${msg.playerName} activated ${msg.powerupName}!`;
      boundaryAlert.style.borderColor = '#ffab00';
      boundaryAlert.style.display = 'block';
      setTimeout(() => (boundaryAlert.style.display = 'none'), 3000);
    }
  }

  function handleExtractionStarted(msg) {
    window.soundEngine?.playFanfare();
    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);

    const boundaryAlert = document.getElementById('boundary-alert');
    if (boundaryAlert) {
      boundaryAlert.textContent = '🚀 FINAL PHASE: EXTRACTION ZONE IS OPEN! SURVIVORS ESCAPE NOW!';
      boundaryAlert.style.borderColor = '#ffab00';
      boundaryAlert.style.display = 'block';
      setTimeout(() => (boundaryAlert.style.display = 'none'), 6000);
    }
  }

  function handleSurvivorEscaped(msg) {
    window.soundEngine?.playFanfare();
    const boundaryAlert = document.getElementById('boundary-alert');
    if (boundaryAlert) {
      boundaryAlert.textContent = `🏆 ESCAPED! Survivor ${msg.survivorName} successfully extracted!`;
      boundaryAlert.style.borderColor = '#10b981';
      boundaryAlert.style.display = 'block';
      setTimeout(() => (boundaryAlert.style.display = 'none'), 5000);
    }
  }

  // Player Tagged Event
  function handlePlayerTagged(msg) {
    window.soundEngine?.playTagAlarm();
    if (navigator.vibrate) navigator.vibrate([400, 200, 400]);

    const targetId = msg.runnerId;
    if (currentRoomData?.players) {
      const p = currentRoomData.players.find((pl) => pl.id === targetId);
      if (p) p.isTagged = true;
    }
    if (cachedLobbyPlayers) {
      const p = cachedLobbyPlayers.find((pl) => pl.id === targetId);
      if (p) p.isTagged = true;
    }

    const rName = msg.runnerName || 'A Runner';
    const hName = msg.hunterName || 'A Hunter';

    const boundaryAlert = document.getElementById('boundary-alert');
    if (boundaryAlert) {
      boundaryAlert.textContent = `🎯 TAGGED! ${rName} was caught by ${hName}!`;
      boundaryAlert.style.borderColor = 'var(--crimson)';
      boundaryAlert.style.display = 'block';
      setTimeout(() => (boundaryAlert.style.display = 'none'), 4000);
    }

    if (msg.runnerId === myPlayerId) {
      document.getElementById('hud-role-pill').textContent = 'SPECTATOR';
      document.getElementById('hud-role-pill').className = 'player-role-badge badge-random';
      document.getElementById('btn-runner-tagged-action').style.display = 'none';
    }

    updateRunnersAliveCount();

    // Check if all runners caught
    if (currentRoomData?.players) {
      const runners = currentRoomData.players.filter((p) => (p.assignedRole || p.rolePreference || p.role) === 'runner');
      if (runners.length > 0 && runners.every((p) => p.isTagged)) {
        handleGameOver({ winner: 'HUNTERS', stats: { durationSeconds: 180, totalPings: 1 } });
      }
    }
  }

  // Game Over Event
  function handleGameOver(msg) {
    setClientOutOfBounds(false);
    window.soundEngine?.playFanfare();
    showScreen('gameOver');

    // Clean up peer markers from map
    peerMarkers.forEach((entry) => {
      if (gameMap && gameMap.hasLayer(entry.marker)) gameMap.removeLayer(entry.marker);
    });
    peerMarkers.clear();

    const winnerTitle = document.getElementById('game-over-winner-title');
    const reasonText = document.getElementById('game-over-reason');

    const isZombiesWin = msg.winner === 'ZOMBIES' || msg.winner === 'HUNTERS';
    if (winnerTitle) {
      winnerTitle.textContent = isZombiesWin ? 'ZOMBIES INFECTED ALL' : 'SURVIVORS ESCAPED & WON!';
      winnerTitle.style.color = isZombiesWin ? '#ff3131' : '#38bdf8';
    }
    if (reasonText) {
      reasonText.textContent = isZombiesWin
        ? 'The horde prevailed! Every survivor was hunted down and infected.'
        : 'Survivors successfully evaded the horde and survived the round!';
    }

    const durationMin = Math.floor((msg.stats?.durationSeconds || 0) / 60);
    const durationSec = (msg.stats?.durationSeconds || 0) % 60;
    const durEl = document.getElementById('stat-match-duration');
    if (durEl) durEl.textContent = `${durationMin}m ${durationSec}s`;

    const escapedEl = document.getElementById('stat-match-escaped');
    if (escapedEl) escapedEl.textContent = msg.stats?.escapedSurvivors?.length || 0;

    const infectionList = msg.stats?.infectionLog || [];
    const infectEl = document.getElementById('stat-match-infections');
    if (infectEl) infectEl.textContent = infectionList.length;

    // 1. Render Infection Timeline ("Who Infected Who")
    const timelineList = document.getElementById('game-over-timeline-list');
    if (timelineList) {
      timelineList.innerHTML = '';
      if (infectionList.length === 0) {
        timelineList.innerHTML = '<div style="font-size: 12px; color: var(--parchment-muted); font-style: italic;">No infections occurred this match!</div>';
      } else {
        infectionList.forEach((ev) => {
          const row = document.createElement('div');
          row.className = 'timeline-event-row';
          const time = new Date(ev.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const methodDesc = ev.method === 'OUT_OF_BOUNDS_60S'
            ? '60s Boundary Breach'
            : (ev.method === '5M_CHASE_10S' ? '5m Chase Proximity' : 'Physical QR Tag');
          row.innerHTML = `<b>${time}</b> • 🧟 <b style="color: #ff3131;">${escapeHtml(ev.killerName)}</b> infected 🏃 <b>${escapeHtml(ev.victimName)}</b> (${methodDesc})`;
          timelineList.appendChild(row);
        });
      }
    }

    // 2. Render Operative Scoreboard
    const scoreboardList = document.getElementById('game-over-scoreboard-list');
    if (scoreboardList) {
      scoreboardList.innerHTML = '';
      const players = msg.stats?.players || [];
      players.sort((a, b) => (b.tagsCount || 0) - (a.tagsCount || 0));
      players.forEach((p) => {
        const row = document.createElement('div');
        const isZombie = p.assignedRole === 'zombie';
        row.className = `scoreboard-row ${isZombie ? 'zombie-role' : 'survivor-won'}`;
        const statusBadge = p.escaped
          ? '<span style="color: #38bdf8; font-weight: 700;">ESCAPED 🚀</span>'
          : (p.isTagged ? '<span style="color: #ff3131; font-weight: 700;">INFECTED ☣️</span>' : '<span style="color: #22c55e; font-weight: 700;">SURVIVED 🛡️</span>');
        row.innerHTML = `
          <div>
            <b>${isZombie ? '💀' : '🏃'} ${escapeHtml(p.name)}</b>
            <div style="font-size: 10px; color: var(--parchment-muted);">${isZombie ? 'Zombie' : 'Survivor'}</div>
          </div>
          <div style="text-align: right;">
            <div>${statusBadge}</div>
            <div style="font-size: 10px; color: var(--parchment-muted);">${p.tagsCount || 0} Infections</div>
          </div>
        `;
        scoreboardList.appendChild(row);
      });
    }

    // 3. Save match recap to localStorage for persistence
    try {
      localStorage.setItem('run_for_your_life_last_recap', JSON.stringify({
        timestamp: Date.now(),
        winner: msg.winner,
        stats: msg.stats
      }));
    } catch (_) {}
  }

  document.getElementById('btn-return-lobby').addEventListener('click', () => {
    window.soundEngine?.playClick();
    peerMarkers.forEach((entry) => {
      if (gameMap && gameMap.hasLayer(entry.marker)) gameMap.removeLayer(entry.marker);
    });
    peerMarkers.clear();
    sessionStorage.removeItem('RFYL_ACTIVE_ROOM');
    sessionStorage.removeItem('RFYL_ACTIVE_PLAYER_ID');
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

  // --- REAL-TIME LIVE GPS LOCATION TRACKING ---
  function startLocationTracking() {
    startRealGpsTracking();
  }

  function startRealGpsTracking() {
    if (navigator.geolocation) {
      // Immediate one-shot fix for instantaneous responsive tracking
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          hasLocationPermission = true;
          updateAndSendLocation(pos.coords.latitude, pos.coords.longitude);
        },
        (err) => console.warn('Initial geolocation position fix warning:', err),
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
      );

      // Continuous high-accuracy watcher
      if (watchPositionId === null) {
        watchPositionId = navigator.geolocation.watchPosition(
          (pos) => {
            hasLocationPermission = true;
            updateAndSendLocation(pos.coords.latitude, pos.coords.longitude);
          },
          (err) => console.warn('Geolocation watch error:', err),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 }
        );
      }

      // 1-Second Continuous Heartbeat Poller (prevents mobile OS GPS throttling when stationary/slow)
      if (gpsPollInterval === null) {
        gpsPollInterval = setInterval(() => {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                hasLocationPermission = true;
                updateAndSendLocation(pos.coords.latitude, pos.coords.longitude);
              },
              () => {},
              { enableHighAccuracy: true, timeout: 4000, maximumAge: 500 }
            );
          }
        }, 1000);
      }
    }
  }

  function updateAndSendLocation(lat, lng) {
    myPosition = { lat, lng };
    myPath.push({ lat, lng, time: Date.now() });

    if (myMarker) myMarker.setLatLng([lat, lng]);
    if (gameMap && !userIsDraggingMap) gameMap.panTo([lat, lng]);

    // Boundary check & countdown
    const arena = currentRoomData?.config?.arena || currentRoomConfig?.arena;
    if (arena) {
      const dist = haversine(lat, lng, arena.lat, arena.lng);
      const out = dist > arena.radius;
      setClientOutOfBounds(out);
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

  // --- SURVIVORS PUSH-TO-TALK (PTT) WALKIE-TALKIE RADIO ---
  let walkieMediaRecorder = null;
  let walkieAudioChunks = [];
  let isWalkieTransmitting = false;
  let isWalkieButtonHeld = false;
  let cachedAudioStream = null;

  async function getMicrophoneStream() {
    if (cachedAudioStream && cachedAudioStream.active) {
      return cachedAudioStream;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return null;
    }
    try {
      cachedAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      return cachedAudioStream;
    } catch (e) {
      console.warn('Microphone permission or access error:', e);
      return null;
    }
  }

  function setupWalkieTalkie() {
    const pttBtn = document.getElementById('btn-walkie-talkie');
    if (!pttBtn) return;

    // Prevent duplicate listener registration
    if (pttBtn._hasWalkieListeners) return;
    pttBtn._hasWalkieListeners = true;

    const label = document.getElementById('walkie-talkie-label');
    const waveAnim = document.getElementById('ptt-wave-anim');
    const banner = document.getElementById('walkie-talkie-banner');
    const bannerText = document.getElementById('walkie-talkie-banner-text');

    const startTransmission = async (e) => {
      if (e) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      }

      isWalkieButtonHeld = true;

      // Check operative role: only survivors can transmit
      const isZombie = myAssignedRole === 'zombie' || myAssignedRole === 'hunter' || currentRole === 'zombie';
      if (isZombie) {
        showTacticalToast('Radio jammed: Zombies screech, they cannot transmit.', '☣️');
        return;
      }

      if (isWalkieTransmitting) return;

      // Instant UI & sound feedback
      window.soundEngine?.playRadioStart();
      if (navigator.vibrate) navigator.vibrate(40);

      pttBtn.classList.add('is-transmitting');
      if (label) label.textContent = 'TRANSMITTING LIVE... (RELEASE TO SEND)';
      if (waveAnim) waveAnim.style.display = 'flex';

      if (banner) {
        banner.classList.remove('is-incoming');
        banner.style.display = 'flex';
        if (bannerText) bannerText.textContent = '📻 TRANSMITTING LIVE TO SURVIVORS...';
      }

      const stream = await getMicrophoneStream();
      if (!stream) {
        isWalkieButtonHeld = false;
        pttBtn.classList.remove('is-transmitting');
        if (label) label.textContent = 'HOLD TO TALK (SURVIVORS RADIO)';
        if (waveAnim) waveAnim.style.display = 'none';
        if (banner) banner.style.display = 'none';
        showTacticalToast('Microphone permission required for radio.', '⚠️');
        window.AndroidNative?.requestAudioPermission();
        return;
      }

      // Check if user already let go of the button during mic acquisition
      if (!isWalkieButtonHeld) {
        pttBtn.classList.remove('is-transmitting');
        if (label) label.textContent = 'HOLD TO TALK (SURVIVORS RADIO)';
        if (waveAnim) waveAnim.style.display = 'none';
        if (banner) banner.style.display = 'none';
        return;
      }

      isWalkieTransmitting = true;
      walkieAudioChunks = [];

      let mimeType = 'audio/webm;codecs=opus';
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
        }
      } else {
        mimeType = '';
      }

      try {
        walkieMediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        walkieMediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            walkieAudioChunks.push(event.data);
          }
        };

        walkieMediaRecorder.onstop = () => {
          if (walkieAudioChunks.length > 0) {
            const audioBlob = new Blob(walkieAudioChunks, { type: walkieMediaRecorder?.mimeType || 'audio/webm' });
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64Audio = reader.result;
              if (ws && ws.readyState === WebSocket.OPEN && base64Audio) {
                ws.send(JSON.stringify({
                  type: 'WALKIE_TALKIE_TRANSMIT',
                  audioData: base64Audio,
                  mimeType: audioBlob.type
                }));
              }
            };
            reader.readAsDataURL(audioBlob);
          }

          pttBtn.classList.remove('is-transmitting');
          if (label) label.textContent = 'HOLD TO TALK (SURVIVORS RADIO)';
          if (waveAnim) waveAnim.style.display = 'none';

          setTimeout(() => {
            if (banner && !banner.classList.contains('is-incoming')) {
              banner.style.display = 'none';
            }
          }, 600);
        };

        walkieMediaRecorder.start(100);
      } catch (err) {
        console.warn('MediaRecorder start error:', err);
        isWalkieTransmitting = false;
        isWalkieButtonHeld = false;
        pttBtn.classList.remove('is-transmitting');
      }
    };

    const stopTransmission = (e) => {
      if (e) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      }

      isWalkieButtonHeld = false;

      if (!isWalkieTransmitting) {
        pttBtn.classList.remove('is-transmitting');
        if (label) label.textContent = 'HOLD TO TALK (SURVIVORS RADIO)';
        if (waveAnim) waveAnim.style.display = 'none';
        if (banner && !banner.classList.contains('is-incoming')) {
          banner.style.display = 'none';
        }
        return;
      }

      isWalkieTransmitting = false;
      window.soundEngine?.playRadioEnd();
      if (navigator.vibrate) navigator.vibrate(25);

      if (walkieMediaRecorder && walkieMediaRecorder.state !== 'inactive') {
        try {
          walkieMediaRecorder.stop();
        } catch (err) {
          console.warn('MediaRecorder stop warning:', err);
        }
      }
    };

    // Use Pointer events (preferred across modern mobile & desktop)
    pttBtn.addEventListener('pointerdown', startTransmission);
    pttBtn.addEventListener('pointerup', stopTransmission);
    pttBtn.addEventListener('pointercancel', stopTransmission);

    // Touch fallback
    pttBtn.addEventListener('touchstart', startTransmission, { passive: false });
    pttBtn.addEventListener('touchend', stopTransmission, { passive: false });
    pttBtn.addEventListener('touchcancel', stopTransmission, { passive: false });

    // Mouse fallback
    pttBtn.addEventListener('mousedown', startTransmission);
    pttBtn.addEventListener('mouseup', stopTransmission);
    pttBtn.addEventListener('mouseleave', stopTransmission);

    pttBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Handle incoming Walkie-Talkie audio burst from another Survivor
  function handleWalkieTalkieReceive(data) {
    const isZombie = myAssignedRole === 'zombie' || myAssignedRole === 'hunter' || currentRole === 'zombie';
    if (isZombie) return; // Zombies cannot intercept survivor transmissions

    const banner = document.getElementById('walkie-talkie-banner');
    const bannerText = document.getElementById('walkie-talkie-banner-text');
    if (banner) {
      banner.classList.add('is-incoming');
      banner.style.display = 'flex';
      if (bannerText) {
        bannerText.textContent = `📻 ${escapeHtml(data.senderName || 'SURVIVOR').toUpperCase()}: TRANSMITTING...`;
      }
    }

    // Play radio squelch chirp
    window.soundEngine?.playRadioStart();

    // Play received voice transmission
    setTimeout(() => {
      try {
        const audio = new Audio(data.audioData);
        audio.volume = 1.0;
        audio.onended = () => {
          window.soundEngine?.playRadioEnd();
          setTimeout(() => {
            if (banner) {
              banner.classList.remove('is-incoming');
              banner.style.display = 'none';
            }
          }, 800);
        };
        audio.onerror = () => {
          if (banner) {
            banner.classList.remove('is-incoming');
            banner.style.display = 'none';
          }
        };
        audio.play().catch((err) => {
          console.warn('Audio autoplay failed:', err);
          if (banner) {
            banner.classList.remove('is-incoming');
            banner.style.display = 'none';
          }
        });
      } catch (err) {
        console.warn('Walkie-talkie audio parse failed:', err);
      }
    }, 70);
  }

  // --- ZOMBIES TACTICAL ACTIONS & MODAL BINDINGS ---

  // 1. Zombie TAP TO INFECT Burst Button
  document.getElementById('btn-zombie-infect-burst')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'TRIGGER_INFECTION_BURST' }));
    }
  });

  // 2. Powerup Slots 1 & 2 Tap to Activate
  document.getElementById('btn-powerup-slot-0')?.addEventListener('click', () => activatePowerupSlot(0));
  document.getElementById('btn-powerup-slot-1')?.addEventListener('click', () => activatePowerupSlot(1));

  function activatePowerupSlot(slotIdx) {
    if (!myPowerups[slotIdx]) {
      alert('This slot is empty! Visit a Supply Outpost (Health+) or Arena Hub to purchase powerups.');
      return;
    }
    const powerupId = myPowerups[slotIdx];
    const def = CLIENT_POWERUP_CATALOG[powerupId];
    if (confirm(`Activate ${def ? def.name : powerupId} now?`)) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ACTIVATE_POWERUP', powerupId }));
      }
    }
  }

  // 3. Powerup Shop Modal (Cleaned up - coins removed)
  document.getElementById('btn-close-shop')?.addEventListener('click', () => {
    const modal = document.getElementById('modal-powerup-shop');
    if (modal) modal.style.display = 'none';
  });

  // 4. My Personal QR & Tag Code Modal
  document.getElementById('btn-open-my-qr')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    const qrImg = document.getElementById('my-qr-img');
    const textCodeEl = document.getElementById('my-qr-text-code');

    if (qrImg) {
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(myTagCode)}`;
    }
    if (textCodeEl) {
      textCodeEl.textContent = myTagCode;
    }
    document.getElementById('modal-my-qr').style.display = 'flex';
  });

  document.getElementById('btn-close-my-qr')?.addEventListener('click', () => {
    document.getElementById('modal-my-qr').style.display = 'none';
  });

  // 5. QR Code Camera Scanner Modal
  let isScanningZombie = true;

  document.getElementById('btn-runner-tagged-action')?.addEventListener('click', () => {
    isScanningZombie = true; // Survivor scanning Zombie
    openScannerModal('ADMIT DEFEAT: SCAN ZOMBIE QR', 'Scan the QR code of the Zombie who tagged you:');
  });

  document.getElementById('btn-zombie-scan-victim')?.addEventListener('click', () => {
    isScanningZombie = false; // Zombie scanning Survivor
    openScannerModal('CLAIM BOUNTY: SCAN VICTIM QR', 'Scan the QR code of your victim to steal their bounty:');
  });

  document.getElementById('btn-close-scanner')?.addEventListener('click', closeScannerModal);

  function openScannerModal(title, desc) {
    window.soundEngine?.playClick();
    document.getElementById('scanner-modal-title').textContent = title;
    document.getElementById('scanner-modal-desc').textContent = desc;
    document.getElementById('modal-qr-scanner').style.display = 'flex';

    // Request camera stream
    const video = document.getElementById('scanner-video-preview');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && video) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' } })
        .then((stream) => {
          scannerStream = stream;
          video.srcObject = stream;
        })
        .catch((err) => console.warn('Camera preview unavailable, manual input active:', err));
    }
  }

  function closeScannerModal() {
    if (scannerStream) {
      scannerStream.getTracks().forEach((t) => t.stop());
      scannerStream = null;
    }
    document.getElementById('modal-qr-scanner').style.display = 'none';
  }

  document.getElementById('btn-submit-scanned-code')?.addEventListener('click', () => {
    const input = document.getElementById('manual-qr-code-input');
    const code = (input ? input.value : '').trim().toUpperCase();
    if (!code) {
      alert('Please enter or scan a valid tag code.');
      return;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      if (isScanningZombie) {
        ws.send(JSON.stringify({ type: 'CONFIRM_QR_TAG', scannedZombieCode: code }));
      } else {
        ws.send(JSON.stringify({ type: 'CONFIRM_QR_TAG', scannedVictimCode: code }));
      }
    }
    closeScannerModal();
    if (input) input.value = '';
  });



  // 7. Acknowledge Infection Dialog
  document.getElementById('btn-ack-infection')?.addEventListener('click', () => {
    document.getElementById('modal-infection-alert').style.display = 'none';
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

    if (msg.role === 'system') {
      msgEl.className = 'chat-msg system-alert';
      const isSafe = msg.senderName && msg.senderName.includes('SAFE');
      const headerColor = isSafe ? '#10b981' : '#ff3131';
      const headerTitle = msg.senderName || '☣️ TACTICAL ALERT';
      msgEl.innerHTML = `
        <div style="font-size: 10px; font-weight: 800; color: ${headerColor}; text-transform: uppercase; margin-bottom: 2px;">
          ${escapeHtml(headerTitle)}
        </div>
        <div class="chat-bubble" style="${isSafe ? 'border-color: #10b981; background: rgba(16, 185, 129, 0.15); color: #d1fae5 !important;' : ''}">${escapeHtml(msg.text)}</div>
      `;
      chatStream.appendChild(msgEl);
      chatStream.scrollTop = chatStream.scrollHeight;
      if (!isChatOpen) {
        unreadChatCount++;
        if (chatUnreadBadge) {
          chatUnreadBadge.textContent = unreadChatCount;
          chatUnreadBadge.style.display = 'flex';
        }
      }
      return;
    }

    msgEl.className = `chat-msg ${isMe ? 'outgoing' : 'incoming'}`;

    const isZombie = msg.role === 'zombie' || msg.role === 'hunter';
    const roleClass = isZombie ? 'chat-badge-zombie' : 'chat-badge-survivor';
    const roleIcon = isZombie ? '💀' : '🏃';
    const timeFormatted = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let photoHtml = '';
    if (msg.photoUrl) {
      photoHtml = `<div class="chat-photo-wrapper"><img src="${msg.photoUrl}" alt="Intel Photo" class="chat-attached-photo" onclick="window.viewPhotoLightbox('${msg.photoUrl}')"></div>`;
    }

    msgEl.innerHTML = `
      <div class="chat-msg-header">
        <span class="chat-sender-badge ${roleClass}">${roleIcon} ${escapeHtml(msg.senderName)}</span>
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
  // OFFICIAL FIELD MANUAL & GAME RULES MODAL
  // =========================================================
  function openTutorialModal() {
    window.soundEngine?.playClick();
    const modal = document.getElementById('tutorial-modal');
    if (!modal) return;
    modal.classList.add('active');
    const bodyRules = document.getElementById('tutorial-content-rules');
    if (bodyRules) bodyRules.classList.add('active');
  }

  function closeTutorialModal() {
    const modal = document.getElementById('tutorial-modal');
    if (modal) modal.classList.remove('active');
  }

  // Field Manual open/close listeners
  document.getElementById('btn-open-tutorial')?.addEventListener('click', openTutorialModal);
  document.getElementById('btn-open-tutorial-card')?.addEventListener('click', openTutorialModal);
  document.getElementById('btn-hud-help')?.addEventListener('click', openTutorialModal);
  document.getElementById('btn-close-tutorial')?.addEventListener('click', closeTutorialModal);

  document.getElementById('tutorial-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'tutorial-modal') closeTutorialModal();
  });

  // GPS & Map Refresh Controls
  document.getElementById('btn-refresh-map')?.addEventListener('click', refreshPlayerGpsAndMap);
  document.getElementById('btn-map-recenter-gps')?.addEventListener('click', refreshPlayerGpsAndMap);

  // --- MATCH EXIT CONFIRMATION MODAL & NAVIGATION ---
  const matchExitModal = document.getElementById('match-exit-modal');
  function openMatchExitModal() {
    window.soundEngine?.playClick();
    if (matchExitModal) {
      matchExitModal.style.display = 'flex';
      matchExitModal.classList.add('active');
    }
  }

  function closeMatchExitModal() {
    window.soundEngine?.playClick();
    if (matchExitModal) {
      matchExitModal.style.display = 'none';
      matchExitModal.classList.remove('active');
    }
  }

  function leaveActiveMatchAndGoHome() {
    closeMatchExitModal();
    window.soundEngine?.playClick();

    if (activeGameClockInterval) {
      clearInterval(activeGameClockInterval);
      activeGameClockInterval = null;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
      } catch (e) {}
    }
    currentRoomCode = null;
    currentRoomData = null;
    sessionStorage.removeItem('RFYL_ACTIVE_ROOM');
    showScreen('landing');
    showTacticalToast('Returned to Tactical Headquarters', '🏠');
  }

  document.getElementById('btn-hud-leave-match')?.addEventListener('click', openMatchExitModal);
  document.getElementById('btn-cancel-exit-match')?.addEventListener('click', closeMatchExitModal);
  document.getElementById('btn-confirm-exit-match')?.addEventListener('click', leaveActiveMatchAndGoHome);
  matchExitModal?.addEventListener('click', (e) => {
    if (e.target.id === 'match-exit-modal') closeMatchExitModal();
  });

  // --- ANDROID HARDWARE BACK BUTTON INTERCEPTION ---
  let lastBackPressTime = 0;

  function closeAnyActiveModal() {
    const modals = [
      document.getElementById('tutorial-modal'),
      document.getElementById('modal-services-status'),
      document.getElementById('modal-my-qr'),
      document.getElementById('match-exit-modal'),
      document.getElementById('tag-modal'),
      document.getElementById('photo-lightbox-modal'),
      document.getElementById('location-permission-modal')
    ];
    let closedAny = false;
    modals.forEach((m) => {
      if (m && (m.classList.contains('active') || m.style.display === 'flex' || m.style.display === 'block')) {
        m.classList.remove('active');
        m.style.display = 'none';
        closedAny = true;
      }
    });

    const chatDrawer = document.getElementById('chat-drawer');
    if (chatDrawer && chatDrawer.classList.contains('open')) {
      chatDrawer.classList.remove('open');
      isChatOpen = false;
      closedAny = true;
    }
    return closedAny;
  }

  window.handleAndroidBackButton = function () {
    // 1. If any modal or drawer is open, dismiss it
    if (closeAnyActiveModal()) {
      return true;
    }

    // 2. Identify currently active screen
    const currentActiveScreen = Object.entries(screens).find(([_, el]) => el?.classList.contains('active'))?.[0];

    // 3. If in gameplay (hunt or scatter), prompt to abandon match instead of killing the app
    if (currentActiveScreen === 'hunt' || currentActiveScreen === 'scatter') {
      openMatchExitModal();
      return true;
    }

    // 4. If in lobby, host setup, join, or game-over, return to landing screen
    if (currentActiveScreen === 'lobby' || currentActiveScreen === 'hostSetup' || currentActiveScreen === 'join' || currentActiveScreen === 'gameOver') {
      leaveActiveMatchAndGoHome();
      return true;
    }

    // 5. If already on landing screen, require double tap to exit whole app
    if (currentActiveScreen === 'landing') {
      const now = Date.now();
      if (now - lastBackPressTime < 2500) {
        return 'exit_app';
      }
      lastBackPressTime = now;
      showTacticalToast('Press BACK again to exit app', '🚪');
      return true;
    }

    return false;
  };

  setupWalkieTalkie();


  // --- TACTICAL HARDWARE & SENSOR SERVICES (PLAYCULTURE MATCH) ---
  const RANDOM_CODENAMES = [
    'Phantom', 'Vesper', 'Nomad', 'Viper', 'Cipher', 'Specter',
    'Shadow', 'Rogue', 'Valkyrie', 'Ronin', 'Pulse', 'Apex',
    'Ghost', 'Reaper', 'Falcon', 'Striker', 'Echo', 'Wraith'
  ];

  document.getElementById('btn-random-name')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    const pick = RANDOM_CODENAMES[Math.floor(Math.random() * RANDOM_CODENAMES.length)];
    const input = document.getElementById('player-name-input');
    if (input) {
      input.value = pick;
      localStorage.setItem('RFYL_PLAYER_NAME', pick);
      sessionStorage.setItem('RFYL_PLAYER_NAME', pick);
    }
  });

  // Services Modal Open / Close
  const modalServices = document.getElementById('modal-services-status');
  function openServicesModal() {
    window.soundEngine?.playClick();
    if (modalServices) {
      modalServices.classList.add('active');
      modalServices.style.display = 'flex';
      refreshHardwareStatus();
    }
  }

  function closeServicesModal() {
    window.soundEngine?.playClick();
    if (modalServices) {
      modalServices.classList.remove('active');
      modalServices.style.display = 'none';
    }
  }

  document.getElementById('btn-open-services')?.addEventListener('click', openServicesModal);
  document.getElementById('btn-close-services')?.addEventListener('click', closeServicesModal);
  document.getElementById('btn-done-services')?.addEventListener('click', closeServicesModal);

  // Top pills and dock click to open services
  ['pill-net', 'pill-gps', 'pill-ble', 'pill-cam', 'sensor-status-dock'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', openServicesModal);
  });

  // Native Permission Triggers
  document.getElementById('btn-grant-gps')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    if (window.AndroidNative && window.AndroidNative.requestLocationPermission) {
      window.AndroidNative.requestLocationPermission();
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => refreshHardwareStatus(),
        () => refreshHardwareStatus()
      );
    }
  });

  document.getElementById('btn-settings-gps')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    if (window.AndroidNative && window.AndroidNative.openAppSettings) {
      window.AndroidNative.openAppSettings();
    }
  });

  document.getElementById('btn-grant-ble')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    if (window.AndroidNative && window.AndroidNative.requestBluetoothPermission) {
      window.AndroidNative.requestBluetoothPermission();
    } else {
      alert('Bluetooth Low Energy (BLE) beaconing is active in native Android app.');
    }
  });

  document.getElementById('btn-settings-ble')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    if (window.AndroidNative && window.AndroidNative.openAppSettings) {
      window.AndroidNative.openAppSettings();
    }
  });

  document.getElementById('btn-grant-cam')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    if (window.AndroidNative && window.AndroidNative.requestCameraPermission) {
      window.AndroidNative.requestCameraPermission();
    } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then((stream) => {
          stream.getTracks().forEach((t) => t.stop());
          refreshHardwareStatus();
        })
        .catch(() => refreshHardwareStatus());
    }
  });

  document.getElementById('btn-settings-cam')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    if (window.AndroidNative && window.AndroidNative.openAppSettings) {
      window.AndroidNative.openAppSettings();
    }
  });

  document.getElementById('btn-refresh-net')?.addEventListener('click', () => {
    window.soundEngine?.playClick();
    initWebSocket();
    refreshHardwareStatus();
  });

  let lastPingMs = 12;
  function refreshHardwareStatus() {
    let locGranted = false;
    let bleGranted = false;
    let camGranted = false;

    if (window.AndroidNative && window.AndroidNative.checkPermissions) {
      try {
        const raw = window.AndroidNative.checkPermissions();
        const info = JSON.parse(raw);
        locGranted = !!info.location;
        bleGranted = !!info.bluetooth;
        camGranted = !!info.camera;
      } catch (e) {
        console.error('Error querying AndroidNative:', e);
      }
    } else {
      // In web browser fallback
      locGranted = hasLocationPermission;
      bleGranted = true; // Simulated in browser
      camGranted = true;
    }

    // 1. Update Network UI
    const isNetOpen = ws && ws.readyState === WebSocket.OPEN;
    const badgeNet = document.getElementById('badge-net-status');
    const pillNet = document.getElementById('pill-net');
    const netDetails = document.getElementById('service-net-details');
    const netPing = document.getElementById('net-ping-display');

    if (isNetOpen) {
      if (badgeNet) { badgeNet.textContent = 'CONNECTED'; badgeNet.className = 'service-badge-pill green'; }
      if (pillNet) { pillNet.innerHTML = '<span class="pill-dot green"></span>NET'; }
      if (netPing) { netPing.textContent = lastPingMs; }
      if (netDetails) { netDetails.textContent = `WebSocket low-latency loop active (${ws.url || 'localhost'})`; }
    } else {
      if (badgeNet) { badgeNet.textContent = 'CONNECTING'; badgeNet.className = 'service-badge-pill amber'; }
      if (pillNet) { pillNet.innerHTML = '<span class="pill-dot red"></span>NET'; }
    }

    // 2. Update GPS UI
    const badgeGps = document.getElementById('badge-gps-status');
    const pillGps = document.getElementById('pill-gps');
    const iconboxGps = document.getElementById('iconbox-gps');
    const gpsDetails = document.getElementById('service-gps-details');
    const btnGrantGps = document.getElementById('btn-grant-gps');

    if (locGranted || hasLocationPermission) {
      if (badgeGps) { badgeGps.textContent = 'ACTIVE (LOCKED)'; badgeGps.className = 'service-badge-pill green'; }
      if (pillGps) { pillGps.innerHTML = '<span class="pill-dot green"></span>GPS'; }
      if (iconboxGps) { iconboxGps.className = 'service-icon-box status-active'; }
      if (gpsDetails) {
        gpsDetails.textContent = (myPosition && myPosition.lat)
          ? `Coords: ${myPosition.lat.toFixed(5)}, ${myPosition.lng.toFixed(5)} (±8m)`
          : 'High-Accuracy GPS satellite lock acquired';
      }
      if (btnGrantGps) { btnGrantGps.style.display = 'none'; }
    } else {
      if (badgeGps) { badgeGps.textContent = 'PERMISSION NEEDED'; badgeGps.className = 'service-badge-pill'; }
      if (pillGps) { pillGps.innerHTML = '<span class="pill-dot red"></span>GPS'; }
      if (iconboxGps) { iconboxGps.className = 'service-icon-box status-warning'; }
      if (btnGrantGps) { btnGrantGps.style.display = 'inline-block'; }
    }

    // 3. Update BLE UI
    const badgeBle = document.getElementById('badge-ble-status');
    const pillBle = document.getElementById('pill-ble');
    const iconboxBle = document.getElementById('iconbox-ble');
    const bleDetails = document.getElementById('service-ble-details');
    const btnGrantBle = document.getElementById('btn-grant-ble');

    if (bleGranted) {
      if (badgeBle) { badgeBle.textContent = 'ACTIVE'; badgeBle.className = 'service-badge-pill green'; }
      if (pillBle) { pillBle.innerHTML = '<span class="pill-dot green"></span>BLE'; }
      if (iconboxBle) { iconboxBle.className = 'service-icon-box status-active'; }
      if (bleDetails) { bleDetails.textContent = 'Bluetooth 10m Zombie Proximity Bursts ready'; }
      if (btnGrantBle) { btnGrantBle.style.display = 'none'; }
    } else {
      if (badgeBle) { badgeBle.textContent = 'PERMISSION NEEDED'; badgeBle.className = 'service-badge-pill'; }
      if (pillBle) { pillBle.innerHTML = '<span class="pill-dot red"></span>BLE'; }
      if (iconboxBle) { iconboxBle.className = 'service-icon-box status-warning'; }
      if (btnGrantBle) { btnGrantBle.style.display = 'inline-block'; }
    }

    // 4. Update Camera UI
    const badgeCam = document.getElementById('badge-cam-status');
    const pillCam = document.getElementById('pill-cam');
    const iconboxCam = document.getElementById('iconbox-cam');
    const camDetails = document.getElementById('service-cam-details');
    const btnGrantCam = document.getElementById('btn-grant-cam');

    if (camGranted) {
      if (badgeCam) { badgeCam.textContent = 'READY'; badgeCam.className = 'service-badge-pill green'; }
      if (pillCam) { pillCam.innerHTML = '<span class="pill-dot green"></span>CAM'; }
      if (iconboxCam) { iconboxCam.className = 'service-icon-box status-active'; }
      if (camDetails) { camDetails.textContent = 'Optic scanner ready for personal QR verification'; }
      if (btnGrantCam) { btnGrantCam.style.display = 'none'; }
    } else {
      if (badgeCam) { badgeCam.textContent = 'NOT GRANTED'; badgeCam.className = 'service-badge-pill'; }
      if (pillCam) { pillCam.innerHTML = '<span class="pill-dot amber"></span>CAM'; }
      if (iconboxCam) { iconboxCam.className = 'service-icon-box'; }
      if (btnGrantCam) { btnGrantCam.style.display = 'inline-block'; }
    }

    // Summary badge on Landing card
    const summaryBadge = document.getElementById('landing-services-status');
    if (summaryBadge) {
      if (locGranted && bleGranted && isNetOpen) {
        summaryBadge.textContent = 'ALL SENSORS READY ✓';
        summaryBadge.className = 'services-status-pill';
      } else {
        summaryBadge.textContent = 'ACTION REQUIRED ⚠️';
        summaryBadge.className = 'services-status-pill warning';
      }
    }
  }

  // Periodic poll of hardware status & on window focus
  setInterval(refreshHardwareStatus, 3000);
  window.addEventListener('focus', refreshHardwareStatus);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshHardwareStatus();
  });
  // Initial check on load
  setTimeout(refreshHardwareStatus, 600);

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
  // --- SCREEN WAKE LOCK UTILITY (Prevents phone sleep during outdoor play) ---
  async function requestScreenWakeLock() {
    try {
      if ('wakeLock' in navigator && !screenWakeLock) {
        screenWakeLock = await navigator.wakeLock.request('screen');
        screenWakeLock.addEventListener('release', () => {
          screenWakeLock = null;
        });
      }
    } catch (err) {
      console.warn('Wake Lock request warning:', err);
    }
  }

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && !screenWakeLock) {
      const activeState = currentRoomData?.state;
      if (activeState === 'THE_HUNT' || activeState === 'HEAD_START' || activeState === 'EXTRACTION') {
        await requestScreenWakeLock();
      }
    }
  });

  // --- 1-CLICK CLOUD OVER-THE-AIR (OTA) LIVE UPDATER ---
  function setupLiveUpdater() {
    const updateButtons = [
      document.getElementById('btn-sync-update-cloud'),
      document.getElementById('btn-cloud-hot-update'),
      document.getElementById('btn-hud-sync-update')
    ].filter(Boolean);

    const versionBadge = document.getElementById('hot-update-version-label');

    // Query version on initial boot
    fetch('/api/version?_t=' + Date.now(), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && versionBadge && data.version) {
          versionBadge.textContent = `${data.version} • LIVE SYNC`;
        }
      })
      .catch(() => {});

    let isUpdating = false;

    async function triggerUpdate() {
      if (isUpdating) return;
      isUpdating = true;

      window.soundEngine?.playClick();
      if (navigator.vibrate) navigator.vibrate([40, 60, 40]);

      showTacticalToast('⚡ Checking cloud for updates...', '📡');
      updateButtons.forEach((btn) => btn.classList.add('updating-spin'));

      try {
        const resp = await fetch('/api/version?_t=' + Date.now(), {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store' }
        });

        const info = resp.ok ? await resp.json() : null;

        // Clear all CacheStorage if present
        if ('caches' in window) {
          try {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map((name) => caches.delete(name)));
          } catch (e) {
            console.warn('Cache clearing notice:', e);
          }
        }

        const buildLabel = info?.version ? `${info.version} (${info.build})` : 'Production Cloud';
        showTacticalToast(`🚀 Updating to ${buildLabel}...`, '⚡');

        setTimeout(() => {
          const targetUrl = window.location.origin + window.location.pathname + '?_ota=' + Date.now();
          window.location.replace(targetUrl);
        }, 700);
      } catch (err) {
        console.warn('OTA Sync fallback to reload:', err);
        showTacticalToast('🔄 Syncing fresh code from cloud...', '⚡');
        setTimeout(() => {
          window.location.reload(true);
        }, 700);
      }
    }

    updateButtons.forEach((btn) => {
      btn.addEventListener('click', triggerUpdate);
    });
  }

  setupLiveUpdater();
})();
