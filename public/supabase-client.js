// Supabase Realtime & Database Integration for "Run for Your Life"
// Developed by Shopifydevstudio

class SupabaseGameManager {
  constructor() {
    this.client = null;
    this.channel = null;
    this.roomCode = null;
    this.playerId = null;
    this.isOnline = false;

    // Live Supabase project configuration (Parth7487's Project)
    this.supabaseUrl = localStorage.getItem('RFYL_SUPABASE_URL') || 'https://ceyhsgzoouysumwfgqee.supabase.co';
    this.supabaseAnonKey = localStorage.getItem('RFYL_SUPABASE_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNleWhzZ3pvb3V5c3Vtd2ZncWVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNDI0ODUsImV4cCI6MjEwNzgxODQ4NX0.zFFxqgxtCSD0tcTUBUkNavkzyz_7VoRWL7WkwryyI0U';
    
    this.initClient();
  }

  initClient() {
    try {
      if (window.supabase && this.supabaseUrl && this.supabaseAnonKey) {
        this.client = window.supabase.createClient(this.supabaseUrl, this.supabaseAnonKey, {
          realtime: {
            params: {
              eventsPerSecond: 10
            }
          }
        });
        this.isOnline = true;
      }
    } catch (e) {
      console.warn('Supabase client initialization warning:', e);
      this.isOnline = false;
    }
  }

  updateCredentials(url, key) {
    this.supabaseUrl = url;
    this.supabaseAnonKey = key;
    localStorage.setItem('RFYL_SUPABASE_URL', url);
    localStorage.setItem('RFYL_SUPABASE_KEY', key);
    this.initClient();
  }

  async connectToRoom(roomCode, player, onEvent, onPresenceSync) {
    this.roomCode = roomCode;
    this.playerId = player.id;

    if (!this.client) {
      console.log('Supabase client unavailable, using fallback realtime channel.');
      return false;
    }

    try {
      if (this.channel) {
        this.client.removeChannel(this.channel);
      }

      this.channel = this.client.channel(`rfyl:${roomCode}`, {
        config: {
          broadcast: { self: false },
          presence: { key: player.id }
        }
      });

      // 1. Listen for tactical broadcasts
      this.channel
        .on('broadcast', { event: 'location_update' }, ({ payload }) => {
          onEvent({ type: 'LOCATION_UPDATE', payload });
        })
        .on('broadcast', { event: 'ping_fired' }, ({ payload }) => {
          onEvent({ type: 'PING_FIRED', payload });
        })
        .on('broadcast', { event: 'hunter_ping_fired' }, ({ payload }) => {
          onEvent({ type: 'HUNTER_PING_FIRED', payload });
        })
        .on('broadcast', { event: 'player_tagged' }, ({ payload }) => {
          onEvent({ type: 'PLAYER_TAGGED', payload });
        })
        .on('broadcast', { event: 'chat_message' }, ({ payload }) => {
          onEvent({ type: 'CHAT_MESSAGE', payload });
        })
        .on('broadcast', { event: 'player_disconnected_buffer' }, ({ payload }) => {
          onEvent({ type: 'PLAYER_DISCONNECTED_BUFFER', payload });
        })
        .on('broadcast', { event: 'player_reconnected' }, ({ payload }) => {
          onEvent({ type: 'PLAYER_RECONNECTED', payload });
        })
        .on('broadcast', { event: 'phase_change' }, ({ payload }) => {
          onEvent({ type: 'PHASE_CHANGED', payload });
        })
        .on('broadcast', { event: 'room_state' }, ({ payload }) => {
          onEvent({ type: 'ROOM_STATE', payload });
        })
        .on('broadcast', { event: 'game_over' }, ({ payload }) => {
          onEvent({ type: 'GAME_OVER', payload });
        });

      // 2. Track Presence
      this.channel.on('presence', { event: 'sync' }, () => {
        const state = this.channel.presenceState();
        const players = [];
        for (const key of Object.keys(state)) {
          const presenceList = state[key];
          if (presenceList && presenceList.length > 0) {
            players.push(presenceList[0]);
          }
        }
        if (onPresenceSync) onPresenceSync(players);
      });

      // Subscribe and track
      await this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.channel.track({
            id: player.id,
            name: player.name,
            rolePreference: player.rolePreference,
            assignedRole: player.assignedRole,
            lat: player.lat,
            lng: player.lng,
            isTagged: player.isTagged || false
          });
        }
      });

      return true;
    } catch (err) {
      console.error('Supabase room connection error:', err);
      return false;
    }
  }

  async broadcastEvent(eventName, payload) {
    if (this.channel) {
      try {
        await this.channel.send({
          type: 'broadcast',
          event: eventName,
          payload
        });
      } catch (err) {
        console.warn('Broadcast failed:', err);
      }
    }
  }

  async updatePresence(playerData) {
    if (this.channel) {
      try {
        await this.channel.track(playerData);
      } catch (err) {
        console.warn('Presence update failed:', err);
      }
    }
  }

  async sendChatMessage(messageData) {
    if (this.channel) {
      try {
        await this.channel.send({
          type: 'broadcast',
          event: 'chat_message',
          payload: messageData
        });
        this.saveMessageToDb(messageData);
      } catch (err) {
        console.warn('Chat broadcast failed:', err);
      }
    }
  }

  async saveMessageToDb(msg) {
    if (!this.client || !this.roomCode) return;
    try {
      await this.client.from('game_messages').insert({
        room_code: this.roomCode,
        sender_id: msg.senderId,
        sender_name: msg.senderName,
        role: msg.role,
        message: msg.text,
        photo_url: msg.photoUrl
      });
    } catch (e) {
      // Non-blocking fallback
    }
  }

  async saveRoomToDb(roomData) {
    if (!this.client) return;
    try {
      await this.client.from('rooms').upsert({
        code: roomData.code,
        host_id: roomData.hostId,
        state: roomData.state,
        arena: roomData.config.arena,
        settings: {
          roundLength: roomData.config.roundLength,
          headStart: roomData.config.headStart,
          hunterPingInterval: roomData.config.hunterPingInterval || 30,
          runnerPingInterval: roomData.config.runnerPingInterval || 50
        },
        time_remaining: roomData.timeRemaining
      });
    } catch (e) {
      console.warn('Database save room error (continuing with realtime):', e);
    }
  }
}

window.supabaseGameManager = new SupabaseGameManager();
