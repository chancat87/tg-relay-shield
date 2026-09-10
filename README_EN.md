<div align="center">

# 🛡️ TG-Relay-Shield

**Telegram Two-Way Relay & Anti-Spam Bot**

A high-performance, zero-cost, anti-abuse contact relay bot built on Cloudflare Workers + KV.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram-Bot%20API-2CA5E0?logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[中文文档](./README.md) · [Features](#-key-features) · [Deployment](#-quick-deployment) · [Commands](#-admin-commands) · [FAQ](#-faq)

</div>

---

### 💡 Why TG-Relay-Shield?

Many people use Telegram bots as public contact points (a privacy relay between strangers and their personal accounts). Traditional tools like `nodeforwardbot` suffer from severe automated spam issues:
* ❌ **No Verification Gates**: Spam bots blast hundreds of ads right into your private chat.
* ❌ **Hardcoded & Predictable CAPTCHAs**: Bots easily brute-force static 10-question pools.
* ❌ **Free Quota Exhaustion (Denial-of-Wallet)**: Cloudflare Free Plan allows only 1,000 KV writes/day. Old scripts wrote to KV on every incorrect button click, easily exhausting free tier quotas.
* ❌ **Spammer Escalation**: Informing spammers that they have been blocked only encourages them to rotate sockpuppet accounts immediately.

**TG-Relay-Shield is engineered specifically to eliminate every single one of these problems.**

---

## ✨ Key Features

* 🚀 **100% Serverless & Free**: No VPS or Docker required. Runs seamlessly within Cloudflare Workers' generous free tier.
* 🍓 **Visual Emoji Arithmetic (Standard Mode)**:
  * Dynamic math problems using 16 clean, universal emojis (e.g. `🍎🍎 + 🍎🍎🍎 = ?`).
  * Text contains **zero digits**, completely breaking naive regex scrapers. Options are **clean Arabic numbers** (`[ 5 ]`), allowing humans to solve in 0.5s without squinting.
* 🛡️ **Instant Dual-Mode Defense (`/kqfy`)**:
  * **Mode 1 (Standard)**: Fun Emoji visual counting verification. **Zero false positives on normal article/blog link discussions**.
  * **Mode 2 (Ultimate)**: Official Cloudflare Turnstile Web Shield. Instantly block brute-force attacks via Cloudflare browser fingerprinting & TLS challenge.
  * Switch via `/kqfy 1`, `/kqfy 2` or interactive 2-button panel.
* 💬 **Visitor Quote & Reply Context Restoration**:
  * Fixes the lost context issue in Telegram forwarding. When a visitor replies to a previous message, photo, or media, a preview summary is automatically prepended for the admin.
* ⚡ **3-Strike Lockout (Anti-Spam DDoS)**:
  * 3 consecutive wrong answers triggers an instant 30-minute lockout.
  * **Zero KV Writes during lockout**, making it impossible for malicious scripts to deplete your Cloudflare KV write quotas.
* 🌐 **100% Pure Bilingual Isolation & 1-Tap Switcher**:
  * Clean language isolation for English and Chinese users without mixed bilingual text.
  * Auto-detects client language with a seamless `[ 🌐 Switch Language ]` button right inside the verification keypad.
* 🥷 **Silent Shadowbanning**:
  * Blocking someone via `/block` silences their messages without alerting them, removing the incentive to switch accounts.
* 🔒 **Complete Admin Anonymity**:
  * Supports replying even if the visitor has enabled "Hide Account on Forwarding". Your real Telegram identity remains 100% private.
* 🛠️ **Scope-Based Isolated Command Menus**:
  * Configures separate command menus for visitors (`/start`, `/about`) and admins (`/kqfy`, `/block`, `/unblock`, `/addkw`, `/listkw`, `/help`, `/about`).

---

## 🚀 Quick Deployment

### Prerequisites
1. Create a bot via [@BotFather](https://t.me/BotFather) and obtain your **`BOT_TOKEN`**.
2. Message [@userinfobot](https://t.me/userinfobot) to get your numeric Telegram user ID **`ADMIN_UID`**.
3. Create a secret token string for **`BOT_SECRET`** (e.g. `my_secret_token_8899`).

---

### Method A: No-Code Web Deployment (Recommended, 3 mins)

1. **Create KV Namespace**:
   * In [Cloudflare Dashboard](https://dash.cloudflare.com/), navigate to **Storage & Databases** $\rightarrow$ **KV**.
   * Click **Create a Namespace**, name it `tg-relay-kv`, and save.

2. **Create Cloudflare Worker**:
   * Go to **Workers & Pages** $\rightarrow$ **Create Application** $\rightarrow$ **Create Worker**.
   * Name it `tg-relay-shield`, click **Deploy**.
   * Click **Edit Code**, clear the default code, paste the contents of [`worker.js`](./worker.js), and click **Deploy**.

3. **Configure KV & Environment Variables**:
   * Under Worker **Settings** $\rightarrow$ **Bindings**:
     * Add KV Namespace binding: **Variable Name must be `nfd`**, Namespace: `tg-relay-kv`.
   * Under **Variables and Secrets**:
     * `BOT_TOKEN`: Your bot token.
     * `ADMIN_UID`: Your Telegram numeric ID.
     * `BOT_SECRET`: Your random secret token.
   * Click **Save and Deploy**.

4. **Activate Bot**:
   * Open in your browser:
     ```text
     https://<your-worker-subdomain>.workers.dev/quick-setup
     ```
     *(Or use your custom domain: `https://bot.yourdomain.com/quick-setup`)*
   * Seeing `{"ok": true, "result": true, "description": "Webhook was set"}` means you are good to go!

---

### Method B: Wrangler CLI (For Developers)

```bash
# Clone repository
git clone https://github.com/your-username/tg-relay-shield.git
cd tg-relay-shield

# Install dependencies
npm install

# Create KV namespace
npx wrangler kv:namespace create nfd
# Copy the returned id into wrangler.toml

# Set secrets
npx wrangler secret put BOT_TOKEN
npx wrangler secret put BOT_SECRET
npx wrangler secret put ADMIN_UID

# Deploy
npm run deploy
```

Then visit `https://<your-worker-domain>/quick-setup` in your browser to activate.

---

## 📋 Admin Commands

Execute these directly in your private chat with the bot:

| Command | Usage | Description |
| :--- | :--- | :--- |
| **Reply to message** | Tap **Reply** on a forwarded message | Sends your reply directly to the guest (text, media, files) |
| **`/kqfy`** | `/kqfy` or `/kqfy 1\|2` | **Dual-Mode Defense Hot-Switch**. Select Mode 1 (Standard Emoji) or Mode 2 (Ultimate Web Shield) |
| **`/block`** | Reply to message OR `/block <uid>` | **Silent Shadowban**. Silently drops all future messages from this user |
| **`/unblock`** | Reply to message OR `/unblock <uid>` | Unblocks the user and clears any lockout count |
| **`/addkw <word>`** | `/addkw crypto` | Adds a local keyword filter |
| **`/listkw`** | `/listkw` | Lists all active local keyword filters |
| **`/help`** | `/help` | Displays the admin help menu |
| **`/about`** | `/about` | Displays system status, version, and active defense level |

---

## 📄 License

This project is open-source software licensed under the [MIT License](./LICENSE).
