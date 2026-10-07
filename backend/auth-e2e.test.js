const { io } = require('socket.io-client');

const URL = process.env.TEST_URL || 'http://localhost:5000';
const ORIGIN = process.env.TEST_ORIGIN || 'https://aakashpate.github.io';
const transport = URL.startsWith('https:') ? require('https') : require('http');

const results = [];
const log = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const waitFor = async (fn, timeout = 8000, step = 50) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (fn()) return true;
    if (Date.now() >= deadline) return false;
    await wait(step);
  }
};

const request = (method, path, { body = null, token = null } = {}) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { Origin: ORIGIN };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (token) headers.Authorization = `Bearer ${token}`;

    const req = transport.request(
      `${URL}${path}`,
      { method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (error) {
            json = null;
          }
          resolve({ status: res.statusCode, body: data, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

const register = (username, email, password) =>
  request('POST', '/api/auth/register', {
    body: { username, email, password, confirmPassword: password },
  });

const login = (identifier, password) =>
  request('POST', '/api/auth/login', { body: { identifier, password } });

const connectSocket = (token) =>
  new Promise((resolve, reject) => {
    const socket = io(URL, {
      extraHeaders: { Origin: ORIGIN },
      auth: token ? { token } : {},
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 8000,
    });
    const state = {
      socket,
      messages: [],
      typing: [],
      read: [],
      delivered: [],
      presence: [],
      errors: [],
      conversations: [],
      acks: [],
    };

    socket.on('connect', () => resolve(state));
    socket.on('connect_error', (err) => reject(err));
    socket.on('conversation_message', (p) => state.messages.push(p));
    socket.on('typing_start', (p) => state.typing.push(p));
    socket.on('typing_stop', (p) => state.typing.push(p));
    socket.on('messages_read', (p) => state.read.push(p));
    socket.on('message_delivered', (p) => state.delivered.push(p));
    socket.on('presence_update', (p) => state.presence.push(p));
    socket.on('conversation_updated', (p) => state.conversations.push(p));

    setTimeout(() => reject(new Error('connect timeout')), 9000);
  });

const emitAck = (socket, event, data, timeout = 8000) =>
  new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: 'ack timeout' });
      }
    }, timeout);
    socket.emit(event, data, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response || { ok: false, error: 'empty ack' });
    });
  });

