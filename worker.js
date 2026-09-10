/**
 * Telegram 私聊中转与智能防骚扰机器人 (TG-Relay-Shield)
 * 
 * GitHub: https://github.com/your-username/tg-relay-shield
 * License: MIT
 * 
 * 核心特性：
 * 1. 动态万能算术题库（海量随机加减，带邻近干扰项，彻底防范枚举/脚本记录）
 * 2. 3 次答错熔断锁死（连错 3 次锁定 30 分钟，锁定期间“零写 KV”，防配额刷爆）
 * 3. 静默拉黑机制（影子屏蔽：拉黑不主动刺激对方，避免换小号二次轰炸）
 * 4. 优化 KV 写入节流（保护 Cloudflare 免费版每日 1000 次写配额）
 * 5. 原生兼容 ES Module 与 Service Worker 双架构，冷启动极速响应
 * 6. 内置 /quick-setup 自动注册端点，自动分配全量 update 权限（绝不漏掉 callback_query）
 */

// ========================= 配置与环境变量兼容 =========================

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

const BOT_VERSION = '2.3.0-Shield';

// ========================= 动态算术题生成器 =========================

function generateDynamicQuestion(lang) {
  const isZh = !lang || lang.startsWith('zh');
  const isAdd = Math.random() > 0.5;
  let a, b, answer, opStr;

  if (isAdd) {
    a = Math.floor(Math.random() * 20) + 1; // 1 ~ 20
    b = Math.floor(Math.random() * 20) + 1; // 1 ~ 20
    answer = a + b;
    opStr = '+';
  } else {
    a = Math.floor(Math.random() * 20) + 10; // 10 ~ 29
    b = Math.floor(Math.random() * 9) + 1;   // 1 ~ 9
    answer = a - b;
    opStr = '-';
  }

  const questionText = `${a} ${opStr} ${b} = ?`;

  // 生成 3 个互不相同且靠近正确答案的干扰项
  const wrongSet = new Set();
  let tries = 0;
  while (wrongSet.size < 3 && tries < 30) {
    tries++;
    const delta = (Math.floor(Math.random() * 5) + 1) * (Math.random() > 0.5 ? 1 : -1);
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

// ========================= 常量文案定义 =========================

const PROMPTS = {
  adminStart: {
    zh: '👋 您好，管理员！此机器人正在正常运行（TG-Relay-Shield 2.3.0）。',
    en: '👋 Hello Admin! The bot is running normally (TG-Relay-Shield v2.3.0).'
  },
  defaultStart: {
    zh: '👋 你好！我是私聊中转助手，会把你的消息转发给管理员，并把管理员的回复带回给你。\n\n请直接发送你的消息即可。',
    en: "👋 Hi! I'm a relay assistant. Send your message and I will forward it to the admin."
  },
  verifyRequired: {
    zh: '🛡 为了防止广告骚扰，请先点击下方选项完成验证：\n\n❓ ',
    en: '🛡 To prevent spam, please verify yourself below:\n\n❓ '
  },
  verifyPick: {
    zh: '\n\n👇 请点击下方正确答案：',
    en: '\n\n👇 Tap the correct answer below:'
  },
  verifySuccess: {
    zh: '✅ 验证通过！现在您可以正常发送消息了。',
    en: '✅ Verified! You can now send messages normally.'
  },
  verifyButtonsPrompt: {
    zh: '👆 请直接点击上方题目的按钮作答。',
    en: '👆 Please tap one of the option buttons above.'
  },
  verifyExpired: {
    zh: '⚠️ 题目已过期，请重新发送 /start 获取新题目',
    en: '⚠️ Expired. Please send /start again'
  },
  sessionExpired: {
    zh: '⚠️ 会话已过期，请先发送 /start 重新开始。',
    en: '⚠️ Session expired. Please send /start to begin.'
  },
  adminReplyHint: {
    zh: '🙅 请对【转发过来的用户消息】点击“Reply/回复”进行回复，否则我无法识别目标。',
    en: '🙅 Please reply directly to the forwarded message so I know the recipient.'
  },
  forwardFail: {
    zh: '抱歉，消息未能转发给管理员，请稍后重试。',
    en: 'Failed to forward message, please try again later.'
  },
  notifyWaiting: {
    zh: '🔔 您的消息已转发给管理员，请耐心等待回复。',
    en: '🔔 Your message has been forwarded, please wait for reply.'
  },
  keywordBlocked: {
    zh: '⚠️ 您的消息包含被拦截的敏感词，未转发给管理员。',
    en: '⚠️ Your message contains blocked keywords.'
  },
  rateLimited: {
    zh: '⏳ 发送频率过快，请稍后再试。',
    en: '⏳ You are sending too fast. Please wait.'
  }
};

function getPrompt(lang, item) {
  const isZh = !lang || lang.startsWith('zh');
  return isZh ? item.zh : item.en;
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
    this.verifiedTtlSeconds = getIntEnv(env, 'VERIFIED_TTL_SECONDS', 3 * 3600); // 默认验证保持 3 小时
    this.rateLimitCount = getIntEnv(env, 'RATE_LIMIT_MESSAGE', 45);
    this.rateLimitWindow = getIntEnv(env, 'RATE_LIMIT_WINDOW_SECONDS', 60);

    // 最大连续做错次数与锁定时间 (3次错误锁定 30 分钟)
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

    const keyboard = [];
    for (let i = 0; i < q.options.length; i += 2) {
      const row = [{ text: q.options[i], callback_data: `v:${q.id}:${i}` }];
      if (i + 1 < q.options.length) {
        row.push({ text: q.options[i + 1], callback_data: `v:${q.id}:${i + 1}` });
      }
      keyboard.push(row);
    }

    const text = `${getPrompt(lang, PROMPTS.verifyRequired)}${q.question}${getPrompt(lang, PROMPTS.verifyPick)}`;
    await this.api('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  async handleUpdate(update) {
    if (update.message) {
      await this.onMessage(update.message);
    } else if (update.callback_query) {
      await this.onCallbackQuery(update.callback_query);
    }
  }

  async onMessage(msg) {
    const chatId = msg.chat.id;
    const fromId = msg.from?.id;
    const lang = msg.from?.language_code || 'en';
    const text = (msg.text || '').trim();
    const isAdmin = this.isAdmin(fromId);

    if (text === '/start') {
      if (isAdmin) {
        await this.api('sendMessage', { chat_id: chatId, text: getPrompt(lang, PROMPTS.adminStart) });
      } else {
        const sess = await this.kv.get(`session:${chatId}`, { type: 'json' }).catch(() => null);
        const vstate = await this.kv.get(`verify:${chatId}`, { type: 'json' }).catch(() => null);

        // 检查是否处于熔断锁定期
        if (vstate && vstate.lockedUntil && Date.now() < vstate.lockedUntil) {
          const waitMin = Math.ceil((vstate.lockedUntil - Date.now()) / 60000);
          await this.api('sendMessage', {
            chat_id: chatId,
            text: `🚫 验证错误过多，已被系统锁定！请等待 ${waitMin} 分钟后再发送 /start。`
          });
          return;
        }

        if (sess && vstate && vstate.verified && (Date.now() - vstate.verifiedAt < this.verifiedTtlSeconds * 1000)) {
          await this.api('sendMessage', { chat_id: chatId, text: getPrompt(lang, PROMPTS.defaultStart) });
          return;
        }

        const newSessionId = Math.random().toString(36).slice(2, 10);
        await this.kv.put(`session:${chatId}`, JSON.stringify({ sid: newSessionId, at: Date.now() }), { expirationTtl: 30 * 86400 });
        await this.api('sendMessage', { chat_id: chatId, text: getPrompt(lang, PROMPTS.defaultStart) });
        await this.issueQuestion(chatId, lang, newSessionId, 0);
      }
      return;
    }

    if (isAdmin) {
      await this.handleAdminMessage(msg, lang);
      return;
    }

    await this.handleGuestMessage(msg, lang);
  }

  async handleAdminMessage(msg, lang) {
    const adminChatId = msg.chat.id;
    const text = (msg.text || '').trim();

    // /block (静默拉黑)
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
        text: `✅ 用户 \`${targetUid}\` 已被【静默拉黑】。\n对方发消息将被静默忽略，不会再提醒或转发给你，也不会惊动对方。`,
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
      await this.kv.delete(`verify:${targetUid}`); // 解封时顺便清空错误锁定
      await this.api('sendMessage', { chat_id: adminChatId, text: `✅ 用户 \`${targetUid}\` 已解除屏蔽。`, parse_mode: 'Markdown' });
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
      await this.api('sendMessage', { chat_id: adminChatId, text: `📃 *当前本地拦截关键词：*\n${body}`, parse_mode: 'Markdown' });
      return;
    }

    // /help
    if (/^\/help$/i.test(text)) {
      const help = `🛠 *TG-Relay-Shield 管理员指令*\n\n` +
        `• 对转发消息直接 *Reply/回复* 即可回复用户\n` +
        `• \`/block [uid]\`：静默拉黑（影子屏蔽，不惊动对方）\n` +
        `• \`/unblock [uid]\`：解除拉黑（并清除锁定状态）\n` +
        `• \`/addkw <词>\`：添加广告敏感词拦截\n` +
        `• \`/listkw\`：查看所有敏感词`;
      await this.api('sendMessage', { chat_id: adminChatId, text: help, parse_mode: 'Markdown' });
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
            text: `⚠️ 消息未能送达用户 \`${targetUserId}\`（对方可能已停用或拉黑机器人）。`,
            parse_mode: 'Markdown'
          });
        }
      } else {
        await this.api('sendMessage', { chat_id: adminChatId, text: '⚠️ 未找到该消息对应的访客，可能是较早的历史消息。' });
      }
    } else {
      await this.api('sendMessage', { chat_id: adminChatId, text: getPrompt(lang, PROMPTS.adminReplyHint) });
    }
  }

  async handleGuestMessage(msg, lang) {
    const chatId = msg.chat.id;

    // 1. 静默黑名单检查
    const isBlocked = await this.kv.get(`block:${chatId}`);
    if (isBlocked) return;

    // 2. 会话检查 (不存在则无感初始化)
    let sess = await this.kv.get(`session:${chatId}`, { type: 'json' }).catch(() => null);
    if (!sess) {
      const newSessionId = Math.random().toString(36).slice(2, 10);
      sess = { sid: newSessionId, at: Date.now() };
      await this.kv.put(`session:${chatId}`, JSON.stringify(sess), { expirationTtl: 30 * 86400 });
    }

    // 3. 熔断与验证检查
    const vstate = await this.kv.get(`verify:${chatId}`, { type: 'json' }).catch(() => null);
    if (vstate && vstate.lockedUntil && Date.now() < vstate.lockedUntil) {
      const waitMin = Math.ceil((vstate.lockedUntil - Date.now()) / 60000);
      await this.api('sendMessage', {
        chat_id: chatId,
        text: `🚫 验证失败次数过多，系统已将您锁定。请在 ${waitMin} 分钟后再试。`
      });
      return;
    }

    const isVerified = vstate && vstate.verified && (Date.now() - vstate.verifiedAt < this.verifiedTtlSeconds * 1000);
    if (!isVerified) {
      const hasActiveQuestion = vstate && !vstate.verified && vstate.exp && Date.now() < vstate.exp;
      if (hasActiveQuestion) {
        await this.api('sendMessage', { chat_id: chatId, text: getPrompt(lang, PROMPTS.verifyButtonsPrompt) });
      } else {
        // 验证过期或题目过期：自动重新生成并发送新的算术验证题及按钮
        await this.issueQuestion(chatId, lang, sess.sid, vstate?.failCount || 0);
      }
      return;
    }

    // 4. 频控检查
    const limited = await this.checkRateLimit(chatId);
    if (limited) {
      await this.api('sendMessage', { chat_id: chatId, text: getPrompt(lang, PROMPTS.rateLimited) });
      return;
    }

    // 5. 敏感词检查
    const searchable = (msg.text || '') + (msg.caption || '');
    const hitWord = await this.checkKeywordHit(searchable);
    if (hitWord) {
      await this.api('sendMessage', { chat_id: chatId, text: getPrompt(lang, PROMPTS.keywordBlocked) });
      if (this.primaryAdminUid) {
        await this.api('sendMessage', {
          chat_id: this.primaryAdminUid,
          text: `⚠️ 拦截来自 <code>${chatId}</code> 的消息，命中敏感词：<code>${escapeHtml(hitWord)}</code>`,
          parse_mode: 'HTML'
        });
      }
      return;
    }

    // 6. 消息转发
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
        await this.api('sendMessage', { chat_id: chatId, text: getPrompt(lang, PROMPTS.notifyWaiting) });
        await this.kv.put(notifKey, '1', { expirationTtl: 3600 });
      }
    } else {
      await this.api('sendMessage', { chat_id: chatId, text: getPrompt(lang, PROMPTS.forwardFail) });
    }
  }

  // --- 按钮点击处理 (含熔断防刷) ---
  async onCallbackQuery(cbq) {
    const data = cbq.data || '';
    const userId = cbq.from.id;
    const lang = cbq.from?.language_code || 'en';
    const messageId = cbq.message?.message_id;

    if (!data.startsWith('v:')) {
      await this.api('answerCallbackQuery', { callback_query_id: cbq.id });
      return;
    }

    const parts = data.split(':');
    const qid = parts[1];
    const choiceIdx = parseInt(parts[2], 10);

    const vstate = await this.kv.get(`verify:${userId}`, { type: 'json' }).catch(() => null);
    const sess = await this.kv.get(`session:${userId}`, { type: 'json' }).catch(() => null);

    // 处于锁定期间，直接秒弹窗驳回，绝不写 KV
    if (vstate && vstate.lockedUntil && Date.now() < vstate.lockedUntil) {
      const waitMin = Math.ceil((vstate.lockedUntil - Date.now()) / 60000);
      await this.api('answerCallbackQuery', {
        callback_query_id: cbq.id,
        text: `🚫 错误过多！已被系统锁定，请在 ${waitMin} 分钟后再试。`,
        show_alert: true
      });
      return;
    }

    if (!vstate || !sess || vstate.questionId !== qid || Date.now() > vstate.exp) {
      // 题目已过期或失效：自动生成新题目并就地刷新按钮，免去手动发送 /start 的繁琐操作
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
        text: '⚠️ 上道题目已过期，已为您生成新题目！'
      });

      const keyboard = [];
      for (let i = 0; i < newQ.options.length; i += 2) {
        const row = [{ text: newQ.options[i], callback_data: `v:${newQ.id}:${i}` }];
        if (i + 1 < newQ.options.length) {
          row.push({ text: newQ.options[i + 1], callback_data: `v:${newQ.id}:${i + 1}` });
        }
        keyboard.push(row);
      }

      if (messageId) {
        await this.api('editMessageText', {
          chat_id: userId,
          message_id: messageId,
          text: `⚠️ 题目已过期，已为您重新出题：\n\n${getPrompt(lang, PROMPTS.verifyRequired)}${newQ.question}${getPrompt(lang, PROMPTS.verifyPick)}`,
          reply_markup: { inline_keyboard: keyboard }
        });
      } else {
        await this.api('sendMessage', {
          chat_id: userId,
          text: `${getPrompt(lang, PROMPTS.verifyRequired)}${newQ.question}${getPrompt(lang, PROMPTS.verifyPick)}`,
          reply_markup: { inline_keyboard: keyboard }
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
      
      await this.api('answerCallbackQuery', { callback_query_id: cbq.id, text: '✅ 验证通过' });
      await this.api('editMessageText', {
        chat_id: userId,
        message_id: messageId,
        text: getPrompt(lang, PROMPTS.verifySuccess)
      });
      return;
    }

    // 答错处理
    const currentFails = (vstate.failCount || 0) + 1;
    vstate.failCount = currentFails;

    // 达到最大尝试次数（3次），触发熔断锁定
    if (currentFails >= this.maxFailAttempts) {
      vstate.lockedUntil = Date.now() + this.lockoutDurationMs;
      await this.kv.put(`verify:${userId}`, JSON.stringify(vstate), { expirationTtl: Math.ceil(this.lockoutDurationMs / 1000) });

      await this.api('answerCallbackQuery', {
        callback_query_id: cbq.id,
        text: `❌ 连续错误 ${currentFails} 次！已被系统锁定 30 分钟。`,
        show_alert: true
      });

      await this.api('editMessageText', {
        chat_id: userId,
        message_id: messageId,
        text: `🚫 验证失败次数达到上限（${currentFails}/${this.maxFailAttempts}）。\n系统已暂停您的验证操作，请在 30 分钟后再试。`
      });
      return;
    }

    // 未达上限：扣减机会并刷新新题
    const remaining = this.maxFailAttempts - currentFails;
    await this.api('answerCallbackQuery', {
      callback_query_id: cbq.id,
      text: `❌ 答案错误！还剩 ${remaining} 次机会`,
      show_alert: false
    });

    const newQ = generateDynamicQuestion(lang);
    vstate.questionId = newQ.id;
    vstate.correctIndex = newQ.correctIndex;
    vstate.exp = Date.now() + 10 * 60 * 1000;
    await this.kv.put(`verify:${userId}`, JSON.stringify(vstate), { expirationTtl: this.verifiedTtlSeconds });

    const keyboard = [];
    for (let i = 0; i < newQ.options.length; i += 2) {
      const row = [{ text: newQ.options[i], callback_data: `v:${newQ.id}:${i}` }];
      if (i + 1 < newQ.options.length) {
        row.push({ text: newQ.options[i + 1], callback_data: `v:${newQ.id}:${i + 1}` });
      }
      keyboard.push(row);
    }

    await this.api('editMessageText', {
      chat_id: userId,
      message_id: messageId,
      text: `❌ 上一题回答错误（剩余机会：${remaining} 次）。\n\n${getPrompt(lang, PROMPTS.verifyRequired)}${newQ.question}${getPrompt(lang, PROMPTS.verifyPick)}`,
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  async registerWebhook(hostname) {
    const webhookUrl = `https://${hostname}${this.webhookPath}`;
    return await this.api('setWebhook', {
      url: webhookUrl,
      secret_token: this.secret,
      allowed_updates: ['message', 'edited_message', 'callback_query', 'chat_member'],
      drop_pending_updates: false
    });
  }
}

// ========================= 路由与导出 =========================

async function handleHttp(request, env, ctx) {
  const bot = new BotCore(env);
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === bot.webhookPath) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const secretHdr = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (!timingSafeEqual(secretHdr, bot.secret)) {
      return new Response('Unauthorized', { status: 403 });
    }
    try {
      const update = await request.json();
      if (ctx && ctx.waitUntil) {
        ctx.waitUntil(bot.handleUpdate(update));
      } else {
        await bot.handleUpdate(update);
      }
      return new Response('Ok');
    } catch (err) {
      return new Response('Bad Request', { status: 400 });
    }
  }

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

export { BotCore };

if (typeof addEventListener === 'function') {
  addEventListener('fetch', event => {
    event.respondWith(handleHttp(event.request, globalThis, event));
  });
}
