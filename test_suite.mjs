import { BotCore, generateDynamicQuestion, getBeijingTimeStr } from './worker.js';
import assert from 'node:assert';

async function createTestBot() {
  const sentMessages = [];
  const editedMessages = [];
  const callbacksAnswered = [];
  const copiedMessages = [];
  const forwardedMessages = [];
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
    if (method === 'copyMessage') {
      copiedMessages.push(body);
      return { ok: true, result: { message_id: 2000 + copiedMessages.length } };
    }
    if (method === 'forwardMessage') {
      forwardedMessages.push(body);
      return { ok: true, result: { message_id: 3000 + forwardedMessages.length } };
    }
    if (method === 'answerCallbackQuery') {
      callbacksAnswered.push(body);
      return { ok: true };
    }
    if (method === 'setMyCommands') {
      return { ok: true };
    }
    return { ok: true };
  };

  return { bot, env, sentMessages, editedMessages, callbacksAnswered, copiedMessages, forwardedMessages, mockKv };
}

// --- Test 1: 原生双向引用回复 (Native Quote Reply) 完美镜像呈现 ---
async function testQuoteReplyContext() {
  console.log('--- Test 1: 原生双向引用回复 (Native Quote Reply) 完美镜像呈现 ---');
  const { bot, env, sentMessages, copiedMessages, forwardedMessages } = await createTestBot();
  const guestChatId = 12345;
  const adminChatId = 999999;
  const now = Date.now();

  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_1', at: now }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: now }));

  // 1. 访客首次发送消息 (ID: 50)
  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 50,
    text: '你好，在吗？'
  }, 'zh');

  const fwdToAdmin = forwardedMessages[forwardedMessages.length - 1];
  assert(fwdToAdmin, '首次发信应转发给管理员');
  const adminFwdMsgId = 3000 + forwardedMessages.length; // 3001

  // 2. 管理员对该条消息点击 Reply 进行回复 (Admin 消息 ID: 600)
  await bot.handleAdminMessage({
    chat: { id: adminChatId },
    from: { id: adminChatId, language_code: 'zh' },
    message_id: 600,
    text: '好，你有事？',
    reply_to_message: { message_id: adminFwdMsgId }
  }, 'zh');

  const adminReplyCopy = copiedMessages[copiedMessages.length - 1];
  assert(adminReplyCopy, '管理员回复应 copyMessage 至访客私聊');
  assert.strictEqual(adminReplyCopy.chat_id, String(guestChatId));
  assert.strictEqual(adminReplyCopy.reply_parameters?.message_id, 50, '管理员发给访客的消息必须带原生 reply_parameters 引用访客原消息 50');
  const deliveredGuestMsgId = 2000 + copiedMessages.length; // 2001

  // 3. 访客在 Telegram 对管理员发来的消息 (2001) 点击 Reply 进行引用回复
  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 51,
    text: '哈哈哈哈这个表情包好好笑。',
    reply_to_message: { message_id: deliveredGuestMsgId }
  }, 'zh');

  // 4. 断言：绝严禁出现丑陋的伪造文本 [对方引用了上下文]
  const fakeNotice = sentMessages.find(m => m.text && m.text.includes('[对方引用了上下文]'));
  assert(!fakeNotice, '严禁发送额外的 [对方引用了上下文] 纯文本消息！');

  // 5. 断言：转发给管理员的消息必须带原生 reply_parameters 真实指向管理员之前的消息 600
  const guestReplyCopy = copiedMessages[copiedMessages.length - 1];
  assert(guestReplyCopy, '访客的引用回复必须以 copyMessage + reply_parameters 转发给管理员');
  assert.strictEqual(guestReplyCopy.chat_id, String(adminChatId));
  assert.strictEqual(guestReplyCopy.reply_parameters?.message_id, 600, '必须精准引用管理员的原消息 ID 600');

  // 6. 断言：10 分钟静默冷却窗口生效，访客发了两条消息（50 和 51），但只收到了 1 条 "已转发给主人" 的通知
  const waitingNotices = sentMessages.filter(m => m.chat_id === guestChatId && m.text && m.text.includes('已转发给主人'));
  assert.strictEqual(waitingNotices.length, 1, '10 分钟静默冷却窗口生效：连续发信时仅首条提示，杜绝重复刷屏');
  console.log('✓ Passed: 双向原生引用回复与发信通知防刷静默窗口完美生效。');
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
  const { bot, env, sentMessages, editedMessages, callbacksAnswered, forwardedMessages } = await createTestBot();
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

  // 1.1 未验证访客在题目未完成期间发送文本：严格零回复静默，切断脚本刷屏攻击面
  const countBeforeSpam = sentMessages.length;
  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 11,
    text: '我直接在输入框打字发答案'
  }, 'zh');
  assert.strictEqual(sentMessages.length, countBeforeSpam, '题目未完成期间发文本必须 100% 严格静默，零发信零写 KV');

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

  // 5. 验证通过后访客再次打字发信：直接静默放行送达管理员，零重复弹窗打扰！
  sentMessages.length = 0;
  const fwdCountBefore = forwardedMessages.length;
  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 11,
    text: '老板在吗？'
  }, 'zh');

  assert.strictEqual(forwardedMessages.length, fwdCountBefore + 1, '消息必须已成功转发给管理员');
  assert.strictEqual(sentMessages.length, 0, '验证有效期（3小时）内发信必须完全静默，绝不重复弹出“请耐心等待回复”刷屏');
  console.log('✓ Passed: 验证通过提示一次到位，会话有效期内消息静默转达，清爽丝滑。');
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

