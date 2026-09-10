/**
 * Telegram 私聊中转与智能防骚扰机器人 (TG-Relay-Shield)
 * 
 * GitHub: https://github.com/chancat87/tg-relay-shield
 * License: MIT
 * Version: 3.0.0-Shield (Pure & Robust)
 * 
 * 核心架构特性：
 * 1. 趣味 Emoji 动态视觉算术 (Native Telegram Shield)：
 *    - 100% 原生运行于 Telegram 消息按键内，零外部网页跳转、零第三方依赖，永无跨地域缓存延迟
 *    - 内置 16 种无歧义通用高辨识 Emoji，题目如 🍎🍎 + 🍎🍎🍎 = ?
 *    - 题目文本完全不含阿拉伯数字，彻底粉碎通用爬虫正则表达式
 *    - 答案按键 100% 采用标准阿拉伯数字，极佳人类心算体验，手机端零排版挤压
 * 2. 访客“引用回复 (Quote)”上下文还原：
 *    - 解决 Telegram 转发丢失引用气泡痛点。当访客引用历史图片或文字提问时，自动置顶推送上下文摘要
 * 3. 100% 纯正中英双语隔离与自适应一键切换：
 *    - 纯中文环境与纯英文环境彻底物理隔离，杜绝混杂
 *    - 答题键盘底部内嵌专属切换按钮，就地即刻无感重绘
 * 4. 3 次答错熔断锁死 (Anti-DDoS)：
 *    - 连错 3 次锁定 30 分钟，锁定期间对恶意连点实施零写 KV 静默拦截，保卫免费额度
 * 5. 静默影子拉黑 (Shadowban)：
 *    - 管理员 /block 静默丢弃，绝不发通知刺激对方换小号
 * 6. 身份隔离菜单体系 (Scope-based)：
 *    - 访客端极简（/start, /reset, /about），管理员端专属全功能指令（/help, /block, /unblock, /addkw, /delkw, /listkw, /about）
 */

// ========================= 基础辅助与环境兼容 =========================

function getEnv(env, name, fallbackName = null) {
  if (env && env[name] !== undefined && env[name] !== null && env[name] !== '') return env[name];
  if (fallbackName && env && env[fallbackName] !== undefined && env[fallbackName] !== null && env[fallbackName] !== '') return env[fallbackName];
  try {
    if (globalThis[name] !== undefined && globalThis[name] !== null && globalThis[name] !== '') return globalThis[name];
    if (fallbackName && globalThis[fallbackName] !== undefined && globalThis[fallbackName] !== null && globalThis[fallbackName] !== '') return globalThis[fallbackName];
  } catch (_) {}
  return undefined;
}

