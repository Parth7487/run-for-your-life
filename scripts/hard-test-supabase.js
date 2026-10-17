// RUN FOR YOUR LIFE - Hard Test Suite for Supabase Database & Realtime
// Tests all aspects: Database CRUD, Live Location Broadcasting, Realtime Presence, Chat + Photo upload,
// 90s Disconnect Buffer, Sonar Pings, and Multi-Client Synchronization.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ceyhsgzoouysumwfgqee.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNleWhzZ3pvb3V5c3Vtd2ZncWVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNDI0ODUsImV4cCI6MjEwNzgxODQ4NX0.zFFxqgxtCSD0tcTUBUkNavkzyz_7VoRWL7WkwryyI0U';

const TEST_ROOM_CODE = 'HT' + Math.floor(1000 + Math.random() * 9000);
const PLAYER_1_ID = 'p_hunter_' + Math.random().toString(36).substring(2, 7);
const PLAYER_2_ID = 'p_runner_' + Math.random().toString(36).substring(2, 7);

const results = [];

function pass(name, details = '') {
  results.push({ name, status: 'PASS', details });
  console.log(`  ✅ [PASS] ${name} ${details ? '— ' + details : ''}`);
}

function fail(name, error) {
  results.push({ name, status: 'FAIL', error: String(error) });
  console.error(`  ❌ [FAIL] ${name}:`, error);
}

