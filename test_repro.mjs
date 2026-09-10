import { BotCore } from './worker.js';
import assert from 'node:assert';

async function runTest() {
  const sentMessages = [];
  const mockKv = new Map();

  const env = {
    nfd: {
      async get(key, opts) {
        const val = mockKv.get(key);
        if (val === undefined) return null;
        if (opts && opts.type === 'json') return JSON.parse(val);
        return val;
      },
      async put(key, val) {
        mockKv.set(key, typeof val === 'string' ? val : JSON.stringify(val));
      },
      async delete(key) {
        mockKv.delete(key);
      }
    },
    BOT_TOKEN: '123456:fake_token',
    BOT_SECRET: 'secret',
    ADMIN_UID: '999999'
  };

  const bot = new BotCore(env);

  // Mock bot.api to record calls
  bot.api = async function(method, body) {
    if (method === 'sendMessage') {
      sentMessages.push(body);
      return { ok: true, result: { message_id: 1000 + sentMessages.length } };
    }
    return { ok: true };
  };

  const guestChatId = 12345;
  const now = Date.now();

  // Set up scenario: User verified 4 hours ago (TTL is 3 hours = 10800s)
  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_1', at: now - 5 * 3600 * 1000 }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({
    sessionId: 'sess_1',
    questionId: 'q_old',
    correctIndex: 0,
    exp: now - 3.5 * 3600 * 1000,
    verified: true,
    verifiedAt: now - 4 * 3600 * 1000, // 4 hours ago -> EXPIRED!
    failCount: 0,
    lockedUntil: 0
  }));

  // Guest sends message: "你能做什么？"
  const incomingMsg = {
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh-hans' },
    text: '你能做什么？',
    message_id: 200
  };

  await bot.handleGuestMessage(incomingMsg, 'zh');

  console.log('Sent messages count:', sentMessages.length);
  console.log('Last sent message:', JSON.stringify(sentMessages[sentMessages.length - 1], null, 2));

  // Assert: When verification expired, the bot MUST send a new question with buttons!
  const lastMsg = sentMessages[sentMessages.length - 1];
  assert(lastMsg, 'Expected a message to be sent');
  assert(
    lastMsg.reply_markup && lastMsg.reply_markup.inline_keyboard,
    `BUG REPRODUCED: Bot sent message without buttons! Text was: "${lastMsg.text}"`
  );
}

runTest().then(() => {
  console.log('TEST PASSED');
}).catch(err => {
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});
