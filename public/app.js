// RUN FOR YOUR LIFE: WebApp Client
// Designed and developed by Shopifydevstudio

(() => {
  'use strict';

  // State
  let ws = null;
  let myPlayerId = 'p_' + Math.random().toString(36).substring(2, 9);
  let myRoomCode = null;
  let isHost = false;
  let currentRole = 'random';
  let myAssignedRole = null; // 'hunter' | 'runner'
  let myPosition = { lat: 37.7749, lng: -122.4194 }; // Default San Francisco
  let myPath = [];
  let useSimulationGps = false; // Will be set by permission prompt
  let hasLocationPermission = false;
  let watchPositionId = null;
  let pendingActionAfterPermission = null;

  // Maps
  let setupMap = null;
  let setupCircle = null;
  let gameMap = null;
  let gameCircle = null;
  let myMarker = null;
  let hunterMarkers = new Map();
  let runnerPingMarkers = new Map();
  let currentRoomData = null;

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

  // Auto-transition from splash after 1.4s
  setTimeout(() => {
    showScreen('landing');
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      document.getElementById('join-code-input').value = roomParam.toUpperCase();
      showScreen('join');
    }
  }, 1400);

  // Initialize WebSocket (Local & fallback)
  function initWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Connected to local game server');
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

  // Handle Server & Supabase Messages
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'ROOM_CREATED':
        myPlayerId = msg.playerId || myPlayerId;
        myRoomCode = msg.roomCode;
        isHost = true;
        document.getElementById('lobby-code-display').textContent = myRoomCode;
        document.getElementById('lobby-big-code').textContent = myRoomCode;
        document.getElementById('btn-start-game').style.display = 'block';
        document.getElementById('host-waiting-msg').style.display = 'none';
        showScreen('lobby');
        connectToSupabaseRoom(myRoomCode);
        break;

      case 'ROOM_JOINED':
        myPlayerId = msg.playerId || myPlayerId;
        myRoomCode = msg.roomCode;
        isHost = false;
        document.getElementById('lobby-code-display').textContent = myRoomCode;
        document.getElementById('lobby-big-code').textContent = myRoomCode;
        document.getElementById('btn-start-game').style.display = 'none';
        document.getElementById('host-waiting-msg').style.display = 'block';
        showScreen('lobby');
        connectToSupabaseRoom(myRoomCode);
        break;

      case 'ROOM_STATE':
        currentRoomData = msg;
        updateLobbyUI(msg);
        break;

      case 'PHASE_CHANGED':
        currentRoomData = msg;
        handlePhaseChange(msg);
        break;

      case 'CLOCK_TICK':
        handleClockTick(msg);
        break;

      case 'PING_FIRED':
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

      case 'ERROR':
        alert(msg.message);
        break;
    }
  }

  // Supabase Realtime Bridge
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
        // Handle broadcast events from other Supabase peers
        if (event.type === 'LOCATION_UPDATE') {
          handlePeerLocation(event.payload);
        } else if (event.type === 'PING_FIRED') {
          handlePingFired(event.payload);
        } else if (event.type === 'PLAYER_TAGGED') {
          handlePlayerTagged(event.payload);
        } else if (event.type === 'PHASE_CHANGED') {
          handlePhaseChange(event.payload);
        } else if (event.type === 'GAME_OVER') {
          handleGameOver(event.payload);
        }
      },
      (presencePlayers) => {
        // Update presence in lobby
        if (presencePlayers && presencePlayers.length > 0) {
          updateLobbyWithPresence(presencePlayers);
        }
      }
    );
  }

  function handlePeerLocation(payload) {
    if (payload.playerId === myPlayerId) return;
    if (myAssignedRole === 'hunter' && payload.role === 'hunter') {
      updateHunterPositions([{ id: payload.playerId, name: payload.name, lat: payload.lat, lng: payload.lng }]);
    }
  }

  function updateLobbyWithPresence(presencePlayers) {
    if (currentRoomData?.state && currentRoomData.state !== 'LOBBY') return;
    const formattedPlayers = presencePlayers.map((p) => ({
      id: p.id,
      name: p.name,
      rolePreference: p.rolePreference || 'random',
      assignedRole: p.assignedRole,
      connected: true,
      isTagged: p.isTagged || false
    }));
    updateLobbyUI({ players: formattedPlayers });
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
    window.soundEngine.playClick();
    document.getElementById('location-permission-modal').classList.remove('active');

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          hasLocationPermission = true;
          useSimulationGps = false;
          myPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          document.getElementById('btn-toggle-gps').textContent = '🛰️ GPS';
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
          document.getElementById('btn-toggle-gps').textContent = '🕹️ Sim';
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
    window.soundEngine.playClick();
    document.getElementById('location-permission-modal').classList.remove('active');
    hasLocationPermission = true;
    useSimulationGps = true;
    document.getElementById('btn-toggle-gps').textContent = '🕹️ Sim';
    document.getElementById('joystick').style.display = 'flex';
    if (pendingActionAfterPermission) {
      pendingActionAfterPermission();
      pendingActionAfterPermission = null;
    }
  });

  // Sound Toggle
  document.getElementById('sound-btn').addEventListener('click', () => {
    window.soundEngine.muted = !window.soundEngine.muted;
    document.getElementById('sound-btn').textContent = window.soundEngine.muted ? '🔇' : '🔊';
  });

  // Settings Modal (Supabase Configuration)
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    window.soundEngine.playClick();
    document.getElementById('supabase-url-input').value = window.supabaseGameManager.supabaseUrl;
    document.getElementById('supabase-key-input').value = window.supabaseGameManager.supabaseAnonKey;
    document.getElementById('settings-modal').classList.add('active');
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('active');
  });

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    window.soundEngine.playClick();
    const url = document.getElementById('supabase-url-input').value.trim();
    const key = document.getElementById('supabase-key-input').value.trim();
    window.supabaseGameManager.updateCredentials(url, key);
    alert('Supabase credentials updated! Realtime channel reconnected.');
    document.getElementById('settings-modal').classList.remove('active');
  });

  // --- SCREEN NAVIGATION & SETUP ---

  document.getElementById('btn-open-host').addEventListener('click', () => {
    window.soundEngine.playClick();
    requestLocationPermission(() => {
      showScreen('hostSetup');
      initSetupMap();
    });
  });

  document.getElementById('host-back-btn').addEventListener('click', () => {
    window.soundEngine.playClick();
    showScreen('landing');
  });

  document.getElementById('btn-open-join').addEventListener('click', () => {
    window.soundEngine.playClick();
    requestLocationPermission(() => {
      showScreen('join');
    });
  });

  document.getElementById('join-back-btn').addEventListener('click', () => {
    window.soundEngine.playClick();
    showScreen('landing');
  });

  // Setup Map (Draggable Arena Geofence)
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

  // Confirm Create Room
  document.getElementById('btn-confirm-create-room').addEventListener('click', () => {
    window.soundEngine.playClick();
    const name = document.getElementById('player-name-input').value.trim() || 'Operative One';
    const center = setupMap.getCenter();
    const radius = parseInt(document.getElementById('radius-slider').value, 10);
    const roundLength = parseInt(document.getElementById('round-length-select').value, 10);
    const pingInterval = parseInt(document.getElementById('ping-interval-select').value, 10);

    const arena = { lat: center.lat, lng: center.lng, radius };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'CREATE_ROOM',
          name,
          arena,
          roundLength,
          pingInterval,
          headStart: 180
        })
      );
    } else {
      // Direct client room creation if serverless / Vercel
      const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      handleServerMessage({
        type: 'ROOM_CREATED',
        roomCode: randomCode,
        playerId: myPlayerId
      });
      window.supabaseGameManager.saveRoomToDb({
        code: randomCode,
        hostId: myPlayerId,
        state: 'LOBBY',
        config: { arena, roundLength, pingInterval, headStart: 180 },
        timeRemaining: roundLength
      });
    }
  });

  // Submit Join Room
  document.getElementById('btn-submit-join').addEventListener('click', () => {
    window.soundEngine.playClick();
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();
    const name = document.getElementById('player-name-input').value.trim() || 'Operative ' + Math.floor(Math.random() * 90 + 10);

    if (code.length !== 6) {
      alert('Please enter a valid 6-letter room code.');
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
      // Direct client join
      handleServerMessage({
        type: 'ROOM_JOINED',
        roomCode: code,
        playerId: myPlayerId
      });
    }
  });

  // Copy Room Link
  document.getElementById('btn-copy-code').addEventListener('click', () => {
    window.soundEngine.playClick();
    const url = `${window.location.origin}?room=${myRoomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      document.getElementById('btn-copy-code').textContent = 'Copied!';
      setTimeout(() => (document.getElementById('btn-copy-code').textContent = 'Copy Link'), 2000);
    });
  });

  // Role Selection Cards in Lobby
  document.querySelectorAll('.role-card').forEach((card) => {
    card.addEventListener('click', () => {
      window.soundEngine.playClick();
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

  // Start Game Button (Host only)
  document.getElementById('btn-start-game').addEventListener('click', () => {
    window.soundEngine.playClick();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'START_GAME' }));
    } else {
      // Local / Supabase broadcast start
      const startPayload = {
        state: 'HEAD_START',
        timeRemaining: 180,
        players: [{ id: myPlayerId, assignedRole: currentRole === 'hunter' ? 'hunter' : 'runner' }]
      };
      window.supabaseGameManager.broadcastEvent('phase_change', startPayload);
      handlePhaseChange(startPayload);
    }
  });

  // Update Lobby UI
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
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  }

  // --- PHASE MANAGEMENT ---

  function handlePhaseChange(data) {
    const me = data.players?.find((p) => p.id === myPlayerId);
    if (me && me.assignedRole) {
      myAssignedRole = me.assignedRole;
    } else if (!myAssignedRole) {
      myAssignedRole = currentRole === 'hunter' ? 'hunter' : 'runner';
    }

    if (data.state === 'HEAD_START') {
      showScreen('scatter');
      window.soundEngine.playHeartbeat();

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

      startLocationTracking();
    } else if (data.state === 'HUNT') {
      showScreen('hunt');
      window.soundEngine.playPing();
      initGameMap();
      updateGameHUD();
      startLocationTracking();
    }
  }

  function handleClockTick(data) {
    if (data.state === 'HEAD_START') {
      document.getElementById('scatter-timer-text').textContent = formatTime(data.timeRemaining);
      const totalHeadStart = currentRoomData?.config?.headStart || 180;
      const progressPercent = (data.timeRemaining / totalHeadStart) * 100;
      document.getElementById('scatter-progress-bar').style.width = `${progressPercent}%`;

      if (data.timeRemaining <= 10) {
        window.soundEngine.playHeartbeat(true);
      }
    } else if (data.state === 'HUNT') {
      document.getElementById('hud-game-clock').textContent = formatTime(data.timeRemaining);
      document.getElementById('hud-ping-clock').textContent = formatTime(data.nextPingIn);

      if (data.nextPingIn <= 5 && data.nextPingIn > 0) {
        window.soundEngine.playHeartbeat(false);
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
    window.soundEngine.playPing();
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
    window.soundEngine.playTagAlarm();
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
    window.soundEngine.playFanfare();
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

    const durationMin = Math.round(msg.stats?.durationSeconds / 60) || 1;
    document.getElementById('stat-match-duration').textContent = `${durationMin} min`;
    document.getElementById('stat-match-pings').textContent = `${msg.stats?.totalPings || 0} pings`;
  }

  document.getElementById('btn-return-lobby').addEventListener('click', () => {
    window.soundEngine.playClick();
    showScreen('landing');
  });

  // Force Ping Test Button
  document.getElementById('btn-force-ping').addEventListener('click', () => {
    window.soundEngine.playClick();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'FORCE_PING' }));
    }
  });

  // Toggle GPS vs Simulation Joystick
  document.getElementById('btn-toggle-gps').addEventListener('click', () => {
    useSimulationGps = !useSimulationGps;
    document.getElementById('btn-toggle-gps').textContent = useSimulationGps ? '🕹️ Sim' : '🛰️ GPS';
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
    window.soundEngine.playClick();
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
        btn.textContent = `🎯 Tag ${r.name}`;
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
      window.soundEngine.playClick();
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
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
