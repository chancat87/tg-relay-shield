<div align="center">

# 🛡️ TG-Relay-Shield

**Telegram Relay & Anti-Abuse Bot**

Serverless, lightweight, and zero-cost relay bot built on Cloudflare Workers + KV.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram-Bot%20API-2CA5E0?logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![Version](https://img.shields.io/badge/Version-v3.7.2--Shield-blue.svg)](https://github.com/chancat87/tg-relay-shield)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[中文文档](./README.md) · [Features](#-features) · [Tech & Quotas](#-tech-stack--quotas) · [Deployment](#-deployment) · [Commands](#-commands--usage-examples) · [FAQ](#-faq)

</div>

---

## 📌 Features

- **Dynamic Emoji Verification**:
  - Dynamically generated emoji math problems (e.g. `🍎🍎 + 🍎 = ?`) with zero digits in problem text.
  - Native 4-option inline keyboard in Telegram, zero external redirects.
  - 3-hour verification session with silent forwarding after passing.
- **Native Bidirectional Quote Reply**:
  - Renders true native Telegram reply bubbles in both directions via API 7.0 `reply_parameters`.
  - Full anonymity for admin even when guests hide account sources on forwarding.
- **Silent Shadowbanning**:
  - `/block` silences users without alerting them, dropping future messages silently.
- **Zero-Write Quota Defense**:
  - 3 consecutive failed answers triggers a 30-minute lockout.
  - During lockout, active CAPTCHA, or rate limit flooding, button clicks and text messages incur strictly 0 KV writes.
- **Bilingual Adaptive UI**:
  - Auto-selects English or Chinese based on client language with an in-place switch button.
- **Single-Admin Architecture**:
  - Dedicated to a single owner admin, strictly isolating admin commands from visitor menus.
- **Dynamic Keyword Filtering**:
  - Add/delete spam keywords via admin commands on the fly.

---

## 🛠️ Tech Stack & Quotas

### Architecture
- **Runtime**: Cloudflare Workers (V8 Serverless)
- **Storage**: Cloudflare Workers KV
- **Protocol**: Telegram Bot API (Webhook)

### Data Flow
```text
Guest Message ──► Blacklist Check ──► Emoji CAPTCHA ──► Rate Limit & Keywords ──► Forward to Admin
                                                                                          │
Guest Receives ◄───────────────────── Native Quote Reply ──────────────────────── Admin Reply
```

### Free Tier Cost & Capacity
Optimized for Cloudflare Workers Free Plan (1,000 writes/day, 100,000 reqs/day):

| Operation | KV Writes | KV Reads | Estimated Capacity |
| :--- | :--- | :--- | :--- |
| **Guest Message** | 3 writes (rate limit + 2 msg maps) | ~3–6 reads | — |
| **Admin Reply** | 2 writes (bidirectional maps) | ~2–3 reads | — |
| **Lockout / Blocked** | **0 writes (zero-write shield)** | 1 read | No quota consumed |
| **Overall** | — | — | **~200 – 330 full conversation rounds / day** |

*Note: Media groups (albums) are forwarded photo-by-photo to prevent parallel race conditions and eliminate wasteful KV buffering.*

---

## 🚀 Deployment

### 1. Prerequisites
- **`BOT_TOKEN`**: From [@BotFather](https://t.me/BotFather).
- **`ADMIN_UID`**: Your numeric Telegram user ID from [@userinfobot](https://t.me/userinfobot) (single admin; legacy comma-separated entries automatically fallback to the first ID).
- **`BOT_SECRET`**: A random secret token string (e.g. `my_secret_token_8899`) for webhook authentication.

---

### 2. Method A: Web Deployment (Recommended)

1. **Create KV Namespace**:
   - In Cloudflare Dashboard, go to **Storage & Databases** $\rightarrow$ **KV**.
   - Create a namespace named `tg-relay-kv`.

2. **Create Worker**:
   - Go to **Workers & Pages** $\rightarrow$ **Create Worker**, named `tg-relay-shield`.
   - Paste the contents of [`worker.js`](./worker.js) and click **Deploy**.

3. **Configure Settings**:
   - In Worker **Settings**:
     - **Bindings**: Add KV namespace binding, variable name **must be `nfd`**, select `tg-relay-kv`.
     - **Variables and Secrets**: Add `BOT_TOKEN`, `ADMIN_UID`, `BOT_SECRET`.
   - Save and deploy.

4. **Activate Webhook**:
   - Open in your browser:
     ```text
     https://<your-worker-domain>/quick-setup?secret=<YOUR_BOT_SECRET>
     ```
   - A JSON response with `{"ok": true, "result": true, ...}` indicates success.

---

### 3. Method B: Wrangler CLI (For Developers)

```bash
# 1. Clone & install
git clone https://github.com/chancat87/tg-relay-shield.git
cd tg-relay-shield
npm install

# 2. Create KV namespace
npx wrangler kv:namespace create nfd
# Copy the returned id into wrangler.toml

# 3. Set secrets
npx wrangler secret put BOT_TOKEN
npx wrangler secret put BOT_SECRET
npx wrangler secret put ADMIN_UID

# 4. Deploy
npm run deploy

# 5. Activate
curl "https://<your-worker-domain>/quick-setup?secret=<YOUR_BOT_SECRET>"
```

---

## 📋 Commands & Usage Examples

Execute these directly in your private chat with the bot:

| Command / Action | Example | Description |
| :--- | :--- | :--- |
| **Reply to Guest** | Tap **Reply** on a forwarded message and type | Relays directly to guest (supports text, photo, audio, file) |
| **`/block`** | Reply to message with `/block`<br>or `/block 12345678` | Silently shadowbans the guest |
| **`/unblock`** | Reply to message with `/unblock`<br>or `/unblock 12345678` | Unblocks the guest and clears lockout failure count |
| **`/addkw <word>`** | `/addkw crypto` | Adds a local keyword filter |
| **`/delkw <word>`** | `/delkw crypto` | Removes an existing keyword filter |
| **`/listkw`** | `/listkw` | Lists all active keyword filters |
| **`/help`** | `/help` | Displays admin instructions |
| **`/about`** | `/about` | Displays system status and version |

---

## ❓ FAQ

**Q: Why does the verification button spin endlessly?**  
A: The webhook is missing `callback_query` update permission. Visit `https://<your-domain>/quick-setup?secret=<YOUR_BOT_SECRET>` to fix it automatically.

**Q: Accessing `/quick-setup` returns 403?**  
A: You must append `?secret=...` matching your configured `BOT_SECRET`.

**Q: Do I need a VPS or Docker?**  
A: No. It runs 100% serverless within Cloudflare Workers free quotas.

---

## 📄 License

[MIT License](./LICENSE)