(async () => {
  const stamp = Date.now().toString(36);
  const nameA = `alice${stamp}`;
  const nameB = `bob${stamp}`;
  const nameC = `carol${stamp}`;
  const emailA = `${nameA}@example.com`;
  const emailB = `${nameB}@example.com`;
  const emailC = `${nameC}@example.com`;
  const password = 'secret123';

  try {
    const health = await request('GET', '/api/health');
    log('health endpoint', health.status === 200, health.body);

    const regA = await register(nameA, emailA, password);
    const tokenA = regA.json?.data?.token;
    log('register A', regA.status === 201 && Boolean(tokenA), `status=${regA.status}`);

    const regB = await register(nameB, emailB, password);
    const tokenB = regB.json?.data?.token;
    const idB = regB.json?.data?.user?._id;
    log('register B', regB.status === 201 && Boolean(tokenB), `status=${regB.status}`);

    const regC = await register(nameC, emailC, password);
    const tokenC = regC.json?.data?.token;
    const idC = regC.json?.data?.user?._id;
    log('register C', regC.status === 201 && Boolean(tokenC), `status=${regC.status}`);

    const dupName = await register(nameA, `${nameA}2@example.com`, password);
    log(
      'duplicate username rejected',
      dupName.status === 409 && dupName.json?.message === 'Username already taken',
      dupName.body
    );

    const dupEmail = await register(`${nameA}other`, emailA, password);
    log(
      'duplicate email rejected',
      dupEmail.status === 409 && dupEmail.json?.message === 'Email already registered',
      dupEmail.body
    );

    const mismatch = await request('POST', '/api/auth/register', {
      body: {
        username: `${nameA}x`,
        email: `${nameA}x@example.com`,
        password: 'secret123',
        confirmPassword: 'different',
      },
    });
    log('confirm password mismatch', mismatch.status === 400, mismatch.body);

    const shortPassword = await request('POST', '/api/auth/register', {
      body: {
        username: `${nameA}y`,
        email: `${nameA}y@example.com`,
        password: 'abc',
        confirmPassword: 'abc',
      },
    });
    log('short password rejected', shortPassword.status === 400, shortPassword.body);

    const badLogin = await login(nameA, 'wrong-password');
    log(
      'wrong password rejected',
      badLogin.status === 401 && badLogin.json?.message === 'Incorrect email/username or password',
      badLogin.body
    );

    const loginByName = await login(nameA, password);
    log('login with username', loginByName.status === 200 && Boolean(loginByName.json?.data?.token));

    const loginByEmail = await login(emailA, password);
    const freshTokenA = loginByEmail.json?.data?.token;
    log('login with email', loginByEmail.status === 200 && Boolean(freshTokenA));

    const meNoToken = await request('GET', '/api/auth/me');
    log('me requires token', meNoToken.status === 401, `status=${meNoToken.status}`);

    const meBadToken = await request('GET', '/api/auth/me', { token: 'not.a.jwt' });
    log('me rejects bad token', meBadToken.status === 401, `status=${meBadToken.status}`);

    const me = await request('GET', '/api/auth/me', { token: freshTokenA });
    log(
      'me returns profile',
      me.status === 200 && me.json?.data?.email === emailA && me.json?.data?.username === nameA,
      me.body
    );

    const search = await request('GET', `/api/users/search?q=${nameB}`, { token: freshTokenA });
    const foundB = (search.json?.data || []).find((u) => u.username === nameB);
    const foundSelf = (search.json?.data || []).find((u) => u.username === nameA);
    log(
      'user search finds B and not self',
      search.status === 200 && Boolean(foundB) && !foundSelf,
      JSON.stringify((search.json?.data || []).map((u) => u.username))
    );

    const searchNoAuth = await request('GET', `/api/users/search?q=${nameB}`);
    log('user search requires auth', searchNoAuth.status === 401, `status=${searchNoAuth.status}`);

    const convCreate = await request('POST', '/api/conversations', {
      token: freshTokenA,
      body: { userId: idB },
    });
    const conversationId = convCreate.json?.data?._id;
    log(
      'create direct conversation',
      convCreate.status === 201 && convCreate.json?.data?.otherParticipant?.username === nameB,
      `id=${conversationId}`
    );

    const convAgain = await request('POST', '/api/conversations', {
      token: freshTokenA,
      body: { userId: idB },
    });
    log(
      'conversation is find-or-create',
      convAgain.status === 201 && convAgain.json?.data?._id === conversationId,
      `id=${convAgain.json?.data?._id}`
    );

    const listA = await request('GET', '/api/conversations', { token: freshTokenA });
    const listEntry = (listA.json?.data || []).find((c) => c._id === conversationId);
    log(
      'conversation list shows unread 0',
      listA.status === 200 && listEntry && listEntry.unreadCount === 0,
      JSON.stringify(listEntry ? { unread: listEntry.unreadCount } : {})
    );

    const privateText = `private hello ${Date.now()}`;
    const sent = await request('POST', `/api/conversations/${conversationId}/messages`, {
      token: freshTokenA,
      body: { text: privateText },
    });
    log(
      'REST send private message',
      sent.status === 201 && sent.json?.data?.text === privateText,
      sent.body
    );

    const listB = await request('GET', '/api/conversations', { token: tokenB });
    const listBEntry = (listB.json?.data || []).find((c) => c._id === conversationId);
    log(
      'B sees unread count 1',
      listB.status === 200 && listBEntry && listBEntry.unreadCount === 1,
      JSON.stringify(listBEntry ? { unread: listBEntry.unreadCount } : {})
    );

    const messagesB = await request('GET', `/api/conversations/${conversationId}/messages`, {
      token: tokenB,
    });
    log(
      'B fetches conversation history',
      messagesB.status === 200 &&
        (messagesB.json?.data || []).some((m) => m.text === privateText),
      `count=${(messagesB.json?.data || []).length}`
    );

    const readMark = await request('POST', `/api/conversations/${conversationId}/read`, {
      token: tokenB,
    });
    const listBAfter = await request('GET', '/api/conversations', { token: tokenB });
    const listBAfterEntry = (listBAfter.json?.data || []).find((c) => c._id === conversationId);
    log(
      'mark read clears unread',
      readMark.status === 200 && listBAfterEntry && listBAfterEntry.unreadCount === 0,
      JSON.stringify({ marked: readMark.json?.data?.marked, unread: listBAfterEntry?.unreadCount })
    );

    const cReads = await request('GET', `/api/conversations/${conversationId}/messages`, {
      token: tokenC,
    });
    log('C cannot read A-B conversation', cReads.status === 404, `status=${cReads.status}`);

    const cSends = await request('POST', `/api/conversations/${conversationId}/messages`, {
      token: tokenC,
      body: { text: 'intruder' },
    });
    log('C cannot send into A-B conversation', cSends.status === 404, `status=${cSends.status}`);

    const publicPost = await request('POST', '/api/messages', {
      body: { username: nameA, text: `public note ${Date.now()}` },
    });
    const publicList = await request('GET', '/api/messages');
    const privateLeaks = (publicList.json?.data || []).filter(
      (m) => m.text === privateText || m.conversation
    );
    log(
      'public history excludes private messages',
      publicPost.status === 201 && publicList.status === 200 && privateLeaks.length === 0,
      `private leaks=${privateLeaks.length}`
    );

    const socketA = await connectSocket(freshTokenA);
    const socketB = await connectSocket(tokenB);
    const socketC = await connectSocket(tokenC);
    log('A, B, C sockets connected with JWT', true);

    const joinA = await emitAck(socketA.socket, 'join_conversation', { conversationId });
    const joinB = await emitAck(socketB.socket, 'join_conversation', { conversationId });
    log(
      'participants join conversation room',
      joinA.ok === true && joinB.ok === true,
      JSON.stringify({ joinA, joinB })
    );

    const joinC = await emitAck(socketC.socket, 'join_conversation', { conversationId });
    log('C cannot join A-B conversation socket room', joinC.ok === false, JSON.stringify(joinC));

    let rejectedSocket = null;
    try {
      rejectedSocket = await connectSocket('expired.token.value');
    } catch (error) {
      rejectedSocket = null;
    }
    log('socket rejects invalid JWT', rejectedSocket === null);

    const socketText = `socket message ${Date.now()}`;
    const sendAck = await emitAck(socketA.socket, 'send_conversation_message', {
      conversationId,
      text: socketText,
    });
    const received = await waitFor(() =>
      socketB.messages.some((p) => p.message?.text === socketText)
    );
    log(
      'B receives A message in realtime',
      sendAck.ok === true && received,
      JSON.stringify(sendAck.message ? { id: String(sendAck.message._id) } : sendAck)
    );

    const privateMessageId = sendAck.message?._id;
    const deliveredFlag = sendAck.message?.deliveredAt;
    log('sent message is marked delivered to online B', Boolean(deliveredFlag), String(deliveredFlag));

    socketB.socket.emit('typing_start', { conversationId });
    const typingSeen = await waitFor(() =>
      socketA.typing.some((t) => t.conversationId === conversationId && t.username === nameB)
    );
    log('typing indicator scoped to conversation', typingSeen);

    await emitAck(socketC.socket, 'join_conversation', { conversationId: null });
    const convC = await request('POST', '/api/conversations', {
      token: tokenC,
      body: { userId: idB },
    });
    const conversationC = convC.json?.data?._id;
    await emitAck(socketC.socket, 'join_conversation', { conversationId: conversationC });
    socketC.socket.emit('typing_start', { conversationId: conversationC });
    await wait(700);
    const leakedTyping = socketA.typing.some((t) => t.conversationId === conversationC);
    log('typing does not leak to other conversations', !leakedTyping);

    socketB.socket.emit('mark_read', { conversationId });
    const readSeen = await waitFor(() =>
      socketA.read.some((r) => r.conversationId === conversationId)
    );
    log('read receipt delivered to sender', readSeen);

    const presenceCheck = await emitAck(socketB.socket, 'get_presence', {
      userIds: [String(regA.json?.data?.user?._id)],
    });
    const userIdA = String(regA.json?.data?.user?._id);
    log(
      'presence reports A online',
      presenceCheck.ok === true && presenceCheck.online?.[userIdA] === true,
      JSON.stringify(presenceCheck.online || {})
    );

    socketA.socket.disconnect();
    const presenceOffline = await waitFor(() =>
      socketB.presence.some((p) => p.userId === userIdA && p.online === false)
    );
    log('presence update when A goes offline', presenceOffline);

    for (let i = 0; i < 55; i += 1) {
      await request('POST', `/api/conversations/${conversationId}/messages`, {
        token: freshTokenA,
        body: { text: `page ${i}` },
      });
    }

    const page1 = await request('GET', `/api/conversations/${conversationId}/messages?limit=50`, {
      token: tokenB,
    });
    log(
      'pagination returns limited page',
      page1.status === 200 && page1.json?.data?.length === 50 && page1.json?.hasMore === true,
      `count=${page1.json?.data?.length} hasMore=${page1.json?.hasMore}`
    );

    const oldest = page1.json?.data?.[0]?.createdAt;
    const page2 = await request(
      'GET',
      `/api/conversations/${conversationId}/messages?limit=50&before=${encodeURIComponent(oldest)}`,
      { token: tokenB }
    );
    const page2StartsBefore = (page2.json?.data || []).every(
      (m) => new Date(m.createdAt) <= new Date(oldest)
    );
    log(
      'pagination cursor fetches older messages',
      page2.status === 200 && page2.json?.data?.length > 0 && page2StartsBefore,
      `count=${page2.json?.data?.length}`
    );

    const logout = await request('POST', '/api/auth/logout', { token: freshTokenA });
    const meAfterLogout = await request('GET', '/api/auth/me', { token: freshTokenA });
    log(
      'logout invalidates session',
      logout.status === 200 && meAfterLogout.status === 401,
      `logout=${logout.status} meAfter=${meAfterLogout.status}`
    );

    const socketAfterLogout = await connectSocket(freshTokenA).then(
      () => true,
      () => false
    );
    log('socket rejects revoked session', socketAfterLogout === false);

    socketB.socket.disconnect();
    socketC.socket.disconnect();
    await wait(200);
  } catch (err) {
    log('unexpected error', false, err.message);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