function getIntEnv(env, name, def, fallbackName = null) {
  const v = parseInt(getEnv(env, name, fallbackName), 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

const BOT_VERSION = '3.3.1-Shield';

function getBeijingTimeStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss} (北京时间 / UTC+8)`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function timingSafeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

// ========================= Emoji 动态视觉算术出题器 =========================

const EMOJI_POOL = ['🍎', '🍊', '🍇', '🍓', '🍒', '⭐', '🎈', '🚀', '🐱', '🐶', '🚗', '☕', '🎁', '🌻', '💎', '🔔'];

function generateDynamicQuestion(lang = 'zh') {
  const isAdd = Math.random() > 0.4;
  const emoji = EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
  let a, b, answer, opStr;

  if (isAdd) {
    a = Math.floor(Math.random() * 4) + 1; // 1 ~ 4
    b = Math.floor(Math.random() * 4) + 1; // 1 ~ 4
    answer = a + b;
    opStr = '+';
  } else {
    a = Math.floor(Math.random() * 4) + 4; // 4 ~ 7
    b = Math.floor(Math.random() * 3) + 1; // 1 ~ 3
    answer = a - b;
    opStr = '-';
  }

  // 题目文本完全使用单种 Emoji，文本不出现任何阿拉伯数字，人类秒看心算
  const questionText = `${emoji.repeat(a)} ${opStr} ${emoji.repeat(b)} = ?`;

  // 生成 3 个互不相同且靠近正确答案的干扰项
  const wrongSet = new Set();
  let tries = 0;
  while (wrongSet.size < 3 && tries < 30) {
    tries++;
    const delta = (Math.floor(Math.random() * 3) + 1) * (Math.random() > 0.5 ? 1 : -1);
    const wrong = answer + delta;
    if (wrong > 0 && wrong !== answer) {
      wrongSet.add(wrong);
    }
  }
  let fallbackVal = 1;
  while (wrongSet.size < 3) {
    if (fallbackVal !== answer && !wrongSet.has(fallbackVal)) {
      wrongSet.add(fallbackVal);
    }
    fallbackVal++;
  }

  const options = [answer, ...Array.from(wrongSet)];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  return {
    id: Math.random().toString(36).slice(2, 10),
    question: questionText,
    options: options.map(String),
    correctIndex: options.indexOf(answer)
  };
}

// ========================= 纯正中英双语独立字典 (100% 隔离) =========================

const I18N = {
  zh: {
    adminStart: '👋 您好，管理员！TG-Relay-Shield 正在正常运行。\n\n输入 /help 可查看管理指令手册。',
    guestStart: '👋 您好！我是私聊中转助手。\n\n请直接在此发送消息，我会帮您安全转达给主人，并把回复带给您。',
    guestAbout: 'ℹ️ <b>关于此机器人</b>\n\n• 本机器人是主人的公开私聊中继助手。\n• 您可以直接在此发送文字、图片、语音或文件留言。\n• 机器人会自动将您的消息转交主人，主人的回复也会原样转达给您。\n• 沟通全程双方真实账号受到隐私保护。',
    verifyPrompt: '🛡 <b>防骚扰人机验证</b>\n请数出下方表情数量并点击正确答案：\n\n',
    verifyPick: '\n\n👇 请点击正确数字：',
    verifySuccess: '✅ 验证通过！现已可以和主人对话，我会帮您转达给主人，请耐心等待回复。',
    verifyWaitingHint: '👆 请直接点击上方题目的数字按钮作答。',
    verifyWrongNotice: '❌ 答案错误！还剩 {rem} 次机会',
    verifyLockoutToast: '❌ 连续错误 {count} 次！已被锁定 30 分钟。',
    verifyLockoutMsg: '🚫 验证失败次数达到上限（{count}/3）。\n系统已暂停您的验证操作，请在 30 分钟后再试。',
    lockoutActive: '🚫 验证错误过多，已被系统锁定！请等待 {min} 分钟后再发送消息。',
    verifyExpiredMsg: '⚠️ 上次验证已过期，已为您重新生成题目：\n\n',
    verifyExpiredToast: '⚠️ 题目已过期，已为您生成新题目！',
    sessionExpired: '⚠️ 会话已过期，请重新发送消息开始。',
    adminReplyPrompt: '🙅 请对【转发过来的用户消息】点击“Reply/回复”进行回复，否则无法识别收件人。',
    forwardFail: '抱歉，消息未能转发给主人，请稍后重试。',
    notifyWaiting: '🔔 您的消息已转发给主人，请耐心等待回复。',
    keywordBlocked: '⚠️ 您的消息包含被拦截的敏感内容，未予转交。',
    rateLimited: '⏳ 您发送消息过于频繁，请稍后再试。',
    guestVerifiedStart: '👋 您好！我是私聊中转助手。\n\n您处于安全验证有效期内，可以直接在此发送文字、图片、语音或文件留言，我会帮您转达给主人，请耐心等待回复。',
    reverifyBtn: '🔄 重新验证 / 重新出题',
    reverifyNotice: '正在为您生成新验证...',
    reverifyPrompt: '🔄 会话与验证状态已重置，请完成以下验证：',
    resetCooldown: '⏳ 操作过于频繁，请在 {sec} 秒后再试。',
    langSwitched: '✅ 语言已切换为简体中文',
    switchLangBtn: '🌐 Switch to English'
  },
  en: {
    adminStart: '👋 Hello Admin! TG-Relay-Shield is running normally.\n\nType /help to view the admin command manual.',
    guestStart: "👋 Hello! I am the contact relay assistant.\n\nSend your message here, and I will safely forward it to the owner and bring back their reply.",
    guestAbout: 'ℹ️ <b>About This Bot</b>\n\n• This bot is the owner\'s public contact relay.\n• Feel free to send text, photos, files, or voice messages.\n• Messages are securely relayed to the owner, and replies are forwarded back.\n• Personal identities remain private for secure communication.',
    verifyPrompt: '🛡 <b>Anti-Spam Verification</b>\nPlease count the emojis and tap the correct answer:\n\n',
    verifyPick: '\n\n👇 Tap the correct number:',
    verifySuccess: '✅ Verified! You can now chat with the owner. Your messages will be relayed, please wait for a reply.',
    verifyWaitingHint: '👆 Please tap the number button on the question above.',
    verifyWrongNotice: '❌ Wrong answer! {rem} attempt(s) remaining.',
    verifyLockoutToast: '❌ Failed {count} times! Locked for 30 minutes.',
    verifyLockoutMsg: '🚫 Verification limit reached ({count}/3).\nYou have been locked out for 30 minutes. Please try again later.',
    lockoutActive: '🚫 Too many failed attempts. You are locked out. Please wait {min} minute(s).',
    verifyExpiredMsg: '⚠️ Previous verification expired. A new question has been generated:\n\n',
    verifyExpiredToast: '⚠️ Question expired! New question generated.',
    sessionExpired: '⚠️ Session expired. Please send a message to start again.',
    adminReplyPrompt: '🙅 Please reply directly to the forwarded message so I know the recipient.',
    forwardFail: 'Sorry, failed to forward your message. Please try again later.',
    notifyWaiting: '🔔 Your message has been forwarded. Please wait for a reply.',
    keywordBlocked: '⚠️ Your message contained blocked keywords and was dropped.',
    rateLimited: '⏳ You are sending messages too fast. Please slow down.',
    guestVerifiedStart: "👋 Hello! I am the contact relay assistant.\n\nYou are verified! Feel free to send text, photos, files, or voice messages here and I will relay them to the owner, please wait for a reply.",
    reverifyBtn: '🔄 Re-verify / New Challenge',
    reverifyNotice: 'Generating new challenge...',
    reverifyPrompt: '🔄 Session and verification reset. Please complete verification:',
    resetCooldown: '⏳ Too many requests. Please wait {sec} second(s).',
    langSwitched: '✅ Language switched to English',
    switchLangBtn: '🌐 切换为简体中文'
  }
};

function t(lang, key, params = {}) {
  const isZh = !lang || lang.startsWith('zh');
  const dict = isZh ? I18N.zh : I18N.en;
  let str = dict[key] || I18N.zh[key] || '';
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return str;
}

// ========================= 核心处理器 =========================

class BotCore {
  constructor(env) {
    this.env = env;
    this.kv = env.nfd || globalThis.nfd;
    if (!this.kv) {
      throw new Error('KV Namespace "nfd" 未绑定，请在设置中将 KV 变量名绑定为 nfd');
    }

    this.token = getEnv(env, 'BOT_TOKEN', 'ENV_BOT_TOKEN');
    this.secret = getEnv(env, 'BOT_SECRET', 'ENV_BOT_SECRET') || 'default_secret';
    this.adminSecret = getEnv(env, 'ADMIN_SECRET') || this.secret;
    
    const adminUidsStr = String(getEnv(env, 'ADMIN_UID', 'ENV_ADMIN_UID') || '');
    this.adminUids = adminUidsStr.split(',').map(s => s.trim()).filter(Boolean);
    this.primaryAdminUid = this.adminUids[0] || '';

    this.webhookPath = (getEnv(env, 'WEBHOOK_PATH') || '/endpoint').trim();
    if (!this.webhookPath.startsWith('/')) this.webhookPath = '/' + this.webhookPath;
    
    this.adminPath = String(getEnv(env, 'ADMIN_PATH') || 'admin_path').replace(/^\/+|\/+$/g, '');
    this.verifiedTtlSeconds = getIntEnv(env, 'VERIFIED_TTL_SECONDS', 3 * 3600);
    this.rateLimitCount = getIntEnv(env, 'RATE_LIMIT_MESSAGE', 20); // 60 秒内最多 20 条，平衡正常交流与脚本防御
    this.rateLimitWindow = getIntEnv(env, 'RATE_LIMIT_WINDOW_SECONDS', 60);
    this.notifyCooldownSeconds = getIntEnv(env, 'NOTIFY_COOLDOWN_SECONDS', this.verifiedTtlSeconds); // 提示生命周期完全对齐验证有效期（默认 3 小时）

    this.maxFailAttempts = 3;
    this.lockoutDurationMs = 30 * 60 * 1000;
  }

  isAdmin(uid) {
    return this.adminUids.includes(String(uid));
  }

  async api(method, body = {}) {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // --- 纯正中英双语管理 ---
  async getUserLang(userId, tgLang) {
    const saved = await this.kv.get(`lang:${userId}`);
    if (saved === 'zh' || saved === 'en') return saved;
    if (tgLang && typeof tgLang === 'string') {
      return tgLang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    }
    return 'zh';
  }

  async setUserLang(userId, lang) {
    const chosen = lang === 'en' ? 'en' : 'zh';
    await this.kv.put(`lang:${userId}`, chosen, { expirationTtl: 30 * 86400 });
    return chosen;
  }

  // --- 敏感词过滤 ---
  async loadLocalKeywords() {
    try {
      const data = await this.kv.get('kw-list', { type: 'json' });
      return Array.isArray(data) ? data : [];
    } catch (_) {
      return [];
    }
  }

  async checkKeywordHit(text) {
    if (!text) return null;
    const list = await this.loadLocalKeywords();
    if (!list.length) return null;
    for (const kw of list) {
      if (!kw) continue;
      const re = new RegExp(escapeRegExp(kw), 'i');
      if (re.test(text)) return kw;
    }
    return null;
  }

  // --- 频控检查 (带超限零写保护) ---
  async checkRateLimit(chatId) {
    const now = Math.floor(Date.now() / 1000);
    const key = `ratelimit:${chatId}`;
    const record = await this.kv.get(key, { type: 'json' }).catch(() => null);

    if (!record || now - record.start >= this.rateLimitWindow) {
      await this.kv.put(key, JSON.stringify({ count: 1, start: now }), { expirationTtl: this.rateLimitWindow });
      return false;
    }

    if (record.count > this.rateLimitCount) {
      // 已经超限：直接秒拒，严禁继续写 KV 消耗配额
      return true;
    }

    record.count += 1;
    await this.kv.put(key, JSON.stringify(record), { expirationTtl: this.rateLimitWindow });
    return record.count > this.rateLimitCount;
  }

  // --- 构造答题键盘 (纯阿拉伯数字按键 + 底部单键切换语言) ---
  buildQuestionKeyboard(q, lang) {
    const isZh = lang === 'zh';
    const keyboard = [];
    for (let i = 0; i < q.options.length; i += 2) {
      const row = [{ text: q.options[i], callback_data: `v:${q.id}:${i}` }];
      if (i + 1 < q.options.length) {
        row.push({ text: q.options[i + 1], callback_data: `v:${q.id}:${i + 1}` });
      }
      keyboard.push(row);
    }
    const nextLang = isZh ? 'en' : 'zh';
    const switchLabel = t(lang, 'switchLangBtn');
    keyboard.push([{ text: switchLabel, callback_data: `set_lang:${nextLang}` }]);
    return { inline_keyboard: keyboard };
  }

  // --- 访客验证状态获取 ---
  async getVerificationState(chatId) {
    return await this.kv.get(`verify:${chatId}`, { type: 'json' }).catch(() => null);
  }

  // --- 发送 Emoji 动态视觉算术题目 ---
  async issueQuestion(chatId, lang, sessionId, failCount = 0) {
    const q = generateDynamicQuestion(lang);
    const state = {
      sessionId,
      questionId: q.id,
      correctIndex: q.correctIndex,
      exp: Date.now() + 10 * 60 * 1000,
      verified: false,
      failCount: failCount,
      lockedUntil: 0
    };
    await this.kv.put(`verify:${chatId}`, JSON.stringify(state), { expirationTtl: this.verifiedTtlSeconds });

    const keyboard = this.buildQuestionKeyboard(q, lang);
    const text = `${t(lang, 'verifyPrompt')}${q.question}${t(lang, 'verifyPick')}`;
    await this.api('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  // --- Update 入口 ---
  async handleUpdate(update, hostname = '') {
    if (update.message) {
      await this.onMessage(update.message, hostname);
    } else if (update.callback_query) {
      await this.onCallbackQuery(update.callback_query, hostname);
    }
  }

  // --- 消息路由 ---
  async onMessage(msg, hostname = '') {
    const chatId = msg.chat.id;
    const fromId = msg.from?.id;
    const text = (msg.text || '').trim();
    const isAdmin = this.isAdmin(fromId);
    const lang = await this.getUserLang(fromId, msg.from?.language_code);

    // 1. 专属 /about 响应
    if (text === '/about') {
      if (isAdmin) {
        const localKws = await this.loadLocalKeywords();
        const info =
          `🤖 <b>TG-Relay-Shield 核心概况</b>\n\n` +
          `• <b>核心版本</b>: <code>${BOT_VERSION}</code>\n` +
          `• <b>防御引擎</b>: <code>趣味 Emoji 动态视觉算术 (Native Shield)</code>\n` +
          `• <b>本地拦截词数</b>: <code>${localKws.length}</code> 条\n` +
          `• <b>部署平台</b>: Cloudflare Workers\n` +
          `• <b>系统健康状态</b>: 运转良好 ✅`;
        await this.api('sendMessage', { chat_id: chatId, text: info, parse_mode: 'HTML' });
      } else {
        await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'guestAbout'), parse_mode: 'HTML' });
      }
      return;
    }

    // 2. /start 流程
    if (text === '/start') {
      if (isAdmin) {
        await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'adminStart') });
      } else {
        const sess = await this.kv.get(`session:${chatId}`, { type: 'json' }).catch(() => null);
        const vstate = await this.getVerificationState(chatId);

        // 检查熔断锁定
        if (vstate && vstate.lockedUntil && Date.now() < vstate.lockedUntil) {
          const waitMin = Math.ceil((vstate.lockedUntil - Date.now()) / 60000);
          await this.api('sendMessage', {
            chat_id: chatId,
            text: t(lang, 'lockoutActive', { min: waitMin })
          });
          return;
        }

        // 检查用户是否已验证过
        const isVerified = vstate && vstate.verified && (Date.now() - vstate.verifiedAt < this.verifiedTtlSeconds * 1000);
        if (isVerified) {
          // 生产环境安全加固：已验证访客直接提示正常沟通，不再在主界面暴露常驻重新验证按钮，从根源杜绝恶意脚本刷题
          await this.api('sendMessage', {
            chat_id: chatId,
            text: t(lang, 'guestVerifiedStart')
          });
          return;
        }

        // 未验证：初始化会话并立即出题
        const newSessionId = (sess && sess.sid) || Math.random().toString(36).slice(2, 10);
        if (!sess) {
          await this.kv.put(`session:${chatId}`, JSON.stringify({ sid: newSessionId, at: Date.now() }), { expirationTtl: 30 * 86400 });
        }
        await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'guestStart') });
        await this.issueQuestion(chatId, lang, newSessionId, 0);
      }
      return;
    }

    if (isAdmin) {
      await this.handleAdminMessage(msg, lang);
      return;
    }

    await this.handleGuestMessage(msg, lang, hostname);
  }

  // --- 管理员命令中枢 ---
  async handleAdminMessage(msg, lang) {
    const adminChatId = msg.chat.id;
    const text = (msg.text || '').trim();

    // /block (静默影子拉黑)
    if (/^\/block(?:\s+(\d+))?$/i.test(text)) {
      const match = text.match(/^\/block(?:\s+(\d+))?$/i);
      let targetUid = match && match[1];
      if (!targetUid && msg.reply_to_message) {
        targetUid = await this.kv.get(`msg-map-${msg.reply_to_message.message_id}`);
      }
      if (!targetUid) {
        await this.api('sendMessage', { chat_id: adminChatId, text: '❌ 无法定位目标用户。请回复转发的消息或输入 `/block 用户ID`', parse_mode: 'Markdown' });
        return;
      }
      if (this.isAdmin(targetUid)) {
        await this.api('sendMessage', { chat_id: adminChatId, text: '⚠️ 不能拉黑管理员自己！' });
        return;
      }

      await this.kv.put(`block:${targetUid}`, '1');
      await this.api('sendMessage', {
        chat_id: adminChatId,
        text: `✅ 用户 \`${targetUid}\` 已被【静默拉黑】。\n对方发信将被机器人静默丢弃，不发通知刺激对方。`,
        parse_mode: 'Markdown'
      });
      return;
    }

    // /unblock
    if (/^\/unblock(?:\s+(\d+))?$/i.test(text)) {
      const match = text.match(/^\/unblock(?:\s+(\d+))?$/i);
      let targetUid = match && match[1];
      if (!targetUid && msg.reply_to_message) {
        targetUid = await this.kv.get(`msg-map-${msg.reply_to_message.message_id}`);
      }
      if (!targetUid) {
        await this.api('sendMessage', { chat_id: adminChatId, text: '❌ 无法定位目标用户。', parse_mode: 'Markdown' });
        return;
      }
      await this.kv.delete(`block:${targetUid}`);
      await this.kv.delete(`verify:${targetUid}`);
      await this.kv.delete(`notify-cd:${targetUid}`);
      await this.api('sendMessage', { chat_id: adminChatId, text: `✅ 用户 \`${targetUid}\` 已解除屏蔽并清空惩罚状态。`, parse_mode: 'Markdown' });
      return;
    }

    // /addkw
    if (/^\/addkw\s+(.+)$/i.test(text)) {
      const kw = text.match(/^\/addkw\s+(.+)$/i)[1].trim();
      const list = await this.loadLocalKeywords();
      if (!list.includes(kw)) {
        list.push(kw);
        await this.kv.put('kw-list', JSON.stringify(list));
      }
      await this.api('sendMessage', { chat_id: adminChatId, text: `✅ 已添加拦截词：\`${kw}\``, parse_mode: 'Markdown' });
      return;
    }

    // /delkw
    if (/^\/delkw\s+(.+)$/i.test(text)) {
      const kw = text.match(/^\/delkw\s+(.+)$/i)[1].trim();
      let list = await this.loadLocalKeywords();
      list = list.filter(w => w !== kw);
      await this.kv.put('kw-list', JSON.stringify(list));
      await this.api('sendMessage', { chat_id: adminChatId, text: `✅ 已删除拦截词：\`${kw}\``, parse_mode: 'Markdown' });
      return;
    }

    // /listkw
    if (/^\/listkw$/i.test(text)) {
      const list = await this.loadLocalKeywords();
      const body = list.length ? list.map((w, i) => `${i + 1}. \`${w}\``).join('\n') : '(暂无拦截词)';
      await this.api('sendMessage', { chat_id: adminChatId, text: `📃 <b>当前本地拦截关键词：</b>\n${body}`, parse_mode: 'HTML' });
      return;
    }

    // /help
    if (/^\/help$/i.test(text)) {
      const help = `🛠 <b>TG-Relay-Shield 管理手册</b>\n\n` +
        `• <b>回复访客</b>: 对转发的消息长按点击 <b>Reply</b> 即可打字回复\n` +
        `• <code>/block [uid]</code>: 静默影子拉黑（不惊动对方）\n` +
        `• <code>/unblock [uid]</code>: 解除屏蔽并清空惩罚\n` +
        `• <code>/addkw &lt;词&gt;</code>: 添加广告敏感拦截词\n` +
        `• <code>/delkw &lt;词&gt;</code>: 删除指定拦截词\n` +
        `• <code>/listkw</code>: 查看当前所有敏感词\n` +
        `• <code>/about</code>: 查看系统运行状态指标`;
      await this.api('sendMessage', { chat_id: adminChatId, text: help, parse_mode: 'HTML' });
      return;
    }

    // 核心转发：管理员回复消息回传给访客（附带原生引用回复）
    if (msg.reply_to_message) {
      const originMsgId = msg.reply_to_message.message_id;
      const rawMapping = await this.kv.get(`msg-map-${originMsgId}`);
      if (!rawMapping) {
        await this.api('sendMessage', { chat_id: adminChatId, text: '❌ 无法定位该消息对应的访客（可能已过期或非转接消息）。' });
        return;
      }

      let targetGuestUid = rawMapping;
      let targetGuestMsgId = null;
      try {
        const parsed = JSON.parse(rawMapping);
        if (parsed && typeof parsed === 'object') {
          targetGuestUid = parsed.uid;
          targetGuestMsgId = parsed.guestMsgId;
        }
      } catch (_) {}

      const copyParams = {
        chat_id: targetGuestUid,
        from_chat_id: adminChatId,
        message_id: msg.message_id
      };

      if (targetGuestMsgId) {
        copyParams.reply_parameters = {
          message_id: parseInt(targetGuestMsgId, 10),
          allow_sending_without_reply: true
        };
      }

      const copyRes = await this.api('copyMessage', copyParams);

      if (copyRes && copyRes.ok && copyRes.result) {
        const deliveredGuestMsgId = copyRes.result.message_id;
        // 记录双向映射，有效期 14 天
        await this.kv.put(`guest-to-admin:${deliveredGuestMsgId}`, String(msg.message_id), { expirationTtl: 14 * 86400 });
        await this.kv.put(`msg-map-${msg.message_id}`, JSON.stringify({ uid: String(targetGuestUid), guestMsgId: deliveredGuestMsgId }), { expirationTtl: 14 * 86400 });
      } else {
        await this.api('sendMessage', { chat_id: adminChatId, text: `❌ 回复发送失败：${copyRes?.error || copyRes?.description || '未知原因'}` });
      }
      return;
    }

    // 管理员发送了非命令、非回复文本
    if (text && !text.startsWith('/')) {
      await this.api('sendMessage', { chat_id: adminChatId, text: t(lang, 'adminReplyPrompt') });
    }
  }

  // --- 访客发信处理中枢 ---
  async handleGuestMessage(msg, lang, hostname = '') {
    const chatId = msg.chat.id;

    // 1. 静默拉黑检查 (Shadowban)
    const isBlocked = await this.kv.get(`block:${chatId}`);
    if (isBlocked) return;

    // 2. 会话检查
    let sess = await this.kv.get(`session:${chatId}`, { type: 'json' }).catch(() => null);
    if (!sess) {
      const newSessionId = Math.random().toString(36).slice(2, 10);
      sess = { sid: newSessionId, at: Date.now() };
      await this.kv.put(`session:${chatId}`, JSON.stringify(sess), { expirationTtl: 30 * 86400 });
    }

    // 3. 熔断锁死与验证状态检查
    const vstate = await this.getVerificationState(chatId);
    if (vstate && vstate.lockedUntil && Date.now() < vstate.lockedUntil) {
      const waitMin = Math.ceil((vstate.lockedUntil - Date.now()) / 60000);
      await this.api('sendMessage', {
        chat_id: chatId,
        text: t(lang, 'lockoutActive', { min: waitMin })
      });
      return;
    }

    const isVerified = vstate && vstate.verified && (Date.now() - vstate.verifiedAt < this.verifiedTtlSeconds * 1000);
    if (!isVerified) {
      const hasActiveQuestion = vstate && !vstate.verified && vstate.exp && Date.now() < vstate.exp;
      if (hasActiveQuestion) {
        await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'verifyWaitingHint') });
      } else {
        await this.issueQuestion(chatId, lang, sess.sid, vstate?.failCount || 0);
      }
      return;
    }

    // 4. 频控检查
    const limited = await this.checkRateLimit(chatId);
    if (limited) {
      await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'rateLimited') });
      return;
    }

    // 5. 敏感词拦截检查 (正常交流链接不拦截，只拦截黑产违禁词)
    const searchable = (msg.text || '') + (msg.caption || '');
    const hitWord = await this.checkKeywordHit(searchable);
    if (hitWord) {
      await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'keywordBlocked') });
      if (this.primaryAdminUid) {
        await this.api('sendMessage', {
          chat_id: this.primaryAdminUid,
          text: `⚠️ 拦截来自 <code>${chatId}</code> 的消息，命中敏感词：<code>${escapeHtml(hitWord)}</code>`,
          parse_mode: 'HTML'
        });
      }
      return;
    }

    // 6. 核心转发至管理员（支持原生引用回复双向映射）
    if (!this.primaryAdminUid) {
      await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'forwardFail') });
      return;
    }

    let targetAdminMsgId = null;
    if (msg.reply_to_message) {
      targetAdminMsgId = await this.kv.get(`guest-to-admin:${msg.reply_to_message.message_id}`);
    }

    let fwdRes;
    if (targetAdminMsgId) {
      // 访客回复了某条消息：通过 copyMessage 附带原生 reply_parameters 呈现 Telegram 原生引用回复气泡
      fwdRes = await this.api('copyMessage', {
        chat_id: this.primaryAdminUid,
        from_chat_id: chatId,
        message_id: msg.message_id,
        reply_parameters: {
          message_id: parseInt(targetAdminMsgId, 10),
          allow_sending_without_reply: true
        }
      });
    } else {
      // 访客普通发信：通过 forwardMessage 完整保留来源信息
      fwdRes = await this.api('forwardMessage', {
        chat_id: this.primaryAdminUid,
        from_chat_id: chatId,
        message_id: msg.message_id
      });
    }

    if (fwdRes && fwdRes.ok && fwdRes.result) {
      const adminFwdMsgId = fwdRes.result.message_id;
      // 记录双向映射（保留 14 天）
      await this.kv.put(`msg-map-${adminFwdMsgId}`, JSON.stringify({ uid: String(chatId), guestMsgId: msg.message_id }), { expirationTtl: 14 * 86400 });
      await this.kv.put(`guest-to-admin:${msg.message_id}`, String(adminFwdMsgId), { expirationTtl: 14 * 86400 });
      
      // 消息送达提示：实施 10 分钟静默冷却窗口，单窗口期内仅首条发送提示，杜绝连续发信重复刷屏
      const notifyKey = `notify-cd:${chatId}`;
      const hasNotified = await this.kv.get(notifyKey);
      if (!hasNotified) {
        await this.kv.put(notifyKey, '1', { expirationTtl: this.notifyCooldownSeconds });
        await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'notifyWaiting') });
      }
    } else {
      await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'forwardFail') });
    }
  }

  // --- 回调查询处理 (按键点击) ---
  async onCallbackQuery(cbq, hostname = '') {
    const userId = cbq.from.id;
    const data = cbq.data || '';
    const messageId = cbq.message?.message_id;
    let lang = await this.getUserLang(userId, cbq.from?.language_code);

    // 1. 访客单键切换语言 (set_lang:zh | set_lang:en)
    if (data.startsWith('set_lang:')) {
      const newLang = data.split(':')[1];
      lang = await this.setUserLang(userId, newLang);
      await this.api('answerCallbackQuery', {
        callback_query_id: cbq.id,
        text: t(lang, 'langSwitched')
      });

      const newQ = generateDynamicQuestion(lang);
      const sess = await this.kv.get(`session:${userId}`, { type: 'json' }).catch(() => null);
      const activeSess = sess || { sid: Math.random().toString(36).slice(2, 10), at: Date.now() };
      
      const vstate = {
        sessionId: activeSess.sid,
        questionId: newQ.id,
        correctIndex: newQ.correctIndex,
        exp: Date.now() + 10 * 60 * 1000,
        verified: false,
        failCount: 0,
        lockedUntil: 0
      };
      await this.kv.put(`verify:${userId}`, JSON.stringify(vstate), { expirationTtl: this.verifiedTtlSeconds });

      const keyboard = this.buildQuestionKeyboard(newQ, lang);
      await this.api('editMessageText', {
        chat_id: userId,
        message_id: messageId,
        text: `${t(lang, 'verifyPrompt')}${newQ.question}${t(lang, 'verifyPick')}`,
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
      return;
    }

    // 2. 兼容历史旧消息按键：彻底废除重新出题，防止任何刷题滥用
    if (data === 'force_reverify') {
      await this.api('answerCallbackQuery', {
        callback_query_id: cbq.id,
        text: '该功能已下线，请直接发送消息与主人沟通。',
        show_alert: true
      });
      return;
    }

    // 3. 验证选项点击 (v:qid:index)
    if (!data.startsWith('v:')) {
      await this.api('answerCallbackQuery', { callback_query_id: cbq.id });
      return;
    }

    const parts = data.split(':');
    const qid = parts[1];
    const choiceIdx = parseInt(parts[2], 10);

    const vstate = await this.kv.get(`verify:${userId}`, { type: 'json' }).catch(() => null);
    const sess = await this.kv.get(`session:${userId}`, { type: 'json' }).catch(() => null);

    // 熔断锁定期间，零写 KV 秒拒
    if (vstate && vstate.lockedUntil && Date.now() < vstate.lockedUntil) {
      const waitMin = Math.ceil((vstate.lockedUntil - Date.now()) / 60000);
      await this.api('answerCallbackQuery', {
        callback_query_id: cbq.id,
        text: t(lang, 'lockoutActive', { min: waitMin }),
        show_alert: true
      });
      return;
    }

    // 题目过期：重新出题并就地重绘
    if (!vstate || !sess || vstate.questionId !== qid || Date.now() > vstate.exp) {
      const activeSess = sess || { sid: Math.random().toString(36).slice(2, 10), at: Date.now() };
      if (!sess) {
        await this.kv.put(`session:${userId}`, JSON.stringify(activeSess), { expirationTtl: 30 * 86400 });
      }

      const newQ = generateDynamicQuestion(lang);
      const newState = {
        sessionId: activeSess.sid,
        questionId: newQ.id,
        correctIndex: newQ.correctIndex,
        exp: Date.now() + 10 * 60 * 1000,
        verified: false,
        failCount: vstate?.failCount || 0,
        lockedUntil: 0
      };
      await this.kv.put(`verify:${userId}`, JSON.stringify(newState), { expirationTtl: this.verifiedTtlSeconds });

      await this.api('answerCallbackQuery', {
        callback_query_id: cbq.id,
        text: t(lang, 'verifyExpiredToast')
      });

      const keyboard = this.buildQuestionKeyboard(newQ, lang);
      if (messageId) {
        await this.api('editMessageText', {
          chat_id: userId,
          message_id: messageId,
          text: `${t(lang, 'verifyExpiredMsg')}${t(lang, 'verifyPrompt')}${newQ.question}${t(lang, 'verifyPick')}`,
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      }
      return;
    }

    // 答对通过
    if (choiceIdx === vstate.correctIndex) {
      vstate.verified = true;
      vstate.verifiedAt = Date.now();
      vstate.failCount = 0;
      vstate.lockedUntil = 0;
      await this.kv.put(`verify:${userId}`, JSON.stringify(vstate), { expirationTtl: this.verifiedTtlSeconds });
      // 验证通过时已明确提示，将等待通知的静默期与验证有效期（3 小时）完全对齐，会话期内后续发信 100% 静默转达
      await this.kv.put(`notify-cd:${userId}`, '1', { expirationTtl: this.verifiedTtlSeconds });
      
      await this.api('answerCallbackQuery', { callback_query_id: cbq.id, text: '✅ OK' });
      await this.api('editMessageText', {
        chat_id: userId,
        message_id: messageId,
        text: t(lang, 'verifySuccess')
      });
      return;
    }

    // 答错处理
    const currentFails = (vstate.failCount || 0) + 1;
    vstate.failCount = currentFails;

    // 连续错 3 次，立刻熔断锁定 30 分钟
    if (currentFails >= this.maxFailAttempts) {
      vstate.lockedUntil = Date.now() + this.lockoutDurationMs;
      await this.kv.put(`verify:${userId}`, JSON.stringify(vstate), { expirationTtl: Math.ceil(this.lockoutDurationMs / 1000) });

      await this.api('answerCallbackQuery', {
        callback_query_id: cbq.id,
        text: t(lang, 'verifyLockoutToast', { count: currentFails }),
        show_alert: true
      });

      await this.api('editMessageText', {
        chat_id: userId,
        message_id: messageId,
        text: t(lang, 'verifyLockoutMsg', { count: currentFails })
      });
      return;
    }

    // 答错但未达上限：重新出题并提示剩余次数
    const remaining = this.maxFailAttempts - currentFails;
    await this.api('answerCallbackQuery', {
      callback_query_id: cbq.id,
      text: t(lang, 'verifyWrongNotice', { rem: remaining }),
      show_alert: true
    });

    const newQ = generateDynamicQuestion(lang);
    vstate.questionId = newQ.id;
    vstate.correctIndex = newQ.correctIndex;
    vstate.exp = Date.now() + 10 * 60 * 1000;
    await this.kv.put(`verify:${userId}`, JSON.stringify(vstate), { expirationTtl: this.verifiedTtlSeconds });

    const keyboard = this.buildQuestionKeyboard(newQ, lang);
    await this.api('editMessageText', {
      chat_id: userId,
      message_id: messageId,
      text: `❌ ${t(lang, 'verifyWrongNotice', { rem: remaining })}\n\n${t(lang, 'verifyPrompt')}${newQ.question}${t(lang, 'verifyPick')}`,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  // --- 自动化命令菜单设置 (按 Scope 物理隔离) ---
  async setupCommands() {
    const guestCommands = [
      { command: 'start', description: '启动会话 / 留言咨询' },
      { command: 'about', description: '关于' }
    ];
    await this.api('setMyCommands', { commands: guestCommands, scope: { type: 'default' } });

    const adminCommands = [
      { command: 'help', description: '📖 查看管理指令手册' },
      { command: 'about', description: '关于' },
      { command: 'block', description: '🥷 静默拉黑 (回复某条消息或输入UID)' },
      { command: 'unblock', description: '🕊️ 解除对访客的拉黑' },
      { command: 'addkw', description: '➕ 添加敏感拦截词' },
      { command: 'delkw', description: '➖ 删除指定拦截词' },
      { command: 'listkw', description: '📋 查看所有敏感拦截词' }
    ];

    for (const uid of this.adminUids) {
      if (!uid) continue;
      await this.api('setMyCommands', {
        commands: adminCommands,
        scope: { type: 'chat', chat_id: parseInt(uid, 10) }
      });
    }
  }

  async registerWebhook(hostname) {
    const webhookUrl = `https://${hostname}${this.webhookPath}`;
    const res = await this.api('setWebhook', {
      url: webhookUrl,
      secret_token: this.secret,
      allowed_updates: ['message', 'edited_message', 'callback_query', 'chat_member'],
      drop_pending_updates: false
    });
    await this.setupCommands();
    return res;
  }
}

// ========================= 路由与导出 =========================

async function handleHttp(request, env, ctx) {
  const bot = new BotCore(env);
  const url = new URL(request.url);
  const path = url.pathname;

  // Telegram Webhook 端点
  if (path === bot.webhookPath) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const secretHdr = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (!timingSafeEqual(secretHdr, bot.secret)) {
      return new Response('Unauthorized', { status: 403 });
    }
    try {
      const update = await request.json();
      if (ctx && ctx.waitUntil) {
        ctx.waitUntil(bot.handleUpdate(update, url.hostname));
      } else {
        await bot.handleUpdate(update, url.hostname);
      }
      return new Response('OK');
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  }

  // 一键注册端点
  if (path === '/quick-setup') {
    const res = await bot.registerWebhook(url.hostname);
    return new Response(JSON.stringify(res, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  // 根路径：动态运行状态面板
  const acceptsHtml = (request.headers.get('Accept') || '').includes('text/html');
  const noCacheHeaders = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  };

  if (acceptsHtml) {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TG-Relay-Shield 运行状态</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 36px 28px; max-width: 480px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
    .header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .shield-icon { font-size: 32px; }
    h1 { font-size: 20px; font-weight: 700; color: #f1f5f9; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(34, 197, 94, 0.15); color: #4ade80; padding: 4px 10px; border-radius: 9999px; font-size: 13px; font-weight: 600; margin-bottom: 24px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 10px #22c55e; }
    .meta-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 28px; }
    .meta-item { display: flex; justify-content: space-between; font-size: 14px; padding: 10px 14px; background: #0f172a; border-radius: 8px; }
    .meta-label { color: #94a3b8; }
    .meta-value { font-family: monospace; font-weight: 600; color: #38bdf8; }
    .footer { font-size: 13px; color: #64748b; text-align: center; border-top: 1px solid #334155; padding-top: 18px; }
    .footer a { color: #38bdf8; text-decoration: none; font-weight: 500; }
    .footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="shield-icon">🛡️</div>
      <div>
        <h1>TG-Relay-Shield</h1>
        <div style="font-size: 13px; color: #94a3b8;">Telegram 防骚扰双向中继机器人</div>
      </div>
    </div>
    <div class="status-badge">
      <div class="status-dot"></div>
      服务正常运转中 (Operational)
    </div>
    <div class="meta-list">
      <div class="meta-item">
        <span class="meta-label">系统核心版本</span>
        <span class="meta-value">${BOT_VERSION}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">防御引擎</span>
        <span class="meta-value">趣味 Emoji 动态视觉算术</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">运行架构</span>
        <span class="meta-value">Cloudflare Workers + KV</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">查询时间</span>
        <span class="meta-value">${getBeijingTimeStr()}</span>
      </div>
    </div>
    <div class="footer">
      开源仓库: <a href="https://github.com/chancat87/tg-relay-shield" target="_blank">chancat87/tg-relay-shield</a>
    </div>
  </div>
</body>
</html>`;
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        ...noCacheHeaders
      }
    });
  }

  return new Response(`Telegram Relay Bot is Running! (${BOT_VERSION})\nDefense Engine: Emoji Dynamic Visual Shield\nTime: ${getBeijingTimeStr()}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...noCacheHeaders
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    return handleHttp(request, env, ctx);
  }
};

export { BotCore, generateDynamicQuestion, getBeijingTimeStr };

if (typeof addEventListener === 'function') {
  addEventListener('fetch', event => {
    event.respondWith(handleHttp(event.request, globalThis, event));
  });
}
