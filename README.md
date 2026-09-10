<div align="center">

# 🛡️ TG-Relay-Shield

**Telegram 双向私聊中转与智能防骚扰机器人**

基于 Cloudflare Workers + KV 构建的高性能、零成本、原生防骚扰的双向客服中继机器人。

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram-Bot%20API-2CA5E0?logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/)

[English Documentation](./README_EN.md) · [功能特性](#-核心特性) · [部署教程](#-快速部署) · [管理员指令](#-管理员指令) · [常见问题](#-常见问题-faq)

</div>

---

### 💡 为什么诞生本项目？

在 Telegram 上，许多人需要一个公开机器人作为与外界陌生人沟通的窗口（类似于客服或私聊替身）。以往大家常使用 `nodeforwardbot` 等传统项目，但近期遭遇了严重的**自动化广告脚本轰炸**：
* ❌ **无验证门槛**：任何广告群发脚本都可以直接向你的 Telegram 轰炸几百条垃圾信息。
* ❌ **题目写死易破解**：部分防骚扰项目只有 10 道写死问答，脚本直接暴力枚举盲猜，几秒即可破门。
* ❌ **配额耗尽攻击**：Cloudflare 免费版每天只有 1000 次 KV 写入配额。旧版脚本连点答错会无限写 KV，容易被恶意脚本刷爆免费额度。
* ❌ **明文通知激化矛盾**：拉黑时主动通知对方“你已被拉黑”，直接导致黑产团伙换小号二次轰炸。

**TG-Relay-Shield 正是为彻底解决上述所有痛点而生的现代化解决方案！**

---

## ✨ 核心特性

* 🚀 **100% 纯 Serverless 免费运行**：无需购买 VPS，无需维护 Docker，基于 Cloudflare Workers 全免费额度即可平稳支撑。
* 🧠 **动态万能防刷题库**：
  * 拒绝死板的固定题库！采用随机加减法动态生成，选项自动匹配邻近数值干扰项。
  * 答错即刻重新洗牌并生成全新题目，彻底粉碎脚本枚举与字典破解。
* ⚡ **3 次答错熔断锁死 (Anti-DDoS)**：
  * 连续答错 3 次自动熔断锁定 30 分钟。
  * **锁定期间零写 KV**，任凭脚本挂机疯狂连点，也无法消耗你的 Cloudflare 每日配额。
* 💬 **访客引用回复 (Quote) 上下文还原**：
  * 完美解决 Telegram 转发机制丢失引用气泡的痛点。访客指着历史消息、照片或文件提问时，管理员私聊会自动置顶展示引用的内容摘要。
* 🛡️ **防御模式极简热切换 (`/kqfy`)**：
  * **模式 1 (标准)**：默认随机阿拉伯数字加减法。
  * **模式 2 (严格)**：大写汉字题目 + 刚通过验证的首条消息严禁带任何外链或群号，秒级扼杀广告。
  * **模式 3 (终极)**：高敏防御拦截。支持带参数 `/kqfy 1|2|3` 直切，或输入 `/kqfy` 弹出可视化点选按键面板。
* 🌐 **纯正双语隔离与自适应一键切换**：
  * 访客端与管理端 100% 语言纯净隔离，杜绝中英乱串。
  * 自动识别访客 Telegram 客户端语言，答题键盘底端附带 `[ 🌐 Switch to English ]`，点选即刻在当前气泡就地重绘。
* 🥷 **静默拉黑（影子屏蔽 / Shadowban）**：
  * 管理员执行 `/block` 后，系统只在管理端确认，**绝不通知被拉黑者**。对方发信看似正常，机器人后台静默忽略，彻底切断换号轰炸动机。
* 🚫 **双层敏感词过滤**：
  * 支持本地与远程广告词汇过滤（英文单词边界匹配，中文子串匹配），命中词汇直接拦截并告警。
* 🔒 **隐私保护与匿名回复**：
  * 即使对方开启了 Telegram 的“转发时隐藏账号来源”，底层基于消息映射依然能精准双向回传，你的本体大号对外界 100% 隐身。
* 🛠️ **一键初始化与身份隔离菜单 (Scope-based)**：
  * 内置 `/quick-setup` 接口，自动注入全量 Webhook 权限并为访客（只显示 `/start`、`/about`）和管理员自动配置两套隔离的专属操作菜单。

---

## 🏗️ 数据流向图

```text
[陌生访客私聊发信]
       │
       ├─► 1. 检查静默黑名单 (block:<uid>) ──(命中)──► [静默忽略，不响应，不转发]
       │
       ├─► 2. 检查会话与人机验证
       │        ├─► [未验证] ──► 动态出题 (A+B / A-B 随机邻近干扰项，4选1按钮)
       │        │                   ├─ 连续错 3 次 ──► [触发熔断锁定 30 分钟，冻结写入]
       │        │                   └─ 答对 ───────► [放行，3 小时内免试]
       │        └─► [已通过] ──► 放行
       │
       ├─► 3. 内存频控 + 敏感词过滤
       │
       └─► 4. 消息安全转发至管理员私聊
                     │
              [管理员 Reply 回复] ──► 原样转回给访客 (本体大号完全隐身)
```

---

## 🚀 快速部署

### 准备工作（1 分钟）
1. 在 Telegram 找 [@BotFather](https://t.me/BotFather) 发送 `/newbot` 创建机器人，获取 **`BOT_TOKEN`**。
2. 在 Telegram 找 [@userinfobot](https://t.me/userinfobot) 发送任意消息，获取你的纯数字用户 ID **`ADMIN_UID`**。
3. 自定义一个随机密钥字符串 **`BOT_SECRET`**（如 `my_secret_key_8899`）。

---

### 方式 A：Web 网页零代码部署（新手推荐，3 分钟）

1. **创建 KV 数据库**：
   * 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，在左侧点击 **存储和数据库** $\rightarrow$ **KV**。
   * 点击 **创建命名空间**，命名为 `tg-relay-kv`，点击添加。

2. **创建 Worker**：
   * 点击 **Workers 和 Pages** $\rightarrow$ **创建应用程序** $\rightarrow$ **创建 Worker**。
   * 命名为 `tg-relay-shield`，点击 **部署**。
   * 点击 **编辑代码**，清空默认内容，将本项目中的 [`worker.js`](./worker.js) **全选复制粘贴进去**，点击右上角 **Deploy（部署）**。

3. **绑定 KV 与环境变量**：
   * 回到该 Worker 的 **设置 (Settings)** 页面：
   * **绑定 KV**：在 **绑定 (Bindings)** 中添加 KV 命名空间，**变量名称必须严格填写为 `nfd`**，空间选择刚才创建的 `tg-relay-kv`。
   * **添加环境变量**：在 **变量和机密 (Variables and Secrets)** 中添加以下 3 个变量：
     * `BOT_TOKEN`: 你的机器人 Token
     * `ADMIN_UID`: 你的 Telegram 纯数字 ID
     * `BOT_SECRET`: 你设定的密钥字符串
   * 点击 **保存并部署**。

4. **一键激活（自动配置全量权限）**：
   * （推荐绑定自定义域名，例如 `bot.yourdomain.com`，在 Worker 设置中绑定即可）。
   * 直接在浏览器访问：
     ```text
     https://你的域名/quick-setup
     ```
   * 看到返回 `{"ok": true, "result": true, "description": "Webhook was set"}` 即大功告成！

---

### 方式 B：Wrangler CLI 命令行部署（开发者推荐）

```bash
# 1. 克隆本项目
git clone https://github.com/your-username/tg-relay-shield.git
cd tg-relay-shield

# 2. 安装依赖
npm install

# 3. 创建远程 KV 命名空间
npx wrangler kv:namespace create nfd
# 将终端返回的 kv_namespaces id 填入 wrangler.toml

# 4. 配置机密环境变量
npx wrangler secret put BOT_TOKEN
npx wrangler secret put BOT_SECRET
npx wrangler secret put ADMIN_UID

# 5. 一键发布
npm run deploy
```

发布后，在浏览器访问 `https://<你的 Worker 地址>/quick-setup` 即可完成初始化。

---

## 📋 管理员指令

所有指令直接在**你本人与机器人的私聊窗口**中使用：

| 指令 | 触发方式 | 功能说明 |
| :--- | :--- | :--- |
| **直接回复消息** | 长按转发消息点 **Reply** | 将打字内容无感回复给对应访客（支持图片/文件/文本） |
| **`/kqfy`** | `/kqfy` 或 `/kqfy 1\|2\|3` | **【防御模式热切换】**<br>直接输入级别直切，或发送 `/kqfy` 弹出交互式按钮面板 |
| **`/block`** | 回复某条转发消息 **或** 追加 UID | **【静默拉黑（影子屏蔽）】**<br>拉黑该账号，对方发信被静默丢弃，绝不发通知刺激对方 |
| **`/unblock`** | 回复某条转发消息 **或** 追加 UID | **解除屏蔽**，并自动重置该用户的错误锁定计数 |
| **`/addkw <词>`** | `/addkw 兼职` | **添加敏感词**，命中该词的消息直接拦截不推送 |
| **`/listkw`** | 直接发送 `/listkw` | 查看当前所有本地拦截词 |
| **`/help`** | 直接发送 `/help` | 查看管理员帮助手册 |
| **`/about`** | 直接发送 `/about` | 查看系统运行版本、当前防御等级与状态指标 |

---

## ❓ 常见问题 (FAQ)

#### Q1: 为什么点击验证按钮转圈卡住没反应？
**A**: 这是因为 Telegram Webhook 缺少了 `callback_query` 权限。请直接在浏览器中打开你的 Worker 地址：`https://你的域名/quick-setup`，接口会自动注入完整的 `allowed_updates` 权限并修复。

#### Q2: 我需要自建 VPS 服务器或者搞 Docker 吗？
**A**: **完全不需要！** 本项目 100% 运行在 Cloudflare Workers 上，Cloudflare 每天提供 10 万次免费请求，对于个人私聊客服用途完全免费且永不断线。

#### Q3: 为什么拉黑用户后，对方发消息没有收到“您已被拉黑”？
**A**: 这是专门设计的**影子屏蔽（Shadowban）机制**。直接提示拉黑会激化矛盾，促使广告号立即换小号继续轰炸；静默拦截让对方以为消息发出了但无人理会，防御效果最佳。

---

## 📄 开源许可证

本项目基于 [MIT License](./LICENSE) 协议开源。欢迎 Star ⭐️ 与 Fork，提出 PR 共同改进！