// --- Test 6: 已验证状态下安全闭环，彻底废除 /reset 与重新出题漏洞 ---
async function testStartAndReverify() {
  console.log('--- Test 6: 已验证状态下安全闭环，彻底废除 /reset 与重新出题漏洞 ---');
  const { bot, env, sentMessages, forwardedMessages, callbacksAnswered } = await createTestBot();
  const guestChatId = 66666;
  const now = Date.now();

  // 模拟用户刚刚验证通过
  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_66', at: now }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: now }));
  await env.nfd.put(`notify-cd:${guestChatId}`, '1');

  // 1. 已验证访客发送 /start：首次响应告知处于有效期
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/start' });
  let lastMsg = sentMessages[sentMessages.length - 1];
  assert(lastMsg.text.includes('安全验证有效期内'), '必须提示已处于安全验证有效期内');
  assert(!lastMsg.reply_markup, '生产环境安全收敛：已验证访客主界面严禁提供常驻重新验证按键');

  // 1.1 菜单防刷熔断：3 小时内重复点击 /start，必须直接静默，绝不重复发信！
  const sentCountBeforeSpamStart = sentMessages.length;
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/start' });
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/start' });
  assert.strictEqual(sentMessages.length, sentCountBeforeSpamStart, '3 小时会话期内重复点击 /start 必须完全熔断静默');

  // 1.2 访客点击 /about：首次响应
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/about' });
  const aboutMsg = sentMessages[sentMessages.length - 1];
  assert(aboutMsg.text.includes('关于此机器人'), '首次点击 /about 正常回复内容');

  // 1.3 菜单防刷熔断：3 小时内重复点击 /about，必须直接静默，零发信零写 KV！
  const sentCountBeforeSpamAbout = sentMessages.length;
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/about' });
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/about' });
  assert.strictEqual(sentMessages.length, sentCountBeforeSpamAbout, '3 小时会话期内重复点击 /about 必须完全熔断静默');

  // 2. 访客发送 /reset：彻底废除该命令，系统绝不再重置会话、绝不再出题，仅作为普通文本正常转发！
  const fwdCountBefore = forwardedMessages.length;
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/reset' });
  assert.strictEqual(forwardedMessages.length, fwdCountBefore + 1, '/reset 已被剥夺特殊指令权限，仅作为普通消息文本处理');
  const vstate = await env.nfd.get(`verify:${guestChatId}`, { type: 'json' });
  assert.strictEqual(vstate.verified, true, '验证状态绝不能被 /reset 破坏或重置');

  // 3. 针对历史旧消息残留按键 force_reverify，点击直接提示已下线，零出题零写 KV
  await bot.onCallbackQuery({
    id: 'cb_spam_reverify',
    data: 'force_reverify',
    from: { id: guestChatId, language_code: 'zh' },
    message: { chat: { id: guestChatId }, message_id: 888 }
  });
  const lastToast = callbacksAnswered[callbacksAnswered.length - 1];
  assert(lastToast.text.includes('已下线'), '历史按键必须明确告知已下线');

  console.log('✓ Passed: /reset 指令与重新验证漏洞已彻底拔除，防刷安全坚不可摧。');
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
  const { bot, env, sentMessages, copiedMessages } = await createTestBot();
  const adminId = 999999;
  const badGuestId = 33333;
  const replyGuestId = 44444;

  // 1. 管理员直接输入 UID 执行 /block
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

  // 3. 管理员长按转发消息回复 /block（验证从 JSON msg-map 中解析 UID）
  const originMsgId = 555;
  await env.nfd.put(`msg-map-${originMsgId}`, JSON.stringify({ uid: String(replyGuestId), guestMsgId: 101 }));
  await bot.handleAdminMessage({
    chat: { id: adminId },
    from: { id: adminId },
    message_id: 601,
    text: '/block',
    reply_to_message: { message_id: originMsgId }
  }, 'zh');
  const isReplyGuestBlocked = await env.nfd.get(`block:${replyGuestId}`);
  assert.strictEqual(isReplyGuestBlocked, '1', '长按回复 /block 必须精准解析 JSON 中的 uid 并成功拉黑');

  // 4. 管理员尝试长按回复已被拉黑的访客：必须主动拦截并弹出警告提示
  sentMessages.length = 0;
  const copyCountBefore = copiedMessages.length;
  await bot.handleAdminMessage({
    chat: { id: adminId },
    from: { id: adminId },
    message_id: 602,
    text: '我想跟你说一句话',
    reply_to_message: { message_id: originMsgId }
  }, 'zh');
  assert.strictEqual(copiedMessages.length, copyCountBefore, '对被拉黑用户的回复严禁实际发出');
  const warningMsg = sentMessages.find(m => m.chat_id === adminId && m.text.includes('处于拉黑名单中'));
  assert(warningMsg, '必须向管理员弹出拦截提示，告知用户已被拉黑需先 /unblock');

  // 5. 管理员长按回复 /unblock 解封
  await bot.handleAdminMessage({
    chat: { id: adminId },
    from: { id: adminId },
    message_id: 603,
    text: '/unblock',
    reply_to_message: { message_id: originMsgId }
  }, 'zh');
  const unblockedReplyGuest = await env.nfd.get(`block:${replyGuestId}`);
  assert.strictEqual(unblockedReplyGuest, null, '长按回复 /unblock 必须成功解封');

  // 6. 解封后管理员即可正常回复该访客
  await bot.handleAdminMessage({
    chat: { id: adminId },
    from: { id: adminId },
    message_id: 604,
    text: '解封后的正常回复',
    reply_to_message: { message_id: originMsgId }
  }, 'zh');
  assert.strictEqual(copiedMessages.length, copyCountBefore + 1, '解封后回复消息必须正常放行发出');

  console.log('✓ Passed: 影子拉黑静默优雅，长按回复 /block 与回复拦截守护严密。');
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
  const adminAlert = sentMessages.find(m => (m.chat_id === String(adminId) || m.chat_id === adminId) && m.text?.includes('命中敏感词'));
  assert(!adminAlert, '管理员端严禁收到告警推送，完全静默丢弃保持绝对清净');

  // 3. 管理员删除敏感词
  await bot.handleAdminMessage({ chat: { id: adminId }, from: { id: adminId }, text: '/delkw 菠菜引流' }, 'zh');
  const kwList = await bot.loadLocalKeywords();
  assert(!kwList.includes('菠菜引流'), '敏感词必须已被删除');
  console.log('✓ Passed: 敏感词动态过滤系统运转精准无误。');
}

