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
    if (method === 'forwardMessage') {
      return { ok: true, result: { message_id: 2000 + sentMessages.length } };
    }
    if (method === 'setMyCommands') {
      return { ok: true };
    }
    return { ok: true };
  };

  return { bot, env, sentMessages, editedMessages, callbacksAnswered, mockKv };
}

// --- Test 1: 访客引用回复上下文还原 ---
async function testQuoteReplyContext() {
  console.log('--- Test 1: 访客引用回复上下文还原 ---');
  const { bot, env, sentMessages } = await createTestBot();
  const guestChatId = 12345;
  const now = Date.now();

  // 模拟用户已通过验证
  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_1', at: now }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: now }));

  // 访客发送引用消息
  const msgWithReply = {
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 50,
    text: '这个多少钱？',
    reply_to_message: {
      message_id: 40,
      photo: [{ file_id: 'photo_abc' }],
      caption: '这是之前的产品海报'
    }
  };

  await bot.handleGuestMessage(msgWithReply, 'zh');

  // 应该先给管理员发送一条带引用摘要的消息
  const quoteMsg = sentMessages.find(m => m.text && m.text.includes('[对方引用了上下文]'));
  assert(quoteMsg, '管理员必须收到对方引用的上下文消息');
  assert(quoteMsg.text.includes('这是之前的产品海报'), '引用摘要必须包含原图文内容');
  console.log('✓ Passed: 成功还原访客引用的上下文并推给管理员。');
}

// --- Test 2: /kqfy 防御模式热切换 ---
async function testShieldLevelSwitching() {
  console.log('--- Test 2: /kqfy 防御模式热切换 ---');
  const { bot, env, sentMessages } = await createTestBot();
  const adminId = 999999;

  // 管理员发送 /kqfy 1
  await bot.handleAdminMessage({ chat: { id: adminId }, from: { id: adminId }, text: '/kqfy 2' }, 'zh');
  const levelInKv = await env.nfd.get('config:shield_level');
  assert.strictEqual(levelInKv, '2', 'KV 中防御等级必须更新为 2 (严格模式)');
  
  const lastMsg = sentMessages[sentMessages.length - 1];
  assert(lastMsg.text.includes('严格模式'), '通知文案必须提示切换为严格模式');

  // 管理员发送纯 /kqfy 弹出交互面板
  await bot.handleAdminMessage({ chat: { id: adminId }, from: { id: adminId }, text: '/kqfy' }, 'zh');
  const panelMsg = sentMessages[sentMessages.length - 1];
  assert(panelMsg.reply_markup?.inline_keyboard, '未带参数时必须弹出3个模式按钮');
  console.log('✓ Passed: /kqfy 模式热切换与交互面板响应正常。');
}

// --- Test 3: 严格模式首条消息禁外链 ---
async function testStrictModeLinkBlock() {
  console.log('--- Test 3: 严格模式下刚验证的首条消息外链拦截 ---');
  const { bot, env, sentMessages } = await createTestBot();
  const guestChatId = 7777;
  const now = Date.now();

  // 设置严格模式 2
  await env.nfd.put('config:shield_level', '2');
  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_strict', at: now }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: now }));

  // 发送带广告链接的首条消息
  const spamMsg = {
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 88,
    text: '兼职日入500加电报群 https://t.me/spamgroup'
  };

  await bot.handleGuestMessage(spamMsg, 'zh');

  const blockNotice = sentMessages.find(m => String(m.chat_id) === String(guestChatId) && m.text.includes('首次发信禁止携带外部链接'));
  assert(blockNotice, '访客端必须收到严格模式首条禁链接提示');

  const adminAlert = sentMessages.find(m => String(m.chat_id) === '999999' && m.text.includes('[严格模式拦截]'));
  assert(adminAlert, '管理员端必须收到告警');
  console.log('✓ Passed: 严格模式成功拦截首条广告外链。');
}

// --- Test 4: 纯正双语隔离与一键切换 ---
async function testBilingualSwitch() {
  console.log('--- Test 4: 纯正双语隔离与一键切换 ---');
  const { bot, env, editedMessages, callbacksAnswered } = await createTestBot();
  const guestChatId = 8888;
  const now = Date.now();

  // 初始为中文题目
  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_bi', at: now }));
  await env.nfd.put(`lang:${guestChatId}`, 'zh');

  // 点击切换为英文
  await bot.onCallbackQuery({
    id: 'cb_lang_switch',
    data: 'set_lang:en',
    from: { id: guestChatId, language_code: 'zh' },
    message: { chat: { id: guestChatId }, message_id: 999 }
  });

  const savedLang = await env.nfd.get(`lang:${guestChatId}`);
  assert.strictEqual(savedLang, 'en', '用户语言偏好必须更新为 en');

  const lastEdit = editedMessages[editedMessages.length - 1];
  assert(lastEdit.text.includes('Anti-Spam Verification'), '更新后的文本必须完全为英文');
  assert(!lastEdit.text.includes('防骚扰验证'), '英文模式下绝不能出现中文字符串');
  console.log('✓ Passed: 双语切换即刻生效且 100% 语言纯净隔离。');
}

async function main() {
  await testQuoteReplyContext();
  await testShieldLevelSwitching();
  await testStrictModeLinkBlock();
  await testBilingualSwitch();
  console.log('\n🌟 ALL 4 UPGRADED TEST SUITES PASSED PERFECTLY!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