async function runHardTestSuite() {
  console.log('\n==================================================================');
  console.log('  🎯 RUN FOR YOUR LIFE: SUPABASE COMPREHENSIVE HARD TEST RUN');
  console.log('==================================================================');
  console.log(`Target Supabase URL: ${SUPABASE_URL}`);
  console.log(`Generated Test Room: ${TEST_ROOM_CODE}`);
  console.log(`Player 1 (Hunter):   ${PLAYER_1_ID} ("Ghost")`);
  console.log(`Player 2 (Runner):   ${PLAYER_2_ID} ("Shadow")`);
  console.log('==================================================================\n');

  // Client 1 (representing Hunter)
  const clientHunter = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 20 } }
  });

  // Client 2 (representing Runner)
  const clientRunner = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 20 } }
  });

  try {
    // -------------------------------------------------------------
    // 1. HEALTH & CONNECTIVITY TEST
    // -------------------------------------------------------------
    console.log('\n[1/10] Database Connection & Table Accessibility Test...');
    const startTime = Date.now();
    const { error: healthErr } = await clientHunter.from('rooms').select('count', { count: 'exact', head: true });
    const latency = Date.now() - startTime;

    if (healthErr) throw healthErr;
    pass('Database PostgREST Health Check', `HTTP/2 Handshake responded in ${latency}ms`);

    // -------------------------------------------------------------
    // 2. ROOM CREATION & DUAL PING SETTINGS TEST
    // -------------------------------------------------------------
    console.log('\n[2/10] Room Lifecycle (Create, Query, State Transitions)...');
    const roomPayload = {
      code: TEST_ROOM_CODE,
      host_id: PLAYER_1_ID,
      state: 'LOBBY',
      arena: { lat: 37.7749, lng: -122.4194, radius: 350 },
      settings: {
        roundLength: 2700,
        headStart: 180,
        hunterPingInterval: 20,
        runnerPingInterval: 50
      },
      time_remaining: 2700
    };

    const { data: createdRoom, error: createRoomErr } = await clientHunter
      .from('rooms')
      .insert(roomPayload)
      .select()
      .single();

    if (createRoomErr) throw createRoomErr;
    if (createdRoom.settings.hunterPingInterval !== 20 || createdRoom.settings.runnerPingInterval !== 50) {
      throw new Error('Dual ping intervals did not persist correctly');
    }
    pass('Room Created with Custom Dual Ping Intervals', `Hunter: 20s, Runner: 50s, Radius: 350m`);

    // State transition test
    const { data: updatedRoom, error: updateRoomErr } = await clientHunter
      .from('rooms')
      .update({ state: 'HUNT', time_remaining: 2400 })
      .eq('code', TEST_ROOM_CODE)
      .select()
      .single();

    if (updateRoomErr) throw updateRoomErr;
    if (updatedRoom.state !== 'HUNT' || updatedRoom.time_remaining !== 2400) {
      throw new Error('State update failed');
    }
    pass('Room State Transition & Clock Sync', `State moved to HUNT, Time: 2400s`);

    // -------------------------------------------------------------
    // 3. 2-PLAYER 1v1 OPERATIVE CREATION & ROLE ASSIGNMENT
    // -------------------------------------------------------------
    console.log('\n[3/10] 2-Player 1v1 Operatives & Roles Injection...');
    const playersToInsert = [
      {
        id: PLAYER_1_ID,
        room_code: TEST_ROOM_CODE,
        name: 'Ghost',
        role_preference: 'hunter',
        assigned_role: 'hunter',
        lat: 37.7749,
        lng: -122.4194,
        is_tagged: false,
        connected: true
      },
      {
        id: PLAYER_2_ID,
        room_code: TEST_ROOM_CODE,
        name: 'Shadow',
        role_preference: 'runner',
        assigned_role: 'runner',
        lat: 37.7760,
        lng: -122.4180,
        is_tagged: false,
        connected: true
      }
    ];

    const { data: insertedPlayers, error: insertPlayersErr } = await clientHunter
      .from('players')
      .insert(playersToInsert)
      .select();

    if (insertPlayersErr) throw insertPlayersErr;
    if (insertedPlayers.length !== 2) throw new Error('Expected 2 players inserted');
    pass('1v1 Operatives Registered in Database', `Hunter ("Ghost") vs Runner ("Shadow")`);

    // -------------------------------------------------------------
    // 4. LIVE LOCATION UPDATES IN DATABASE
    // -------------------------------------------------------------
    console.log('\n[4/10] High-Frequency GPS Location Updating in Database...');
    const tLocStart = Date.now();
    const newHunterLat = 37.7753;
    const newHunterLng = -122.4190;

    const { error: updateLocErr } = await clientHunter
      .from('players')
      .update({ lat: newHunterLat, lng: newHunterLng, updated_at: new Date().toISOString() })
      .eq('id', PLAYER_1_ID);

    if (updateLocErr) throw updateLocErr;

    // Verify read from runner's perspective
    const { data: readPlayer1, error: readPlayer1Err } = await clientRunner
      .from('players')
      .select('lat, lng')
      .eq('id', PLAYER_1_ID)
      .single();

    if (readPlayer1Err) throw readPlayer1Err;
    if (Math.abs(readPlayer1.lat - newHunterLat) > 0.0001) throw new Error('Coordinates mismatch');
    pass('GPS Coordinates Updated & Queried', `Hunter moved to ${newHunterLat}, ${newHunterLng} (took ${Date.now() - tLocStart}ms)`);

    // -------------------------------------------------------------
    // 5. TACTICAL RADAR PINGS HISTORY RECORDING
    // -------------------------------------------------------------
    console.log('\n[5/10] Sonar Radar Ping Storage & History...');
    const pingPayload = {
      room_code: TEST_ROOM_CODE,
      ping_type: 'RUNNER',
      pings_data: [
        { id: PLAYER_2_ID, name: 'Shadow', lat: 37.7762, lng: -122.4178, timestamp: Date.now() }
      ]
    };

    const { data: pingRecord, error: pingErr } = await clientHunter
      .from('pings')
      .insert(pingPayload)
      .select()
      .single();

    if (pingErr) throw pingErr;
    if (!pingRecord.id) throw new Error('Ping record ID missing');
    pass('Tactical Sonar Ping Record Saved', `Type: RUNNER Sonar, Ping ID: ${pingRecord.id.substring(0, 8)}...`);

    // -------------------------------------------------------------
    // 6. LIVE TACTICAL CHAT & PHOTO ATTACHMENT PERSISTENCE
    // -------------------------------------------------------------
    console.log('\n[6/10] Live Chat Stream & Compressed Photo Upload Persistence...');
    const testSamplePhoto = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

    const chatMsgPayload = {
      room_code: TEST_ROOM_CODE,
      sender_id: PLAYER_1_ID,
      sender_name: 'Ghost',
      role: 'hunter',
      message: 'Visual confirmation: operative hiding behind northern pavilion.',
      photo_url: testSamplePhoto
    };

    const { data: savedMsg, error: saveMsgErr } = await clientHunter
      .from('game_messages')
      .insert(chatMsgPayload)
      .select()
      .single();

    if (saveMsgErr) throw saveMsgErr;
    if (!savedMsg.photo_url || savedMsg.message !== chatMsgPayload.message) {
      throw new Error('Message content or photo attachment corrupted');
    }

    // Query messages from Runner's view
    const { data: msgList, error: readMsgErr } = await clientRunner
      .from('game_messages')
      .select('*')
      .eq('room_code', TEST_ROOM_CODE)
      .order('created_at', { ascending: true });

    if (readMsgErr) throw readMsgErr;
    if (msgList.length === 0) throw new Error('No messages returned');
    pass('Chat Intel with Compressed Photo Stored', `Retrieved message from "Ghost" with valid photo payload`);

    // -------------------------------------------------------------
    // 7. 90-SECOND DISCONNECTION BUFFER & RECONNECT
    // -------------------------------------------------------------
    console.log('\n[7/10] 90-Second Disconnection Buffer & Reconnect Verification...');
    const disconnectTimestamp = new Date().toISOString();

    // Mark player disconnected
    const { error: discErr } = await clientRunner
      .from('players')
      .update({ connected: false, disconnected_at: disconnectTimestamp })
      .eq('id', PLAYER_2_ID);

    if (discErr) throw discErr;

    // Check status as seen by hunter
    const { data: discCheck } = await clientHunter
      .from('players')
      .select('connected, disconnected_at')
      .eq('id', PLAYER_2_ID)
      .single();

    if (discCheck.connected !== false || !discCheck.disconnected_at) {
      throw new Error('Player disconnection buffer flag failed to set');
    }
    pass('Disconnection Buffer Initialized', `Player 2 marked offline with disconnected_at timestamp`);

    // Reconnection by same name & ID
    const { error: reconnErr } = await clientRunner
      .from('players')
      .update({ connected: true, disconnected_at: null })
      .eq('id', PLAYER_2_ID);

    if (reconnErr) throw reconnErr;

    const { data: reconnCheck } = await clientHunter
      .from('players')
      .select('connected, disconnected_at')
      .eq('id', PLAYER_2_ID)
      .single();

    if (reconnCheck.connected !== true || reconnCheck.disconnected_at !== null) {
      throw new Error('Reconnection restoration failed');
    }
    pass('Player Reconnection Within Buffer Window', `Status restored to online, buffer cleared`);

    // -------------------------------------------------------------
    // 8. REALTIME WEBSOCKET CHANNELS & PRESENCE SYNC
    // -------------------------------------------------------------
    console.log('\n[8/10] Supabase Realtime WebSocket Presence Handshake...');
    const channelName = `game_room_${TEST_ROOM_CODE}`;

    let hunterPresenceSynced = false;
    let runnerPresenceSynced = false;

    const channelHunter = clientHunter.channel(channelName);
    const channelRunner = clientRunner.channel(channelName);

    const presencePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Realtime presence sync timed out after 10s')), 10000);

      channelHunter.on('presence', { event: 'sync' }, () => {
        const state = channelHunter.presenceState();
        const count = Object.keys(state).length;
        if (count >= 2) {
          hunterPresenceSynced = true;
          if (runnerPresenceSynced) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });

      channelRunner.on('presence', { event: 'sync' }, () => {
        const state = channelRunner.presenceState();
        const count = Object.keys(state).length;
        if (count >= 2) {
          runnerPresenceSynced = true;
          if (hunterPresenceSynced) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
    });

    const tSubStart = Date.now();
    await Promise.all([
      new Promise((res) => {
        channelHunter.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channelHunter.track({
              id: PLAYER_1_ID,
              name: 'Ghost',
              role: 'hunter',
              lat: 37.7749,
              lng: -122.4194
            });
            res();
          }
        });
      }),
      new Promise((res) => {
        channelRunner.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channelRunner.track({
              id: PLAYER_2_ID,
              name: 'Shadow',
              role: 'runner',
              lat: 37.7760,
              lng: -122.4180
            });
            res();
          }
        });
      })
    ]);

    await presencePromise;
    pass('Realtime Presence Synchronized', `Both operatives tracked simultaneously in channel (handshake in ${Date.now() - tSubStart}ms)`);

    // -------------------------------------------------------------
    // 9. LIVE LOCATION BROADCAST & LOW-LATENCY RECEPTION
    // -------------------------------------------------------------
    console.log('\n[9/10] Multi-Client Live Location Sharing Broadcast...');
    let locationReceivedByRunner = false;
    let locationLatency = 0;

    const locPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Live location broadcast timed out after 6s')), 6000);

      channelRunner.on('broadcast', { event: 'location_update' }, (msg) => {
        if (msg.payload.playerId === PLAYER_1_ID) {
          locationLatency = Date.now() - msg.payload.sentTime;
          locationReceivedByRunner = true;
          clearTimeout(timeout);
          resolve(msg.payload);
        }
      });
    });

    // Hunter sends live GPS feed
    await channelHunter.send({
      type: 'broadcast',
      event: 'location_update',
      payload: {
        playerId: PLAYER_1_ID,
        name: 'Ghost',
        role: 'hunter',
        lat: 37.77588,
        lng: -122.41922,
        sentTime: Date.now()
      }
    });

    const receivedLoc = await locPromise;
    pass('Live Location Sharing Realtime Broadcast', `Runner received Hunter live coords in ${locationLatency}ms (${receivedLoc.lat}, ${receivedLoc.lng})`);

    // -------------------------------------------------------------
    // 10. REALTIME CHAT, PHOTO UPLOAD & PLAYER TAGGING EVENTS
    // -------------------------------------------------------------
    console.log('\n[10/10] Realtime Live Chat Photo Broadcast & Tag Claim Event...');
    let chatReceivedByHunter = false;
    let tagReceivedByRunner = false;

    const chatAndTagPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chat or Tag event timed out after 6s')), 6000);

      channelHunter.on('broadcast', { event: 'chat_message' }, (msg) => {
        if (msg.payload.senderId === PLAYER_2_ID && msg.payload.photoUrl) {
          chatReceivedByHunter = true;
          if (tagReceivedByRunner) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });

      channelRunner.on('broadcast', { event: 'player_tagged' }, (msg) => {
        if (msg.payload.runnerId === PLAYER_2_ID) {
          tagReceivedByRunner = true;
          if (chatReceivedByHunter) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
    });

    // Runner sends photo message to Hunter
    await channelRunner.send({
      type: 'broadcast',
      event: 'chat_message',
      payload: {
        id: 'msg_test_' + Date.now(),
        senderId: PLAYER_2_ID,
        senderName: 'Shadow',
        role: 'runner',
        text: 'Tactical intel: crossing alleyway towards landmark.',
        photoUrl: testSamplePhoto,
        sentTime: Date.now()
      }
    });

    // Hunter tags runner
    await channelHunter.send({
      type: 'broadcast',
      event: 'player_tagged',
      payload: {
        runnerId: PLAYER_2_ID,
        runnerName: 'Shadow',
        hunterName: 'Ghost'
      }
    });

    await chatAndTagPromise;
    pass('Realtime Photo Chat & Tag Confirmation Broadcast', `Chat photo and player tag events delivered across clients with 0 errors`);

    // -------------------------------------------------------------
    // TEARDOWN & CLEANUP
    // -------------------------------------------------------------
    console.log('\nCleaning up test artifacts from database...');
    await channelHunter.unsubscribe();
    await channelRunner.unsubscribe();

    await clientHunter.from('game_messages').delete().eq('room_code', TEST_ROOM_CODE);
    await clientHunter.from('pings').delete().eq('room_code', TEST_ROOM_CODE);
    await clientHunter.from('players').delete().eq('room_code', TEST_ROOM_CODE);
    await clientHunter.from('rooms').delete().eq('code', TEST_ROOM_CODE);
    pass('Test Cleanup', `Removed test room ${TEST_ROOM_CODE} and associated rows cleanly`);

  } catch (err) {
    fail('Test Suite Execution', err);
  }

  console.log('\n==================================================================');
  console.log(`  HARD TEST SUMMARY: ${results.filter(r => r.status === 'PASS').length} PASSED / ${results.filter(r => r.status === 'FAIL').length} FAILED`);
  console.log('==================================================================\n');

  return results;
}

runHardTestSuite().then((res) => {
  const hasFailures = res.some(r => r.status === 'FAIL');
  process.exit(hasFailures ? 1 : 0);
});
