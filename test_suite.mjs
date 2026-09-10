import { BotCore } from './worker.js';
import assert from 'node:assert';

async function createTestBot() {
  const sentMessages = [];
  const editedMessages = [];
  const callbacksAnswered = [];
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

  bot.api = async function(method, body) {
    if (method === 'sendMessage') {
      sentMessages.push(body);
      return { ok: true, result: { message_id: 1000 + sentMessages.length } };
    }
    if (method === 'editMessageText') {
      editedMessages.push(body);
      return { ok: true, result: { message_id: body.message_id } };
    }
    if (method === 'answerCallbackQuery') {
      callbacksAnswered.push(body);
      return { ok: true };
    }
    return { ok: true };
  };

  return { bot, env, sentMessages, editedMessages, callbacksAnswered, mockKv };
}

async function testExpiredVerificationAutoReissue() {
  console.log('--- Test 1: Expired verification auto-reissue ---');
  const { bot, env, sentMessages } = await createTestBot();
  const guestChatId = 1111;
  const now = Date.now();

  // Expired verification
  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_1', at: now - 5 * 3600 * 1000 }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({
    sessionId: 'sess_1',
    questionId: 'q_old',
    correctIndex: 0,
    exp: now - 3.5 * 3600 * 1000,
    verified: true,
    verifiedAt: now - 4 * 3600 * 1000,
    failCount: 0,
    lockedUntil: 0
  }));

  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    text: '你好',
    message_id: 101
  }, 'zh');

  assert.strictEqual(sentMessages.length, 1);
  const msg = sentMessages[0];
  assert(msg.reply_markup?.inline_keyboard, 'Must have inline keyboard buttons');
  assert(msg.text.includes('为了防止广告骚扰'), 'Must prompt for verification');
  console.log('✓ Passed: Expired verification triggered new question with buttons.');
}

async function testActiveQuestionThrottlesPrompt() {
  console.log('--- Test 2: Active question in progress prompts to tap buttons ---');
  const { bot, env, sentMessages } = await createTestBot();
  const guestChatId = 2222;
  const now = Date.now();

  // Question issued 1 minute ago (still active)
  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_2', at: now - 60000 }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({
    sessionId: 'sess_2',
    questionId: 'q_active',
    correctIndex: 1,
    exp: now + 9 * 60 * 1000, // active!
    verified: false,
    failCount: 0,
    lockedUntil: 0
  }));

  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    text: '测试等待中',
    message_id: 102
  }, 'zh');

  assert.strictEqual(sentMessages.length, 1);
  assert(sentMessages[0].text.includes('请直接点击上方题目的按钮作答'), 'Should remind to tap existing active buttons');
  console.log('✓ Passed: Active question reminds user to use buttons without spamming new questions.');
}

async function testClickExpiredButtonAutoRefreshes() {
  console.log('--- Test 3: Click expired button in-place refreshes to new question ---');
  const { bot, env, editedMessages, callbacksAnswered } = await createTestBot();
  const guestChatId = 3333;
  const now = Date.now();

  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_3', at: now - 3600000 }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({
    sessionId: 'sess_3',
    questionId: 'q_old_button',
    correctIndex: 0,
    exp: now - 1000, // expired!
    verified: false,
    failCount: 0,
    lockedUntil: 0
  }));

  await bot.onCallbackQuery({
    id: 'cb_123',
    data: 'v:q_old_button:0',
    from: { id: guestChatId, language_code: 'zh' },
    message: { chat: { id: guestChatId }, message_id: 555 }
  });

  assert.strictEqual(callbacksAnswered.length, 1);
  assert(callbacksAnswered[0].text.includes('已为您生成新题目'));
  assert.strictEqual(editedMessages.length, 1);
  assert(editedMessages[0].reply_markup?.inline_keyboard, 'Must have new keyboard');
  assert(editedMessages[0].text.includes('已为您重新出题'));
  console.log('✓ Passed: Clicking expired button in-place refreshes question seamlessly.');
}

async function main() {
  await testExpiredVerificationAutoReissue();
  await testActiveQuestionThrottlesPrompt();
  await testClickExpiredButtonAutoRefreshes();
  console.log('\nALL 3 REGRESSION TESTS PASSED!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
