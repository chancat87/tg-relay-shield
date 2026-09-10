import { BotCore, generateDynamicQuestion, getBeijingTimeStr } from './worker.js';
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

// --- Test 3: 趣味 Emoji 验证交互流程 (点击正确答案立即放行发信) ---
async function testEmojiVerificationFlow() {
  console.log('--- Test 3: 趣味 Emoji 原生验证交互流程 ---');
  const { bot, env, sentMessages, editedMessages, callbacksAnswered } = await createTestBot();
  const guestChatId = 77777;

  // 1. 访客初次发信，触发 Emoji 出题
  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 10,
    text: '你好，咨询业务'
  }, 'zh');

  const verifyMsg = sentMessages.find(m => m.chat_id === guestChatId && m.reply_markup?.inline_keyboard);
  assert(verifyMsg, '访客初次发信必须收到 Emoji 视觉算术题目');
  assert(verifyMsg.text.includes('防骚扰人机验证'), '必须发送人机验证说明');

  // 2. 从 KV 读取当前题目的正确答案索引
  const vstate = await env.nfd.get(`verify:${guestChatId}`, { type: 'json' });
  assert(!vstate.verified, '出题后初始状态为未验证');
  const correctIdx = vstate.correctIndex;
  const qid = vstate.questionId;

  // 3. 访客点击正确答案 (v:qid:correctIndex)
  await bot.onCallbackQuery({
    id: 'cb_test_correct',
    data: `v:${qid}:${correctIdx}`,
    from: { id: guestChatId, language_code: 'zh' },
    message: { chat: { id: guestChatId }, message_id: 1001 }
  });

  // 4. 验证回调反馈与状态更新
  const cbAns = callbacksAnswered.find(c => c.callback_query_id === 'cb_test_correct');
  assert(cbAns, '必须应答 Callback Query');
  const successEdit = editedMessages.find(m => m.text && m.text.includes('验证通过'));
  assert(successEdit, '消息必须原地被更新为“验证通过”');

  const updatedState = await env.nfd.get(`verify:${guestChatId}`, { type: 'json' });
  assert.strictEqual(updatedState.verified, true, 'KV 中必须记录为已验证通过');

  // 5. 验证通过后访客再次打字发信，直接放行送达管理员，绝不弹出任何验证
  sentMessages.length = 0;
  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 11,
    text: '老板在吗？'
  }, 'zh');

  const notifyMsg = sentMessages.find(m => m.chat_id === guestChatId && m.text.includes('已转发给主人'));
  assert(notifyMsg, '验证通过后访客消息必须成功转发给管理员并给出送达提示');
  console.log('✓ Passed: Emoji 原生验证点击通过后即刻畅行无阻，无任何延迟死循环。');
}

