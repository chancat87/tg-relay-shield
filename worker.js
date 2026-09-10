/**
 * Telegram 私聊中转与智能防骚扰机器人 (TG-Relay-Shield)
 * 
 * GitHub: https://github.com/your-username/tg-relay-shield
 * License: MIT
 * Version: 2.5.0-Shield (Production Ready)
 * 
 * 核心架构特性：
 * 1. 趣味 Emoji 动态视觉算术：
 *    - 内置 16 种无歧义通用高辨识 Emoji，题目如 🍎🍎 + 🍎🍎🍎 = ?
 *    - 题目文本完全不含阿拉伯数字，彻底粉碎通用爬虫正则表达式
 *    - 答案按键 100% 采用标准阿拉伯数字，极佳人类心算体验，手机端零排版挤压
 * 2. 战备级“双模防御”热切换 (/kqfy)：
 *    - 模式 1【标准模式】：Emoji 计数验证（默认，不限制任何正常博客与教程链接交流）
 *    - 模式 2【终极模式】：Cloudflare 官方网页人机盾牌 (Turnstile / Web Challenge)，遭遇脚本轰炸一键开启
 * 3. 访客“引用回复 (Quote)”上下文还原：
 *    - 解决 Telegram 转发丢失引用气泡的痛点。当访客引用历史图片或文字提问时，自动置顶推送上下文摘要
 * 4. 100% 纯正中英双语隔离与自适应一键切换：
 *    - 纯中文环境与纯英文环境彻底物理隔离，杜绝混杂
 *    - 答题键盘底部内嵌专属切换按钮，就地即刻无感重绘
 * 5. 3 次答错熔断锁死 (Anti-DDoS)：
 *    - 连错 3 次锁定 30 分钟，锁定期间对恶意连点实施零写 KV 静默拦截，保卫免费额度
 * 6. 静默影子拉黑 (Shadowban)：
 *    - 管理员 /block 静默丢弃，绝不发通知刺激对方换小号
 * 7. 身份隔离菜单体系 (Scope-based)：
 *    - 访客端极简（/start, /about），管理员端专属全功能指令
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

const BOT_VERSION = '2.5.0-Shield';

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

// HMAC-SHA256 签名与验证（用于终极模式网页防篡改）
async function signVerificationToken(uid, exp, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${uid}:${exp}`));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyVerificationToken(uid, exp, sig, secret) {
  if (Date.now() > exp) return false;
  const expected = await signVerificationToken(uid, exp, secret);
  return timingSafeEqual(sig, expected);
}

// 提取访客引用回复的消息摘要
function extractQuoteSnippet(replyMsg) {
  if (!replyMsg) return '';
  if (replyMsg.text) return replyMsg.text.slice(0, 60);
  if (replyMsg.caption) return replyMsg.caption.slice(0, 60);
  if (replyMsg.photo) return '📷 [图片 / Photo]';
  if (replyMsg.sticker) return '🎭 [贴纸 / Sticker]';
  if (replyMsg.voice) return '🎤 [语音 / Voice]';
  if (replyMsg.video) return '🎬 [视频 / Video]';
  if (replyMsg.document) return `📄 [文件: ${replyMsg.document.file_name || 'Document'}]`;
  return '📎 [媒体内容 / Media]';
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
    verifyPrompt: '🛡 <b>防骚扰人机验证</b>\n请数出下方表情数量并点击正确答案：\n\n❓ ',
    verifyPick: '\n\n👇 请点击正确数字：',
    verifySuccess: '✅ 验证通过！现在您可以正常发送消息留言了。',
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
    rateLimited: '⏳ 发送频率过快，请稍后再试。',
    ultimateVerifyPrompt: '🛡 <b>高防安全验证</b>\n系统当前处于高防状态，请点击下方按钮完成安全验证：',
    ultimateVerifyBtn: '🛡️ 点击进入安全验证 (Cloudflare)',
    langSwitched: '✅ 语言已切换为简体中文',
    switchLangBtn: '🌐 Switch to English'
  },
  en: {
    adminStart: '👋 Hello Admin! TG-Relay-Shield is running normally.\n\nType /help to view the admin command manual.',
    guestStart: "👋 Hello! I am the contact relay assistant.\n\nSend your message here, and I will safely forward it to the owner and bring back their reply.",
    guestAbout: 'ℹ️ <b>About This Bot</b>\n\n• This bot is the owner\'s public contact relay.\n• Feel free to send text, photos, files, or voice messages.\n• Messages are securely relayed to the owner, and replies are forwarded back.\n• Personal identities remain private for secure communication.',
    verifyPrompt: '🛡 <b>Anti-Spam Verification</b>\nPlease count the emojis and tap the correct answer:\n\n❓ ',
    verifyPick: '\n\n👇 Tap the correct number:',
    verifySuccess: '✅ Verified! You can now send messages normally.',
    verifyWaitingHint: '👆 Please tap one of the number buttons above.',
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
    rateLimited: '⏳ You are sending too fast. Please wait a moment.',
    ultimateVerifyPrompt: '🛡 <b>Security Verification</b>\nHigh-security shield is active. Tap the button below to complete verification:',
    ultimateVerifyBtn: '🛡️ Complete Verification (Cloudflare)',
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
    this.rateLimitCount = getIntEnv(env, 'RATE_LIMIT_MESSAGE', 45);
    this.rateLimitWindow = getIntEnv(env, 'RATE_LIMIT_WINDOW_SECONDS', 60);

    // Turnstile 配置 (可选，如未配置则网页盾使用内置防刷挑战)
    this.turnstileSiteKey = getEnv(env, 'TURNSTILE_SITE_KEY') || '';
    this.turnstileSecretKey = getEnv(env, 'TURNSTILE_SECRET_KEY') || '';

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
      console.error(`Telegram API (${method}) 失败:`, err);
      return { ok: false, description: err.message };
    }
  }

  // --- 防御等级读取 (1: 标准 Emoji 模式, 2: 终极网页盾牌) ---
  async getShieldLevel() {
    const raw = await this.kv.get('config:shield_level');
    const level = parseInt(raw, 10);
    return [1, 2].includes(level) ? level : 1;
  }

  async setShieldLevel(level) {
    const lvl = [1, 2].includes(level) ? level : 1;
    await this.kv.put('config:shield_level', String(lvl));
    return lvl;
  }

  // --- 用户语言读取/偏好 ---
  async getUserLang(userId, fallbackCode = 'zh') {
    const saved = await this.kv.get(`lang:${userId}`);
    if (saved === 'en' || saved === 'zh') return saved;
    return (fallbackCode && fallbackCode.toLowerCase().startsWith('zh')) ? 'zh' : 'en';
  }

  async setUserLang(userId, lang) {
    const l = lang === 'en' ? 'en' : 'zh';
    await this.kv.put(`lang:${userId}`, l, { expirationTtl: 180 * 86400 });
    return l;
  }

  async loadLocalKeywords() {
    try {
      const arr = await this.kv.get('kw-list', { type: 'json' });
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  async checkKeywordHit(text) {
    if (!text) return null;
    const low = text.toLowerCase();
    const localWords = await this.loadLocalKeywords();
    
    let remoteWords = [];
    try {
      const raw = await this.kv.get('blocked-words-cache', { type: 'json' });
      if (raw && Array.isArray(raw.words)) remoteWords = raw.words;
    } catch (_) {}

    const all = [...localWords, ...remoteWords];
    for (const word of all) {
      const k = String(word || '').trim().toLowerCase();
      if (!k) continue;
      if (/^[a-z0-9]+$/.test(k)) {
        const re = new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i');
        if (re.test(low)) return word;
      } else if (low.includes(k)) {
        return word;
      }
    }
    return null;
  }

  async checkRateLimit(chatId) {
    if (this.rateLimitCount <= 0) return false;
    const key = `rate:${chatId}`;
    const now = Date.now();
    let data = await this.kv.get(key, { type: 'json' }).catch(() => null);
    
    if (!data || !data.start || (now - data.start) > (this.rateLimitWindow * 1000)) {
      data = { start: now, count: 1 };
      await this.kv.put(key, JSON.stringify(data), { expirationTtl: Math.max(60, this.rateLimitWindow) }).catch(() => {});
      return false;
    }

    data.count += 1;
    if (data.count === 5 || data.count === 15 || data.count > this.rateLimitCount) {
      await this.kv.put(key, JSON.stringify(data), { expirationTtl: Math.max(60, this.rateLimitWindow) }).catch(() => {});
    }
    return data.count > this.rateLimitCount;
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

  // --- 发送新题目（根据防御模式分流） ---
  async issueQuestion(chatId, lang, sessionId, failCount = 0, hostname = '') {
    const shieldLevel = await this.getShieldLevel();

    // 模式 2：终极模式 (发送 Cloudflare 网页验证盾牌链接)
    if (shieldLevel === 2 && hostname) {
      const exp = Date.now() + 15 * 60 * 1000;
      const sig = await signVerificationToken(chatId, exp, this.secret);
      const verifyUrl = `https://${hostname}/verify?uid=${chatId}&exp=${exp}&sig=${sig}`;

      const keyboard = {
        inline_keyboard: [
          [{ text: t(lang, 'ultimateVerifyBtn'), url: verifyUrl }]
        ]
      };
      await this.api('sendMessage', {
        chat_id: chatId,
        text: t(lang, 'ultimateVerifyPrompt'),
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
      return;
    }

    // 模式 1：标准模式 (Emoji 动态趣味算术)
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
        const shieldLevel = await this.getShieldLevel();
        const modeNames = { 1: '1. 标准模式 (Emoji 视觉算术)', 2: '2. 终极模式 (Cloudflare 网页盾牌)' };
        const localKws = await this.loadLocalKeywords();
        const info = `🤖 <b>TG-Relay-Shield 系统状态</b>\n\n` +
          `• <b>核心版本</b>: <code>${BOT_VERSION}</code>\n` +
          `• <b>生效防御等级</b>: <code>${modeNames[shieldLevel] || modeNames[1]}</code>\n` +
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
        const vstate = await this.kv.get(`verify:${chatId}`, { type: 'json' }).catch(() => null);

        // 检查熔断锁定
        if (vstate && vstate.lockedUntil && Date.now() < vstate.lockedUntil) {
          const waitMin = Math.ceil((vstate.lockedUntil - Date.now()) / 60000);
          await this.api('sendMessage', {
            chat_id: chatId,
            text: t(lang, 'lockoutActive', { min: waitMin })
          });
          return;
        }

        if (sess && vstate && vstate.verified && (Date.now() - vstate.verifiedAt < this.verifiedTtlSeconds * 1000)) {
          await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'guestStart') });
          return;
        }

        const newSessionId = Math.random().toString(36).slice(2, 10);
        await this.kv.put(`session:${chatId}`, JSON.stringify({ sid: newSessionId, at: Date.now() }), { expirationTtl: 30 * 86400 });
        await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'guestStart') });
        await this.issueQuestion(chatId, lang, newSessionId, 0, hostname);
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

    // /kqfy 双模防御热切换 (支持 /kqfy 1|2 或纯发 /kqfy 弹出面板)
    if (/^\/kqfy(?:\s+(\d+))?$/i.test(text)) {
      const match = text.match(/^\/kqfy(?:\s+(\d+))?$/i);
      const argLvl = match && match[1] ? parseInt(match[1], 10) : null;

      if (argLvl && [1, 2].includes(argLvl)) {
        await this.setShieldLevel(argLvl);
        const names = { 1: '【1. 标准模式】(Emoji 趣味算术)', 2: '【2. 终极模式】(Cloudflare 网页盾牌)' };
        await this.api('sendMessage', {
          chat_id: adminChatId,
          text: `🛡️ 防御等级已秒级切换为：<b>${names[argLvl]}</b>`,
          parse_mode: 'HTML'
        });
        return;
      }

      // 未带参数：弹出双模按键面板
      const currentLevel = await this.getShieldLevel();
      const names = { 1: '1. 标准模式 (Emoji 算术)', 2: '2. 终极模式 (网页盾牌)' };
      const panel = `🛡️ <b>防御等级控制中心</b>\n\n` +
        `• 当前生效等级：<b>${names[currentLevel]}</b>\n` +
        `• 也可直接输入 <code>/kqfy 1</code> 或 <code>/kqfy 2</code> 快速换挡。\n\n` +
        `👇 点击下方按钮即刻变脸：`;

      const keyboard = {
        inline_keyboard: [
          [{ text: `${currentLevel === 1 ? '✅ ' : ''}1. 标准模式 (Emoji 计数)`, callback_data: 'set_fy:1' }],
          [{ text: `${currentLevel === 2 ? '✅ ' : ''}2. 终极模式 (网页盾牌)`, callback_data: 'set_fy:2' }]
        ]
      };

      await this.api('sendMessage', {
        chat_id: adminChatId,
        text: panel,
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
      return;
    }

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
        `• <code>/kqfy</code> 或 <code>/kqfy 1|2</code>: 切换防御模式 (1标准Emoji/2终极网页盾)\n` +
        `• <code>/block [uid]</code>: 静默影子拉黑（不惊动对方）\n` +
        `• <code>/unblock [uid]</code>: 解除屏蔽并清空惩罚\n` +
        `• <code>/addkw &lt;词&gt;</code>: 添加广告敏感拦截词\n` +
        `• <code>/listkw</code>: 查看当前所有敏感词\n` +
        `• <code>/about</code>: 查看系统运行与防御状态指标`;
      await this.api('sendMessage', { chat_id: adminChatId, text: help, parse_mode: 'HTML' });
      return;
    }

    // 管理员回复访客
    if (msg.reply_to_message) {
      const targetUserId = await this.kv.get(`msg-map-${msg.reply_to_message.message_id}`);
      if (targetUserId) {
        const copyRes = await this.api('copyMessage', {
          chat_id: targetUserId,
          from_chat_id: adminChatId,
          message_id: msg.message_id
        });
        if (!copyRes.ok) {
          await this.api('sendMessage', {
            chat_id: adminChatId,
            text: `⚠️ 消息未能送达用户 \`${targetUserId}\`（对方可能已拉黑或销毁账号）。`,
            parse_mode: 'Markdown'
          });
        }
      } else {
        await this.api('sendMessage', { chat_id: adminChatId, text: '⚠️ 未找到该消息对应的访客账本，可能是远古历史消息。' });
      }
    } else {
      await this.api('sendMessage', { chat_id: adminChatId, text: t(lang, 'adminReplyPrompt') });
    }
  }

  // --- 访客发信处理 ---
  async handleGuestMessage(msg, lang, hostname = '') {
    const chatId = msg.chat.id;

    // 1. 静默黑名单检查
    const isBlocked = await this.kv.get(`block:${chatId}`);
    if (isBlocked) return;

    // 2. 会话无感初始化与自愈
    let sess = await this.kv.get(`session:${chatId}`, { type: 'json' }).catch(() => null);
    if (!sess) {
      const newSessionId = Math.random().toString(36).slice(2, 10);
      sess = { sid: newSessionId, at: Date.now() };
      await this.kv.put(`session:${chatId}`, JSON.stringify(sess), { expirationTtl: 30 * 86400 });
    }

    // 3. 熔断锁死与验证状态检查
    const vstate = await this.kv.get(`verify:${chatId}`, { type: 'json' }).catch(() => null);
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
        // 自动出题 (标准模式 Emoji 算术 / 终极模式网页盾牌)
        await this.issueQuestion(chatId, lang, sess.sid, vstate?.failCount || 0, hostname);
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

    // 6. 【访客引用回复 (Quote) 上下文置顶还原】
    if (msg.reply_to_message) {
      const quoteSnippet = extractQuoteSnippet(msg.reply_to_message);
      if (this.primaryAdminUid) {
        await this.api('sendMessage', {
          chat_id: this.primaryAdminUid,
          text: `💬 <b>[对方引用了上下文]</b>：<i>"${escapeHtml(quoteSnippet)}"</i>`,
          parse_mode: 'HTML'
        });
      }
    }

    // 7. 核心转发至管理员
    const fwdRes = await this.api('forwardMessage', {
      chat_id: this.primaryAdminUid,
      from_chat_id: chatId,
      message_id: msg.message_id
    });

    if (fwdRes.ok) {
      await this.kv.put(`msg-map-${fwdRes.result.message_id}`, String(chatId), { expirationTtl: 30 * 86400 });
      
      const notifKey = `notif:${chatId}`;
      const hasNotified = await this.kv.get(notifKey);
      if (!hasNotified) {
        await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'notifyWaiting') });
        await this.kv.put(notifKey, '1', { expirationTtl: 3600 });
      }
    } else {
      await this.api('sendMessage', { chat_id: chatId, text: t(lang, 'forwardFail') });
    }
  }

  // --- 回调查询处理 (Callback Query) ---
  async onCallbackQuery(cbq, hostname = '') {
    const data = cbq.data || '';
    const userId = cbq.from.id;
    const messageId = cbq.message?.message_id;
    let lang = await this.getUserLang(userId, cbq.from?.language_code);

    // 1. 防御模式切换按钮点击 (set_fy:1 | set_fy:2)
    if (data.startsWith('set_fy:') && this.isAdmin(userId)) {
      const level = parseInt(data.split(':')[1], 10);
      await this.setShieldLevel(level);
      const names = { 1: '1. 标准模式 (Emoji 算术)', 2: '2. 终极模式 (网页盾牌)' };
      await this.api('answerCallbackQuery', {
        callback_query_id: cbq.id,
        text: `✅ 防御等级已切换为：${names[level] || names[1]}`
      });
      const panel = `🛡️ <b>防御等级控制中心</b>\n\n• 当前生效等级：<b>${names[level]}</b>\n\n👇 点击下方按钮即刻变脸：`;
      const keyboard = {
        inline_keyboard: [
          [{ text: `${level === 1 ? '✅ ' : ''}1. 标准模式 (Emoji 计数)`, callback_data: 'set_fy:1' }],
          [{ text: `${level === 2 ? '✅ ' : ''}2. 终极模式 (网页盾牌)`, callback_data: 'set_fy:2' }]
        ]
      };
      await this.api('editMessageText', {
        chat_id: userId,
        message_id: messageId,
        text: panel,
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
      return;
    }

    // 2. 访客单键切换语言 (set_lang:zh | set_lang:en)
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

    // 未达上限：刷新全新题目
    const remaining = this.maxFailAttempts - currentFails;
    await this.api('answerCallbackQuery', {
      callback_query_id: cbq.id,
      text: t(lang, 'verifyWrongNotice', { rem: remaining }),
      show_alert: false
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
      { command: 'start', description: '启动会话 / 重新获取验证' },
      { command: 'about', description: '关于本机器人 (客服中继介绍)' }
    ];
    await this.api('setMyCommands', { commands: guestCommands, scope: { type: 'default' } });

    const adminCommands = [
      { command: 'kqfy', description: '🛡️ 切换防御模式 (1标准Emoji/2终极网页盾)' },
      { command: 'block', description: '🚫 静默拉黑 (回复某条消息或输入UID)' },
      { command: 'unblock', description: '⭕ 解除拉黑' },
      { command: 'addkw', description: '➕ 添加敏感拦截词' },
      { command: 'listkw', description: '📋 查看所有敏感拦截词' },
      { command: 'help', description: '📖 管理员指令完整手册' },
      { command: 'about', description: 'ℹ️ 机器人系统运行与防御状态' }
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

// ========================= 终极模式：网页人机验证盾牌页面 =========================

function renderVerificationHtml(chatId, exp, sig, siteKey, lang = 'zh') {
  const isZh = lang === 'zh';
  const title = isZh ? 'TG-Relay-Shield 安全验证' : 'TG-Relay-Shield Verification';
  const heading = isZh ? '🛡️ 安全真人验证' : '🛡️ Human Verification';
  const desc = isZh
    ? '系统检测到高防策略已开启，请点击下方进行验证以继续与主人私聊。'
    : 'High-security shield is active. Please complete verification below to continue chatting.';
  const btnText = isZh ? '点击完成验证' : 'Click to Verify';
  const successText = isZh ? '✅ 验证成功！您可以返回 Telegram 正常发信了。' : '✅ Verification Successful! You can return to Telegram now.';
  const failText = isZh ? '❌ 验证失败或已过期，请在 Telegram 中重新获取。' : '❌ Verification failed or expired. Please retry in Telegram.';

  return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(title)}</title>
  ${siteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f4f6f8;
      color: #333;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: #ffffff;
      border-radius: 16px;
      padding: 32px 24px;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 10px 30px rgba(0,0,0,0.08);
      text-align: center;
    }
    h1 { font-size: 22px; margin-bottom: 12px; color: #1a1a1a; }
    p { font-size: 14px; color: #666; line-height: 1.6; margin-bottom: 24px; }
    .btn {
      display: inline-block;
      width: 100%;
      background: #2481cc;
      color: #fff;
      border: none;
      padding: 14px 20px;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn:hover { background: #1b66a5; }
    .status { margin-top: 20px; font-size: 14px; font-weight: 500; display: none; }
    .success { color: #2e7d32; }
    .error { color: #d32f2f; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${heading}</h1>
    <p>${desc}</p>
    ${siteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-callback="onTurnstileDone" style="margin: 0 auto 20px;"></div>` : ''}
    <button id="verifyBtn" class="btn" onclick="submitVerify()">${btnText}</button>
    <div id="statusBox" class="status"></div>
  </div>

  <script>
    let cfToken = '';
    function onTurnstileDone(token) {
      cfToken = token;
      submitVerify();
    }
    async function submitVerify() {
      const btn = document.getElementById('verifyBtn');
      const box = document.getElementById('statusBox');
      btn.disabled = true;
      btn.innerText = 'Verifying...';
      try {
        const res = await fetch('/verify/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: '${chatId}', exp: ${exp}, sig: '${sig}', cf_token: cfToken })
        });
        const data = await res.json();
        box.style.display = 'block';
        if (data.ok) {
          box.className = 'status success';
          box.innerText = '${successText}';
          btn.style.display = 'none';
        } else {
          box.className = 'status error';
          box.innerText = data.error || '${failText}';
          btn.disabled = false;
          btn.innerText = '${btnText}';
        }
      } catch (err) {
        box.style.display = 'block';
        box.className = 'status error';
        box.innerText = '${failText}';
        btn.disabled = false;
        btn.innerText = '${btnText}';
      }
    }
  </script>
</body>
</html>`;
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
      return new Response('Ok');
    } catch (err) {
      return new Response('Bad Request', { status: 400 });
    }
  }

  // 终极模式：网页验证页面渲染
  if (path === '/verify') {
    const uid = url.searchParams.get('uid');
    const exp = parseInt(url.searchParams.get('exp') || '0', 10);
    const sig = url.searchParams.get('sig') || '';

    const valid = await verifyVerificationToken(uid, exp, sig, bot.secret);
    if (!valid) {
      return new Response('Invalid or Expired Verification Link.', { status: 400 });
    }

    const lang = await bot.getUserLang(uid, 'zh');
    const html = renderVerificationHtml(uid, exp, sig, bot.turnstileSiteKey, lang);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  // 终极模式：网页验证提交端点
  if (path === '/verify/submit' && request.method === 'POST') {
    try {
      const body = await request.json();
      const { uid, exp, sig, cf_token } = body;
      const valid = await verifyVerificationToken(uid, exp, sig, bot.secret);
      if (!valid) {
        return new Response(JSON.stringify({ ok: false, error: 'Signature verification failed or expired' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 如果配置了 Cloudflare Turnstile 密钥，则校验官方 token
      if (bot.turnstileSecretKey && cf_token) {
        const verifyResp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `secret=${encodeURIComponent(bot.turnstileSecretKey)}&response=${encodeURIComponent(cf_token)}`
        });
        const verifyData = await verifyResp.json();
        if (!verifyData.success) {
          return new Response(JSON.stringify({ ok: false, error: 'Turnstile verification failed' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // 验证通过：在 KV 中解锁该访客
      const state = {
        sessionId: Math.random().toString(36).slice(2, 10),
        questionId: 'web-verified',
        correctIndex: 0,
        exp: Date.now() + 10 * 60 * 1000,
        verified: true,
        verifiedAt: Date.now(),
        failCount: 0,
        lockedUntil: 0
      };
      await bot.kv.put(`verify:${uid}`, JSON.stringify(state), { expirationTtl: bot.verifiedTtlSeconds });

      // 在 Telegram 私聊中主动推送验证通过提醒
      const lang = await bot.getUserLang(uid, 'zh');
      await bot.api('sendMessage', {
        chat_id: uid,
        text: t(lang, 'verifySuccess')
      });

      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
    }
  }

  // 一键注册端点
  if (path === '/quick-setup') {
    const res = await bot.registerWebhook(url.hostname);
    return new Response(JSON.stringify(res, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  return new Response(`Telegram Relay Bot is Running! (${BOT_VERSION})`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

export default {
  async fetch(request, env, ctx) {
    return handleHttp(request, env, ctx);
  }
};

export { BotCore, generateDynamicQuestion, signVerificationToken, verifyVerificationToken };

if (typeof addEventListener === 'function') {
  addEventListener('fetch', event => {
    event.respondWith(handleHttp(event.request, globalThis, event));
  });
}
