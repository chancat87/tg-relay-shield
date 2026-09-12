<div align="center">

# 🛡️ TG-Relay-Shield

**Telegram 私聊中转与防骚扰机器人**

基于 Cloudflare Workers + KV 构建，轻量运行、完全免费。

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram-Bot%20API-2CA5E0?logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![Version](https://img.shields.io/badge/Version-v3.7.2--Shield-blue.svg)](https://github.com/chancat87/tg-relay-shield)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[English](./README_EN.md) · [功能](#-核心功能) · [技术与配额](#-技术架构与配额) · [部署](#-部署教程) · [指令与示例](#-指令与使用示例) · [FAQ](#-常见问题)

</div>

---

## 📌 核心功能

- **动态 Emoji 人机验证**：
  - 题目采用纯 Emoji 动态生成（如 `🍎🍎 + 🍎 = ?`），不含阿拉伯数字，防正则爬虫。
  - 原生 Telegram 键盘 4 选 1 点击作答，无需跳转外部网页。
  - 验证通过后 3 小时免测，期间消息静默转达，不重复刷屏。
- **双向原生引用回复 (Quote Reply)**：
  - 管理员与访客回复时，均在对方窗口生成真实的原生 Telegram 引用气泡。
  - 访客端开启“转发隐藏来源”也能正常双向回传，管理员大号完全隐身。
- **影子拉黑 (Shadowban)**：
  - 管理员使用 `/block` 后，系统只在管理端确认，不向访客发送任何拉黑提示。
  - 被拉黑访客后续发信直接静默丢弃。
- **零写 KV 防刷保护**：
  - 访客连续答错 3 次自动锁定 30 分钟。
  - 锁定期间、题目未答前、以及频控超限后，发信与按钮点击均严格 0 写 KV，防止恶意消耗 Cloudflare 免费配额。
- **中英双语自适应**：
  - 根据访客客户端语言自动选择中文或英文出题，键盘内嵌切换按钮，点选就地重绘。
- **单管理员专属架构**：
  - 仅服务绑定的唯一管理员，管理指令与普通访客菜单物理隔离。
- **敏感词动态拦截**：
  - 支持管理员通过指令动态添加/删除拦截词，命中消息静默拦截。

---

## 🛠️ 技术架构与配额

### 运行环境
- **Runtime**：Cloudflare Workers (V8 Serverless)
- **存储**：Cloudflare Workers KV (键值数据库)
- **通信**：Telegram Bot API (Webhook)

### 数据流向
```text
访客发信 ──► 检查黑名单 ──► 检查人机验证 (Emoji 题目) ──► 频控与敏感词过滤 ──► 转发至管理员
                                                                        │
访客接收 ◄────────────────────── 真实引用回传 ──────────────────────── 管理员 Reply 回复
```

### 免费配额与消耗
针对 Cloudflare 免费版（每天 1,000 次 KV 写入、100,000 次请求）优化：

| 交互类型 | KV 写入 | KV 读取 | 承载能力 |
| :--- | :--- | :--- | :--- |
| **访客发信** | 3 次（频控 1 次 + 消息映射 2 次） | 约 3~6 次 | — |
| **管理员回复** | 2 次（双向消息回查映射） | 约 2~3 次 | — |
| **锁定与违规拦截** | **0 次（零写保护）** | 1 次 | 不耗费写配额 |
| **综合估算** | — | — | **每天约 200 ~ 330 轮完整私聊往返** |

*注：Telegram 相册消息（Media Group）按单张图片逐条转发，确保高并发下不漏图且不产生额外的 KV 缓冲写入。*

---

## 🚀 部署教程

### 1. 准备配置参数
- **`BOT_TOKEN`**：在 Telegram 找 [@BotFather](https://t.me/BotFather) 创建机器人获取。
- **`ADMIN_UID`**：在 Telegram 找 [@userinfobot](https://t.me/userinfobot) 获取你的纯数字 ID（单管理员；若配置了逗号隔开的多 UID，系统自动截取首个）。
- **`BOT_SECRET`**：自定义一段随机密钥字符串（如 `my_secret_token_8899`，用于接口防伪鉴权）。

---

### 2. 方式 A：Web 网页部署（新手推荐）

1. **创建 KV 数据库**：
   - 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，点击 **存储和数据库** $\rightarrow$ **KV**。
   - 点击 **创建命名空间**，名称输入 `tg-relay-kv`。

2. **创建 Worker**：
   - 点击 **Workers 和 Pages** $\rightarrow$ **创建应用程序** $\rightarrow$ **创建 Worker**。
   - 命名为 `tg-relay-shield`，点击 **部署**。
   - 点击 **编辑代码**，清空原有代码，将本项目 [`worker.js`](./worker.js) 的全部内容粘贴进去，点击右上角 **Deploy（部署）**。

3. **绑定变量**：
   - 进入该 Worker 的 **设置 (Settings)** 页面：
   - **绑定 KV**：在 **绑定 (Bindings)** 中添加 KV 空间，**变量名必须填 `nfd`**，空间选择刚才创建的 `tg-relay-kv`。
   - **添加环境变量**：在 **变量和机密 (Variables and Secrets)** 中添加以下三个变量：
     - `BOT_TOKEN`：你的机器人 Token
     - `ADMIN_UID`：你的 Telegram 纯数字 ID
     - `BOT_SECRET`：自定义的密钥字符串
   - 点击 **保存并部署**。

4. **激活 Webhook 与指令菜单**：
   - 在浏览器访问：
     ```text
     https://<你的 Worker 域名>/quick-setup?secret=<你的 BOT_SECRET>
     ```
   - 看到返回 `{"ok": true, "result": true, "description": "Webhook was set"}` 即完成配置。

---

### 3. 方式 B：Wrangler CLI 部署（开发者推荐）

```bash
# 1. 克隆代码并安装依赖
git clone https://github.com/chancat87/tg-relay-shield.git
cd tg-relay-shield
npm install

# 2. 创建 KV 命名空间
npx wrangler kv:namespace create nfd
# 将终端返回的 kv 命名空间 id 写入 wrangler.toml

# 3. 设置机密变量
npx wrangler secret put BOT_TOKEN
npx wrangler secret put BOT_SECRET
npx wrangler secret put ADMIN_UID

# 4. 发布
npm run deploy

# 5. 激活（替换为你自己的域名和密钥）
curl "https://<你的 Worker 域名>/quick-setup?secret=<你的 BOT_SECRET>"
```

---

## 📋 指令与使用示例

所有管理指令直接在**管理员与机器人的私聊窗口**中使用：

| 操作 / 指令 | 使用示例 | 说明 |
| :--- | :--- | :--- |
| **回复访客** | 长按转发的消息选择 **Reply** 并打字 | 原样转发给访客，支持文本、表情、图片、语音、文档 |
| **`/block`** | 回复某条转发消息发送 `/block`<br>或直接发送 `/block 12345678` | 静默拉黑该访客，不向对方发送通知 |
| **`/unblock`** | 回复某条转发消息发送 `/unblock`<br>或直接发送 `/unblock 12345678` | 解除拉黑，并清空该用户的答错锁定计数 |
| **`/addkw <词>`** | `/addkw 兼职` | 添加本地敏感拦截词，访客消息命中即拦截 |
| **`/delkw <词>`** | `/delkw 兼职` | 删除已添加的敏感词 |
| **`/listkw`** | `/listkw` | 列出当前所有拦截词 |
| **`/help`** | `/help` | 查看管理员操作指南 |
| **`/about`** | `/about` | 查看系统运行版本与状态 |

---

## ❓ 常见问题

**Q: 为什么点击验证按钮转圈无反应？**  
A: Telegram Webhook 缺少 `callback_query` 权限。请访问 `https://<你的域名>/quick-setup?secret=<你的 BOT_SECRET>` 自动修复。

**Q: 访问 `/quick-setup` 返回 403？**  
A: 必须携带 URL 参数 `?secret=...`，且参数值必须与环境变量中配置的 `BOT_SECRET` 完全一致。

**Q: 需要自己买 VPS 或搭环境吗？**  
A: 不需要。100% 运行在 Cloudflare Workers 免费额度内，无需服务器。

---

## 📄 License

[MIT License](./LICENSE)