// --- Test 4: 正常用户交流文章/博客链接零误伤通过 ---
async function testNormalLinkNotBlocked() {
  console.log('--- Test 4: 正常用户交流文章/博客链接零误伤通过 ---');
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

// --- Test 5: 纯正中英双语隔离与一键切换 ---
async function testBilingualSwitch() {
  console.log('--- Test 5: 纯正中英双语隔离与一键切换 ---');
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

// --- Test 6: 已验证状态下 /start 友好提示与 /reset 重新获取验证 ---
async function testStartAndReverify() {
  console.log('--- Test 6: 已验证状态下 /start 友好提示与 /reset 重新获取验证 ---');
  const { bot, env, sentMessages } = await createTestBot();
  const guestChatId = 66666;
  const now = Date.now();

  // 模拟用户刚刚验证通过
  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_66', at: now }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: now }));

  // 1. 已验证访客发送 /start：告知已验证并附带重测按钮
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/start' });
  let lastMsg = sentMessages[sentMessages.length - 1];
  assert(lastMsg.text.includes('已通过人机安全验证'), '必须提示已验证');
  assert(lastMsg.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === 'force_reverify', '必须提供重新验证按键供测试');

  // 2. 访客发送 /reset：会话清空并立即重新出题
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/reset' });
  const reverifyMsg = sentMessages[sentMessages.length - 1];
  assert(reverifyMsg.reply_markup?.inline_keyboard, '重置后必须立即生成新验证');
  const vstate = await env.nfd.get(`verify:${guestChatId}`, { type: 'json' });
  assert(!vstate.verified, '验证状态必须被重置为未通过');

  console.log('✓ Passed: /start 已验证提示与 /reset 重新验证逻辑严密流畅。');
}

// --- Test 7: 连续答错 3 次自动熔断锁定 (Anti-DDoS 零写保护) ---
async function testLockoutAfterThreeFails() {
  console.log('--- Test 7: 连续答错 3 次自动熔断锁定 (Anti-DDoS 零写保护) ---');
  const { bot, env, editedMessages, callbacksAnswered } = await createTestBot();
  const guestChatId = 55555;
  const now = Date.now();

  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_fail', at: now }));
  await bot.issueQuestion(guestChatId, 'zh', 'sess_fail', 0);

  // 模拟连续答错 3 次
  for (let i = 1; i <= 3; i++) {
    const vstate = await env.nfd.get(`verify:${guestChatId}`, { type: 'json' });
    const wrongIdx = (vstate.correctIndex + 1) % 4;
    await bot.onCallbackQuery({
      id: `cb_fail_${i}`,
      data: `v:${vstate.questionId}:${wrongIdx}`,
      from: { id: guestChatId, language_code: 'zh' },
      message: { chat: { id: guestChatId }, message_id: 888 }
    });
  }

  // 验证第 3 次答错后被锁定 30 分钟
  const finalState = await env.nfd.get(`verify:${guestChatId}`, { type: 'json' });
  assert(finalState.lockedUntil > Date.now(), '3 次答错必须锁定');

  const lockoutMsg = editedMessages.find(m => m.text && m.text.includes('达到上限'));
  assert(lockoutMsg, '第 3 次错误必须向访客展示锁定提示');
  console.log('✓ Passed: 连错 3 次触发 30 分钟静默熔断，免费配额受护无虞。');
}

// --- Test 8: 管理员影子静默拉黑与解封 (/block & /unblock) ---
async function testAdminShadowban() {
  console.log('--- Test 8: 管理员影子静默拉黑与解封 (/block & /unblock) ---');
  const { bot, env, sentMessages } = await createTestBot();
  const adminId = 999999;
  const badGuestId = 33333;

  // 1. 管理员执行 /block
  await bot.handleAdminMessage({ chat: { id: adminId }, from: { id: adminId }, text: `/block ${badGuestId}` }, 'zh');
  const isBlocked = await env.nfd.get(`block:${badGuestId}`);
  assert.strictEqual(isBlocked, '1', 'KV 中必须记录为已拉黑');

  // 2. 被拉黑者发信，机器人后台静默丢弃
  sentMessages.length = 0;
  await bot.handleGuestMessage({
    chat: { id: badGuestId },
    from: { id: badGuestId, language_code: 'zh' },
    message_id: 300,
    text: '恶意广告推广内容'
  }, 'zh');
  assert.strictEqual(sentMessages.length, 0, '被拉黑者发信必须被 100% 静默丢弃');

  // 3. 管理员执行 /unblock
  await bot.handleAdminMessage({ chat: { id: adminId }, from: { id: adminId }, text: `/unblock ${badGuestId}` }, 'zh');
  const unblocked = await env.nfd.get(`block:${badGuestId}`);
  assert.strictEqual(unblocked, null, '解封后 block 记录必须被删除');
  console.log('✓ Passed: 影子拉黑静默优雅，解封干净利落。');
}

// --- Test 9: 广告黑产关键词添加、拦截与删除 (/addkw & /delkw) ---
async function testKeywordFiltering() {
  console.log('--- Test 9: 广告黑产关键词添加、拦截与删除 (/addkw & /delkw) ---');
  const { bot, env, sentMessages } = await createTestBot();
  const adminId = 999999;
  const guestChatId = 22222;
  const now = Date.now();

  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_kw', at: now }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: now }));

  // 1. 管理员添加敏感词
  await bot.handleAdminMessage({ chat: { id: adminId }, from: { id: adminId }, text: '/addkw 菠菜引流' }, 'zh');

  // 2. 访客发送命中关键词的内容
  sentMessages.length = 0;
  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 401,
    text: '专业博彩项目，菠菜引流首选'
  }, 'zh');

  const blockedNotice = sentMessages.find(m => m.chat_id === guestChatId && m.text.includes('被拦截的敏感内容'));
  assert(blockedNotice, '访客端必须收到敏感词拦截提示');
  const adminAlert = sentMessages.find(m => m.chat_id === String(adminId) && m.text.includes('命中敏感词'));
  assert(adminAlert, '管理员端必须收到精准告警');

  // 3. 管理员删除敏感词
  await bot.handleAdminMessage({ chat: { id: adminId }, from: { id: adminId }, text: '/delkw 菠菜引流' }, 'zh');
  const kwList = await bot.loadLocalKeywords();
  assert(!kwList.includes('菠菜引流'), '敏感词必须已被删除');
  console.log('✓ Passed: 敏感词动态过滤系统运转精准无误。');
}

async function main() {
  await testQuoteReplyContext();
  await testEmojiDynamicQuestion();
  await testEmojiVerificationFlow();
  await testNormalLinkNotBlocked();
  await testBilingualSwitch();
  await testStartAndReverify();
  await testLockoutAfterThreeFails();
  await testAdminShadowban();
  await testKeywordFiltering();
  console.log('\n🌟 ALL 9 PRODUCTION TEST SUITES PASSED PERFECTLY (v3.0.0-Shield)!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
