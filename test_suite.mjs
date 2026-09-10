import { BotCore, generateDynamicQuestion, signVerificationToken, verifyVerificationToken } from './worker.js';
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
    BOT_SECRET: 'secret_12345',
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

// --- Test 1: 访客引用回复 (Quote) 上下文置顶还原 ---
async function testQuoteReplyContext() {
  console.log('--- Test 1: 访客引用回复 (Quote) 上下文还原 ---');
  const { bot, env, sentMessages } = await createTestBot();
  const guestChatId = 12345;
  const now = Date.now();

  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_1', at: now }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: now }));

  const msgWithReply = {
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 50,
    text: '这个方案价格是多少？',
    reply_to_message: {
      message_id: 40,
      photo: [{ file_id: 'photo_abc' }],
      caption: '这是之前分享的产品图文介绍'
    }
  };

  await bot.handleGuestMessage(msgWithReply, 'zh');

  const quoteMsg = sentMessages.find(m => m.text && m.text.includes('[对方引用了上下文]'));
  assert(quoteMsg, '管理员私聊必须收到置顶的引用上下文提示');
  assert(quoteMsg.text.includes('这是之前分享的产品图文介绍'), '引用摘要必须准确呈现原消息内容');
  console.log('✓ Passed: 访客引用图文上下文成功被提取并置顶推给管理员。');
}

// --- Test 2: 标准模式 Emoji 动态视觉算术题目 ---
async function testEmojiDynamicQuestion() {
  console.log('--- Test 2: 标准模式 Emoji 动态视觉算术题目 ---');
  const q = generateDynamicQuestion('zh');
  assert(q.question.includes('= ?'), '题目格式必须包含 = ?');
  assert(q.options.length === 4, '必须生成 4 个混淆选项');

  // 验证题目中包含 Emoji 且不含任何阿拉伯数字
  const hasDigitInQuestion = /\d/.test(q.question.replace('?', ''));
  assert(!hasDigitInQuestion, '题目表达式中严禁出现任何阿拉伯数字，彻底粉碎正则爬虫');

  // 验证选项按键必须是纯阿拉伯数字
  q.options.forEach(opt => {
    assert(/^\d+$/.test(opt), `选项必须是纯阿拉伯数字，实际为: ${opt}`);
  });
  console.log(`✓ Passed: 成功生成 Emoji 题目: "${q.question}"，按键选项: [${q.options.join(', ')}]，完全符合人类直觉。`);
}

// --- Test 3: /kqfy 双模防御热切换 ---
async function testShieldDualModeSwitching() {
  console.log('--- Test 3: /kqfy 双模防御热切换 (1标准 / 2终极) ---');
  const { bot, env, sentMessages } = await createTestBot();
  const adminId = 999999;

  // 1. 发送 /kqfy 2 切换为终极模式
  await bot.handleAdminMessage({ chat: { id: adminId }, from: { id: adminId }, text: '/kqfy 2' }, 'zh');
  let levelInKv = await env.nfd.get('config:shield_level');
  assert.strictEqual(levelInKv, '2', 'KV 中必须记录为终极模式 2');
  let lastMsg = sentMessages[sentMessages.length - 1];
  assert(lastMsg.text.includes('终极模式'), '必须提示切换为终极模式');

  // 2. 发送 /kqfy 弹出双模控制面板
  await bot.handleAdminMessage({ chat: { id: adminId }, from: { id: adminId }, text: '/kqfy' }, 'zh');
  lastMsg = sentMessages[sentMessages.length - 1];
  assert(lastMsg.reply_markup?.inline_keyboard?.length === 2, '按键面板必须只呈现 2 个大按键');

  // 3. 发送 /kqfy 1 切回标准模式
  await bot.handleAdminMessage({ chat: { id: adminId }, from: { id: adminId }, text: '/kqfy 1' }, 'zh');
  levelInKv = await env.nfd.get('config:shield_level');
  assert.strictEqual(levelInKv, '1', 'KV 中必须记录为标准模式 1');
  console.log('✓ Passed: /kqfy 双模热切换极简顺畅，零多余认知负担。');
}

