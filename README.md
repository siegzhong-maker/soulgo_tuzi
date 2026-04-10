# SoulGo（IP伴游电子宠物）

结合实体 IP 玩偶的旅行陪伴类 App MVP：手动输入地名打卡 → AI 生成旅行日记 → 上传当地纪念配件 → 橱柜展示。

## 本地运行

- 直接打开 `prototype.html` 即可浏览界面；打卡生成日记会请求本站 `/api/chat`，需本地或部署环境提供 API 代理（见下文）。
- 推荐使用 **Vercel 本地开发**，可同时跑静态页与 `/api/chat` 代理：
  1. 安装 [Vercel CLI](https://vercel.com/docs/cli)：`npm i -g vercel`
  2. 在项目根目录复制环境变量示例并填入你的 Key：
     ```bash
     cp .env.example .env.local
     # 编辑 .env.local，设置 OPENROUTER_API_KEY=你的key
     ```
  3. 运行：`vercel dev` 或 `npx vercel dev`
  4. 浏览器访问终端提示的本地地址（如 `http://localhost:3000`），打开 `prototype.html` 进行打卡，日记请求会走本地 `/api/chat`。

## 获取 OpenRouter API Key

1. 打开 [OpenRouter](https://openrouter.ai/) 并注册/登录。
2. 进入 [Keys](https://openrouter.ai/keys) 创建 API Key。
3. 本地：将 Key 填入 `.env.local` 的 `OPENROUTER_API_KEY`。  
4. 部署：在 Vercel 项目 **Settings → Environment Variables** 中添加 `OPENROUTER_API_KEY`，然后重新部署。

**请勿将真实 Key 提交到 Git。** 仓库中仅保留 `.env.example` 占位。

## 部署到 Vercel

1. 将本仓库推送到 GitHub，在 [Vercel](https://vercel.com) 中 **Import** 该仓库创建项目。
2. 在项目 **Settings → Environment Variables** 中添加：
   - 名称：`OPENROUTER_API_KEY`  
   - 值：你的 OpenRouter API Key  
   - 环境：Production / Preview 按需勾选
   - （可选）生图功能：`OPENROUTER_IMAGE_MODEL`，不填则默认使用 `google/gemini-2.5-flash-image`。
   - （可选）日记配图 Soul 点评（视觉）：`OPENROUTER_VISION_MODEL`，不填则与日记逻辑一致，默认 `google/gemini-2.0-flash-001`（见 `api/diary-image-comment.js`）。
   - **（生产强烈推荐）对象存储**：用于日记配图持久化、动态收集品抠图、家具生图。配置 `AWS_S3_*` 或 `R2_*`（见下方与 `.env.example`）。未配置时 serverless 环境无法写本地磁盘，图片会以很大的 `data:` URL 回传，易被浏览器 localStorage 配额策略裁掉，表现为配图或橱柜物品不显示。
3. 保存后重新部署（或触发一次新部署）。
4. 部署完成后访问 `https://你的项目.vercel.app`，打开 `prototype.html`（或配置为首页）即可使用；日记生成请求会由 Vercel Serverless 函数 `/api/chat` 代理并注入 Key，Key 不会暴露到前端。

## 对象存储（S3 / R2）

部署在 **Vercel 等 serverless** 时，仓库内 `assets/`、`场景/generated/` **不可写**。以下接口会把二进制上传到配置的桶并返回 **可匿名 GET 的 HTTPS URL**（需桶策略或 R2 公共访问允许读取）：

- 日记配图：`lib/diary-image-asset.js`（键前缀 `diary-images/`）
- 动态收集品：`api/generate-collectible.js`（`aigc-cutouts/...`，本地写盘成功时仍使用相对路径）
- 家具：`api/generate-furniture.js`（`furniture/...`）

共享上传逻辑：`lib/s3-public-object.js`。环境变量示例见 `.env.example`。

### 配图 / 物品异常时如何自查

1. 浏览器 **开发者工具 → Network**：点开失败的图片请求，查看完整 **Request URL**（不要只看列表里的短文件名）。若为 S3/R2 域名且 **403**，检查桶的公共读、`AWS_S3_PUBLIC_BASE_URL` / `R2_PUBLIC_BASE_URL` 是否与实际上可访问的域名一致。
2. 确认 **最新代码已部署**（含日记 serverless 与收集品 S3 回退逻辑）。
3. 若未配置对象存储：新生成的收集品仍可能以 `data:image/png` 形式下发，体积大时会被前端的 localStorage 瘦身逻辑丢弃场景图；配置桶后应显著改善。

## 项目结构

- `prototype.html` — 单页应用入口（打卡、日记、橱柜、宠物房间等）。
- `api/chat.js` — Vercel Serverless 代理：接收前端 POST，从环境变量读取 `OPENROUTER_API_KEY`，转发到 OpenRouter 并返回响应。
- `api/generate-image.js` — 生图接口：使用 `OPENROUTER_API_KEY` 与可选 `OPENROUTER_IMAGE_MODEL`，调用 OpenRouter 生成日记配图。
- `lib/s3-public-object.js` — S3/R2 公共上传（日记图、收集品、家具共用）。
- `api/generate-collectible.js` — 动态收集品生成；serverless 下优先上传至对象存储。
- `api/generate-furniture.js` — 家具生图；可选上传至对象存储。
- `api/diary-image-comment.js` — 日记上传图 / 配图的 Soul 风格多模态点评：可选 `OPENROUTER_VISION_MODEL`，否则使用 `OPENROUTER_DIARY_MODEL` / `OPENROUTER_MODEL_ID` / `google/gemini-2.0-flash-001`。
- `.env.example` — 环境变量示例（不含真实 Key）；复制为 `.env.local` 并填入 Key 后用于本地开发。
- `assets/`、`场景/` 等 — 静态资源。

## 安全说明

- API Key 仅存放在 **服务器环境变量**（Vercel 或本地 `.env.local`），不写入前端代码，不提交到 Git。
- 若曾将 Key 写进过代码或提交过仓库，请在 OpenRouter 后台撤销该 Key 并重新生成，新 Key 只配置在环境变量中。