// --- Test 10: 菜单精简（最后一行严格为 "关于"）---
async function testMenuSimplification() {
  console.log('--- Test 10: 菜单精简（最后一行严格为 "关于"）---');
  const { bot } = await createTestBot();
  let registeredGuestCommands = null;
  bot.api = async function(method, body) {
    if (method === 'setMyCommands' && body.scope?.type === 'default') {
      registeredGuestCommands = body.commands;
    }
    return { ok: true };
  };

  await bot.setupCommands();
  assert(registeredGuestCommands && registeredGuestCommands.length > 0, '必须注册访客默认指令');
  assert.strictEqual(registeredGuestCommands.length, 2, '访客端命令必须仅有 2 项，彻底移除 /reset');
  assert(!registeredGuestCommands.find(c => c.command === 'reset'), '访客菜单严禁包含 /reset 指令');
  const lastCmd = registeredGuestCommands[registeredGuestCommands.length - 1];
  assert.strictEqual(lastCmd.command, 'about', '最后一行必须是 /about');
  assert.strictEqual(lastCmd.description, '关于', '最后一行描述必须严格为 "关于"，简单明了');
  console.log('✓ Passed: 菜单彻底移除 /reset，仅保留 /start 与 /about，简单明了。');
}

// --- Test 11: 对话发言频率限制与超限零写保护 (Anti-Flood & Rate Limiting) ---
async function testRateLimitingAndQuotaProtection() {
  console.log('--- Test 11: 对话发言频率限制与超限零写保护 (Anti-Flood & Rate Limiting) ---');
  const { bot, env, sentMessages, forwardedMessages } = await createTestBot();
  const guestChatId = 77777;
  const now = Date.now();

  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_rate', at: now }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: now }));
  await env.nfd.put(`notify-cd:${guestChatId}`, '1');

  // 1. 模拟访客在 1 分钟内发送 20 条消息（正常高频打字/发图）
  for (let i = 1; i <= 20; i++) {
    await bot.handleGuestMessage({
      chat: { id: guestChatId },
      from: { id: guestChatId, language_code: 'zh' },
      message_id: 100 + i,
      text: `第 ${i} 句话`
    }, 'zh');
  }

  assert.strictEqual(forwardedMessages.length, 20, '前 20 条消息均应正常放行转发给管理员');

  // 2. 发送第 21 条（触发限频）
  sentMessages.length = 0;
  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 121,
    text: '第 21 句话（超出限制）'
  }, 'zh');

  const rateMsg = sentMessages.find(m => m.chat_id === guestChatId && m.text.includes('过于频繁'));
  assert(rateMsg, '第 21 条发信必须被频控拦截并给出双语友好提示');
  assert.strictEqual(forwardedMessages.length, 20, '超限消息绝不能转发给管理员，保护管理员手机免受轰炸');

  console.log('✓ Passed: 说话频率限制精准生效，有效抵御垃圾脚本灌水轰炸。');
}

