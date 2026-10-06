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

const waitFor = async (fn, timeout = 5000, step = 50) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (fn()) return true;
    if (Date.now() >= deadline) return false;
    await wait(step);
  }
};

const httpGet = (path, origin = ORIGIN) =>
  new Promise((resolve, reject) => {
    const http = transport;
    const req = http.get(`${URL}${path}`, { headers: origin ? { Origin: origin } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: data })
      );
    });
    req.on('error', reject);
  });

const httpPost = (path, payload) =>
  new Promise((resolve, reject) => {
    const http = transport;
    const body = JSON.stringify(payload);
    const req = http.request(
      `${URL}${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Origin: ORIGIN,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

const preflight = (path, method) =>
  new Promise((resolve, reject) => {
    const http = transport;
    const req = http.request(
      `${URL}${path}`,
      {
        method: 'OPTIONS',
        headers: {
          Origin: ORIGIN,
          'Access-Control-Request-Method': method,
          'Access-Control-Request-Headers': 'content-type',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    req.end();
  });

const uploadImage = async (bytes, mime, filename) => {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), filename);
  const res = await fetch(`${URL}/api/messages/upload`, {
    method: 'POST',
    headers: { Origin: ORIGIN },
    body: form,
  });
  return { status: res.status, json: await res.json() };
};

const makeClient = (username) =>
  new Promise((resolve, reject) => {
    const socket = io(URL, {
      extraHeaders: { Origin: ORIGIN },
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 8000,
    });
    const state = { socket, username, received: [], reactions: [], typing: [], online: null, errors: [] };
    const timer = setTimeout(() => reject(new Error(`${username} connect timeout`)), 8000);

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.emit('join_chat', username);
      resolve(state);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on('receive_message', (m) => state.received.push(m));
    socket.on('reaction_toggled', (r) => state.reactions.push(r));
    socket.on('online_users', (n) => (state.online = n));
    socket.on('typing_start', (p) => state.typing.push(`start:${p.username}`));
    socket.on('typing_stop', (p) => state.typing.push(`stop:${p.username}`));
    socket.on('message_error', (p) => state.errors.push(p.message));
  });

(async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  try {
    const health = await httpGet('/api/health');
    const h = JSON.parse(health.body);
    log('health endpoint', health.status === 200 && h.success === true, health.body);
    log('health reports db mode', typeof h.database === 'string', `database=${h.database}`);

    const pf = await preflight('/api/messages/upload', 'POST');
    log(
      'upload preflight allowed',
      pf.status === 204 && !!pf.headers['access-control-allow-origin'],
      `status=${pf.status} acao=${pf.headers['access-control-allow-origin']}`
    );

    const badUpload = await uploadImage('not-an-image', 'text/plain', 'x.txt');
    log('rejects non-image upload', badUpload.status === 400, JSON.stringify(badUpload.json));

    const upload = await uploadImage(png, 'image/png', 'pixel.png');
    log(
      'accepts image upload',
      upload.status === 200 && upload.json?.data?.imageUrl?.startsWith('/uploads/'),
      JSON.stringify(upload.json)
    );

    const imageUrl = upload.json.data.imageUrl;
    const imageFetch = await httpGet(imageUrl);
    log(
      'serves uploaded image',
      imageFetch.status === 200 && (imageFetch.headers['content-type'] || '').includes('image'),
      `status=${imageFetch.status} type=${imageFetch.headers['content-type']}`
    );

    const pre = JSON.parse((await httpGet('/api/messages')).body);
    const before = pre.data.length;

    const a = await makeClient('Alice');
    const b = await makeClient('Bob');
    log('two clients connect', true);
    const onlineOk = await waitFor(() => a.online === 2 && b.online === 2);
    log('online users = 2', onlineOk, `a=${a.online} b=${b.online}`);

    a.socket.emit('send_message', { username: 'Alice', text: 'hello from Alice' });
    const textDelivered = await waitFor(() => b.received.some((m) => m.text === 'hello from Alice'));
    log('text message delivered', textDelivered);

    a.socket.emit('send_message', {
      username: 'Alice',
      text: 'here is a pic',
      type: 'image',
      imageUrl,
    });
    await waitFor(() => b.received.some((m) => m.type === 'image'));
    const imageMsg = b.received.find((m) => m.type === 'image');
    log('image message delivered', !!imageMsg, imageMsg ? JSON.stringify(imageMsg) : 'missing');
    log('image message carries reactions field', imageMsg && typeof imageMsg.reactions === 'object');

    a.socket.emit('send_message', {
      username: 'Alice',
      text: '',
      type: 'image',
      imageUrl: '/uploads/hack.png',
    });
    await waitFor(() => a.errors.includes('Upload the image before sending it'));
    log('rejects un-uploaded image path', b.received.every((m) => m.imageUrl !== '/uploads/hack.png'));

    if (imageMsg) {
      a.socket.emit('toggle_reaction', {
        messageId: imageMsg._id,
        username: 'Alice',
        emoji: 'love',
      });
      const toggledOk = await waitFor(() => {
        const t = b.reactions.find((r) => r._id === imageMsg._id);
        return !!t && t.reactions?.Alice === 'love';
      });
      const toggled = b.reactions.find((r) => r._id === imageMsg._id);
      log('reaction broadcast', toggledOk, JSON.stringify(toggled));

      a.socket.emit('toggle_reaction', {
        messageId: imageMsg._id,
        username: 'Bob',
        emoji: 'laugh',
      });
      const secondOk = await waitFor(() => {
        const t = b.reactions[b.reactions.length - 1];
        return !!t && t._id === imageMsg._id && t.reactions?.Alice === 'love' && t.reactions?.Bob === 'laugh';
      });
      const second = b.reactions[b.reactions.length - 1];
      log(
        'second user reaction merges',
        secondOk,
        JSON.stringify(second?.reactions)
      );

      a.socket.emit('toggle_reaction', {
        messageId: imageMsg._id,
        username: 'Alice',
        emoji: 'love',
      });
      const thirdOk = await waitFor(() => {
        const t = b.reactions[b.reactions.length - 1];
        return !!t && t._id === imageMsg._id && !t.reactions?.Alice;
      });
      const third = b.reactions[b.reactions.length - 1];
      log('same reaction toggles off', thirdOk, JSON.stringify(third?.reactions));

      a.socket.emit('toggle_reaction', {
        messageId: imageMsg._id,
        username: 'Alice',
        emoji: 'rocket',
      });
      const emojiOk = await waitFor(() => a.errors.includes('Invalid emoji type'));
      log('invalid emoji rejected', emojiOk, JSON.stringify(a.errors));
    }

    a.socket.emit('typing_start');
    const typingOk = await waitFor(() => b.typing.includes('start:Alice'));
    log('typing indicator', typingOk);
    a.socket.emit('typing_stop');
    const typingStopOk = await waitFor(() => b.typing.includes('stop:Alice'));
    log('typing stop', typingStopOk);

    const post = await httpPost('/api/messages', { username: 'Bob', text: 'via REST' });
    log('REST create message', post.status === 201, post.body);

    const history = JSON.parse((await httpGet('/api/messages')).body);
    log('history grew', history.data.length > before, `before=${before} after=${history.data.length}`);
    log('no duplicate ids', new Set(history.data.map((m) => m._id)).size === history.data.length);
    log('history has image message', history.data.some((m) => m.type === 'image' && m.imageUrl));

    b.socket.disconnect();
    const dropped = await waitFor(() => a.online === 1);
    log('online drops after disconnect', dropped, `a=${a.online}`);
    a.socket.disconnect();

    const blocked = await new Promise((resolve) => {
      const s = io(URL, {
        extraHeaders: { Origin: 'https://evil.example.com' },
        reconnection: false,
        timeout: 5000,
      });
      s.on('connect', () => resolve(false));
      s.on('connect_error', () => resolve(true));
      setTimeout(() => resolve(false), 6000);
    });
    log('bad origin blocked', blocked);
  } catch (err) {
    log('unexpected error', false, err.message);
  }

  const failed = results.filter((r) => !ok(r)).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

function ok(r) {
  return r.ok;
}