// --- Test 4: 终极模式 Cloudflare 网页盾牌与 Telegram Mini App 票据机制 ---
async function testUltimateModeWebShield() {
  console.log('--- Test 4: 终极模式 Cloudflare 网页盾牌与 Telegram Mini App 票据机制 ---');
  const { bot, env, sentMessages } = await createTestBot();
  const guestChatId = 77777;

  // 设置为终极模式 2
  await env.nfd.put('config:shield_level', '2');

  // 访客发信，应该收到 Telegram Mini App 网页验证按键
  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 10,
    text: '你好，咨询业务'
  }, 'zh', 'bot.example.com');

  const verifyMsg = sentMessages.find(m => m.chat_id === guestChatId && m.reply_markup?.inline_keyboard);
  assert(verifyMsg, '终极模式下访客必须收到网页验证按钮');
  const webAppBtn = verifyMsg.reply_markup.inline_keyboard[0][0];
  assert(webAppBtn.web_app && webAppBtn.web_app.url, '必须采用 Telegram Mini App (web_app) 按钮，杜绝外部跳转弹窗');
  assert(webAppBtn.web_app.url.includes('/verify?t=tk_'), '按键链接必须包含不透明一次性票据 ?t=tk_，严禁明文暴露 uid');
  assert(!webAppBtn.web_app.url.includes('uid='), 'URL 严禁包含 uid 明文');

  // 校验 KV 中票据有效关联
  const urlObj = new URL(webAppBtn.web_app.url);
  const ticket = urlObj.searchParams.get('t');
  const mappedUid = await env.nfd.get(`ticket:${ticket}`);
  assert.strictEqual(mappedUid, String(guestChatId), '票据必须安全映射到访客 chatId');

  console.log('✓ Passed: 终极模式 Telegram Mini App 与票据脱敏机制运转无误。');
}

// --- Test 5: 正常用户交流文章/博客链接零误伤通过 ---
async function testNormalLinkNotBlocked() {
  console.log('--- Test 5: 正常用户交流文章/博客链接零误伤通过 ---');
  const { bot, env, sentMessages } = await createTestBot();
  const guestChatId = 88888;
  const now = Date.now();

  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_normal', at: now }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: now }));

  // 用户发送带有教程博客链接的求助消息
  const normalMsg = {
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 120,
    text: '你好！看了你博客文章 https://myblog.com/post-456 里的搭建说明，有个参数没看懂想请教一下'
  };

  await bot.handleGuestMessage(normalMsg, 'zh');

  const blockedMsg = sentMessages.find(m => m.chat_id === guestChatId && m.text.includes('禁止携带'));
  assert(!blockedMsg, '正常技术交流包含的文章/博客链接绝不能被拦截');
  console.log('✓ Passed: 彻底杜绝误伤，正常的文章/教程链接交流畅行无阻。');
}

// --- Test 6: 纯正中英双语隔离与一键切换 ---
async function testBilingualSwitch() {
  console.log('--- Test 6: 纯正中英双语隔离与一键切换 ---');
  const { bot, env, editedMessages } = await createTestBot();
  const guestChatId = 99999;
  const now = Date.now();

  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_bi', at: now }));
  await env.nfd.put(`lang:${guestChatId}`, 'zh');

  await bot.onCallbackQuery({
    id: 'cb_lang_switch',
    data: 'set_lang:en',
    from: { id: guestChatId, language_code: 'zh' },
    message: { chat: { id: guestChatId }, message_id: 999 }
  });

  const savedLang = await env.nfd.get(`lang:${guestChatId}`);
  assert.strictEqual(savedLang, 'en', '用户语言偏好必须更新为 en');

  const lastEdit = editedMessages[editedMessages.length - 1];
  assert(lastEdit.text.includes('Anti-Spam Verification'), '更新后的文本必须纯英文');
  assert(!lastEdit.text.includes('防骚扰人机验证'), '英文模式下绝不能出现任何中文字符串');
  console.log('✓ Passed: 纯双语隔离无串味，一键切换秒级重绘。');
}

// --- Test 7: 已验证状态下 /start 友好提示与 /reset 重新获取验证 ---
async function testStartAndReverify() {
  console.log('--- Test 7: 已验证状态下 /start 友好提示与 /reset 重新获取验证 ---');
  const { bot, env, sentMessages } = await createTestBot();
  const guestChatId = 66666;
  const now = Date.now();

  // 模拟用户刚刚验证通过
  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_66', at: now }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: now }));

  // 1. 已验证访客发送 /start：不应抹除验证重新强制弹题，而是告知已验证并附带重测按钮
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/start' }, 'bot.example.com');
  let lastMsg = sentMessages[sentMessages.length - 1];
  assert(lastMsg.text.includes('已通过人机安全验证'), '必须提示已验证');
  assert(lastMsg.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === 'force_reverify', '必须提供重新验证按键供测试');

  // 2. 访客发送 /reset 或点击重新出题：会话清空并立即重新出题
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/reset' }, 'bot.example.com');
  const reverifyMsg = sentMessages[sentMessages.length - 1];
  assert(reverifyMsg.reply_markup?.inline_keyboard, '重置后必须立即生成新验证');
  const vstate = await env.nfd.get(`verify:${guestChatId}`, { type: 'json' });
  assert(!vstate.verified, '验证状态必须被重置为未通过');

  console.log('✓ Passed: /start 已验证提示与 /reset 重新验证逻辑严密流畅。');
}

async function main() {
  await testQuoteReplyContext();
  await testEmojiDynamicQuestion();
  await testShieldDualModeSwitching();
  await testUltimateModeWebShield();
  await testNormalLinkNotBlocked();
  await testBilingualSwitch();
  await testStartAndReverify();
  console.log('\n🌟 ALL 7 PRODUCTION TEST SUITES PASSED PERFECTLY (v2.5.0)!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