// --- Test 12: 3 小时会话生命周期超时与二次验证闭环 (Session Expiration & Re-verification Loop) ---
async function testThreeHourSessionExpirationAndReverify() {
  console.log('--- Test 12: 3 小时会话生命周期超时与二次验证闭环 (Session Expiration & Re-verification Loop) ---');
  const { bot, env, sentMessages, forwardedMessages } = await createTestBot();
  const guestChatId = 334455;
  const now = Date.now();

  // 1. 初始化并在 T0 通过验证 (开始第 1 个 3 小时会话期)
  await env.nfd.put(`session:${guestChatId}`, JSON.stringify({ sid: 'sess_expire', at: now }));
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: now }));
  await env.nfd.put(`notify-cd:${guestChatId}`, '1');

  // 1.1 在 3 小时有效期内：点击 /about 响应 1 次，重复点击静默
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/about' });
  assert(sentMessages[sentMessages.length - 1].text.includes('关于此机器人'), '第 1 个周期内首次点击 /about 正常响应');
  const countBeforeAboutSpam = sentMessages.length;
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/about' });
  assert.strictEqual(sentMessages.length, countBeforeAboutSpam, '第 1 个周期内重复点击 /about 必须熔断静默');

  // 1.2 在 3 小时有效期内：点击 /start 响应 1 次，重复点击静默
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/start' });
  assert(sentMessages[sentMessages.length - 1].text.includes('安全验证有效期内'), '第 1 个周期内首次点击 /start 正常响应');
  const countBeforeStartSpam = sentMessages.length;
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/start' });
  assert.strictEqual(sentMessages.length, countBeforeStartSpam, '第 1 个周期内重复点击 /start 必须熔断静默');

  // 1.3 在 3 小时有效期内：发送消息直接转发，静默不扰民
  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 1,
    text: '第一周期内的消息'
  }, 'zh');
  assert.strictEqual(forwardedMessages.length, 1, '第 1 个周期内消息正常转发给管理员');

  // 2. 模拟时光飞逝：跃迁至 3 小时又 1 秒后 (10,801 秒后)
  const expiredTime = now - (3 * 3600 + 1) * 1000;
  // 更新 verify 记录中的 verifiedAt 为 3小时前，模拟自然到期；同时 KV 中的 lock 键在 3 小时后自动过期删除
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: expiredTime }));
  await env.nfd.delete(`cmd-lock:about:${guestChatId}`);
  await env.nfd.delete(`cmd-lock:start:${guestChatId}`);
  await env.nfd.delete(`notify-cd:${guestChatId}`);

  // 3. 访客在 3 小时到期后再次发送对话消息：必须强行拦截，绝对要求二次验证，消息绝不转发！
  sentMessages.length = 0;
  const fwdCountBefore = forwardedMessages.length;
  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 2,
    text: '3 小时后我回来了，再次对话'
  }, 'zh');

  assert.strictEqual(forwardedMessages.length, fwdCountBefore, '3 小时到期后，访客发出的消息绝不能转发给管理员！');
  const questionMsg = sentMessages.find(m => m.chat_id === guestChatId && m.reply_markup?.inline_keyboard);
  assert(questionMsg, '3 小时到期后再次对话，必须强行弹出 Emoji 动态视觉算术验证题！');

  // 4. 访客在 3 小时到期后若点击 /start：同样要求验证
  sentMessages.length = 0;
  await env.nfd.put(`verify:${guestChatId}`, JSON.stringify({ verified: true, verifiedAt: expiredTime }));
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/start' });
  const startQuestionMsg = sentMessages.find(m => m.chat_id === guestChatId && m.reply_markup?.inline_keyboard);
  assert(startQuestionMsg, '3 小时到期后点击 /start，同样必须弹出 Emoji 验证出题！');

  // 5. 访客答对题目完成二次验证，开启第 2 个 3 小时会话期
  const vstate = await env.nfd.get(`verify:${guestChatId}`, { type: 'json' });
  const correctChoice = vstate.correctIndex;
  await bot.onCallbackQuery({
    id: 'cb_reverify',
    from: { id: guestChatId, language_code: 'zh' },
    message: { message_id: 9999 },
    data: `v:${vstate.questionId}:${correctChoice}`
  });

  // 6. 二次验证通过后：/start 和 /about 重新获得 1 次响应配额
  sentMessages.length = 0;
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/about' });
  assert(sentMessages[sentMessages.length - 1].text.includes('关于此机器人'), '新 3 小时周期内，/about 重新响应第 1 次');
  const countNewAbout = sentMessages.length;
  await bot.onMessage({ chat: { id: guestChatId }, from: { id: guestChatId, language_code: 'zh' }, text: '/about' });
  assert.strictEqual(sentMessages.length, countNewAbout, '新周期内重复点击 /about 再次熔断静默');

  // 7. 发送消息再次正常放行转达
  await bot.handleGuestMessage({
    chat: { id: guestChatId },
    from: { id: guestChatId, language_code: 'zh' },
    message_id: 3,
    text: '通过二次验证后的新消息'
  }, 'zh');
  assert.strictEqual(forwardedMessages.length, fwdCountBefore + 1, '二次验证通过后，新消息立即正常放行转达！');

  console.log('✓ Passed: 3 小时超时再次对话必须二次验证，/about 与 /start 严格跟随 3 小时生命周期。');
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
  await testMenuSimplification();
  await testRateLimitingAndQuotaProtection();
  await testThreeHourSessionExpirationAndReverify();
  console.log('\n🌟 ALL 12 PRODUCTION TEST SUITES PASSED PERFECTLY (v3.6.2-Shield)!');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
