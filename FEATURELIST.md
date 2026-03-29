# SoulGo `index.html` Feature List（现有能力梳理）

> 范围：以当前 `index.html` 为主（单页前端），补充其直接依赖的后端接口 `api/*.js`，以及 **Web Bluetooth 硬件脚本** [`bleConfig.js`](bleConfig.js)、[`esp32BleClient.js`](esp32BleClient.js)（与固件 GATT 对齐）。  
> 重点：**RAG + 记忆** 的“写入→检索→注入生成→可视化解释”闭环；**可选实体硬件**在打卡成功时的震动反馈。

## 产品概览（MVP 当前形态）

- **核心体验**：地图打卡一个地点 → 生成一篇旅行日记 → 掉落/制作纪念品（橱柜收藏 + 房间摆放）→ 宠物在房间里基于“记忆/计划”行动与对话。
- **可选硬件伴游**：浏览器通过 **Web Bluetooth** 连接 **ESP32-C3**（广播名与 [`bleConfig.js`](bleConfig.js) 中 `DEVICE_NAME` 一致，默认 `ESP32-C3-Tracker`）。打卡流程在 **掉落场景与 tier 已确定后** 立即向设备发送 `VIB:<mode>`（普通款 **C** 短震，其余 **B/A/S** 长震），不等待思考步骤动画播完。
- **数据形态**：
  - **前端状态（持久化）**：`localStorage` 保存 `appState`（打卡、日记、橱柜、记忆等）。
  - **RAG 向量记忆池（服务端内存）**：一次打卡写入一条向量记忆，供后续生成日记时检索使用（注意：当前实现是**进程内存**，实例重启会清空）。
  - **BLE 连接状态**：仅存于当前页面内存（刷新需重连）；无服务端参与。

## Feature 表格（按入口/能力/接口对齐）

> 说明：表格以“用户可见入口”为主；RAG/记忆相关行用 **加粗** 标出，并在“RAG/记忆关联”列说明闭环位置。

| 模块 | 用户入口/触发 | Feature | 产出/状态变化（前端） | 相关接口（后端） | RAG/记忆关联 |
|---|---|---|---|---|---|
| 地图 | 地点输入 + 打卡 | 打卡联动总流程（生成日记/掉落/写入记忆/更新 UI） | `locations` 增加；`mapPins` 增加；日记/橱柜/记忆可能更新 | `POST /api/diary`、`POST /api/memory-summary`、`POST /api/embed-and-store` | **记忆写入起点**：打卡→抽取摘要→写向量池 |
| 地图 | 自动 | 地图图钉（随机位置） | `mapPins: {location,xRatio,yRatio}` | - | - |
| 地图 | 自动 | 已打卡城市列表聚合 | 从 `memories.episodic` 聚合渲染（城市/日期/摘要） | - | 与 episodic 结构绑定（不是单纯 `locations`） |
| 宠物小屋 | 顶部按钮「宠物记忆」 | 记忆总览/编辑（旅行/性格/习惯） | 读写 `memories.episodic / semanticProfile / habit` | `GET /api/debug-memories`（调试页内） | **记忆可视化入口**（含 RAG 调试） |
| 宠物小屋 | 思考区 | 展示思考步骤 +（第1步）展示“本次翻到的记忆” | 展示 `thinkingSteps`；可展示 `memorySources` | 来自 `POST /api/diary` 的 `thinkingSteps`/`memoryCount` | **可解释链路**：让用户看到“回忆在工作” |
| 宠物小屋 | 热点「日记」 | 打开旅行日记弹窗 | 读取 `diary-list` 渲染 | - | 日记卡片可展示“翻到 X 条记忆” |
| 日记 | 打卡后自动 | **生成日记（统一 JSON）** | 新增日记卡片；可能标记未读 badge | **`POST /api/diary`** | **RAG 注入生成**（retrieve→episodicMemories→prompt） |
| 日记 | 打卡后自动 | 日记卡片“本次翻到 X 条旅行记忆”提示 + 展开来源 | 依赖 `memoryCount`/`memorySources`（前端启发式） | `POST /api/diary`（count） | **可解释链路**（count + sources） |
| 日记 | 点击「插入图片」 | 本地插图上传（文件） | `diaryImages[diaryId]` 写入；`localStorage` 持久化 | - | - |
| 日记 | 生成后异步 | AIGC 日记配图 + 导出图片 | `diaryImages[diaryId]` 写入；UI 同步更新 | `POST /api/generate-image` | - |
| 记忆 | 打卡后自动 | **从日记抽取结构化记忆（summary/emotion/key_facts）** | 用于写入 `memories.episodic` 字段 | **`POST /api/memory-summary`** | **记忆结构化/可检索摘要**（为向量写入准备） |
| 记忆 | 打卡后自动 | **写入情景记忆（episodic.travel）** | `memories.episodic.unshift(record)`；持久化 | - | **前端记忆池**（非向量）用于气泡/聚合/解释 |
| 记忆 | 打卡后异步 | **向量化写入（RAG store）** | `appState.debug.ragLastError` 可能更新 | **`POST /api/embed-and-store`** | **RAG 写入**（embedding→内存向量库） |
| RAG | 生成日记时自动 | **向量检索召回 topK** | 不直接落前端状态（仅影响生成结果） | **`POST /api/retrieve`** | **RAG 召回**（embedding query → cosine topK） |
| RAG | 记忆面板（调试） | 查看向量记忆池总数/最近 N 条/地点分布 | 仅展示，不持久化 | **`GET /api/debug-memories`** | **RAG 可观测性**（验证写入是否成功） |
| 橱柜 | 热点「橱柜」 | 打开橱柜弹窗（12 格） | `cabinetItems` 渲染；打开后清未读 | - | - |
| 橱柜 | 打卡掉落 | 纪念品掉落 → Reward Modal | `cabinetItems` 增加；`cabinetHasNewUnseen=true` | - | 掉落可能绑定 `memoryTag`/`ragUnlockSource` |
| 橱柜 | 打卡时解析 | cabinetPlan 解锁物品/家具主题建议 | `lastFurnitureSuggestion` 写入；用于解释来源 | `POST /api/diary`（返回 `cabinetPlan`） | **RAG 参与“收藏/主题建议”**（生成侧输出） |
| 家具 | 制作流程 | 制作纪念品遮罩（进度/提示） | 仅 UI 过渡；之后可能可摆放 | `POST /api/generate-furniture` | - |
| 房间 | Reward Modal 选择 | 立即摆放/放入橱柜 | `placedFurniture` / `cabinetItems` 更新 | - | - |
| 房间 | 音乐盒 | BGM 选择/音量偏好 | `localStorage` 保存 | - | - |
| 硬件 | 地图页 BLE 工具条 | 「连接设备」→ SoulGo 说明弹窗 →「搜索并连接」→ **系统蓝牙选择器**（必选） | GATT 连接 [`esp32BleClient.js`](esp32BleClient.js)；状态「已连接 · 设备名 / 未连接」 | - | - |
| 硬件 | 地图页（已连接） | 「断开设备」直接断开 | `gatt.disconnect`；状态复位 | - | - |
| 硬件 | 打卡成功且已连接 | 按掉落 **tier** 映射发送 `VIB:1`（短）或 `VIB:2`（长） | 在 `thinkingSteps` 计算完成后 **立即** 发送，不等待思考动画 | - | 配置见 [`bleConfig.js`](bleConfig.js) `TIER_TO_VIB` |
| 硬件 | 宠物小屋顶部 | 硬件状态文案 +「去地图连接设备」 | 跳转地图并滚动到 BLE 工具条、聚焦连接按钮 | - | - |
| 全局 | 横竖屏切换按钮 | 布局切换与自适应 | `soulgo_layout_mode` 保存；触发 resize | - | - |

## 主要页面 / 入口（用户可见）

### 地图页（打卡入口）

- **BLE 工具条（可选实体硬件）**
  - **连接设备**：打开 SoulGo 统一弹窗（`openBleConnectModal`），说明需选择广播名与 [`bleConfig.js`](bleConfig.js) 中 `DEVICE_NAME` 一致的设备；点击「搜索并连接」后浏览器会弹出 **系统蓝牙设备列表**（Web Bluetooth 规范要求，无法用纯网页 UI 替代）。
  - **断开设备**：不经过说明弹窗，直接断开 GATT。
  - **状态文案**：未连接 / 已连接 · 设备名；不支持时提示使用 Chrome/Edge（桌面或安卓）等。
- **地点输入 + 打卡按钮**
  - 输入城市/地点后触发“打卡联动”：生成日记、写入记忆、掉落收集物、更新地图图钉与列表。
- **地图图钉（打卡可视化）**
  - 每次打卡会在地图上随机位置生成图钉（坐标以归一化比例存储，适配横竖屏）。
- **已打卡城市列表**
  - 列表不是简单用 `locations` 渲染，而是从 **情景记忆 `episodic.travel` 聚合**得到（城市、最近打卡日期、摘要）。
- **返回宠物小屋**

### 宠物小屋（核心互动场景）

- **顶部状态区**
  - 状态文案（宠物正在做什么）
  - 心情/健康展示（数值映射标签）
  - “人格/称呼你”摘要 + “带我去打卡”快捷入口
  - **硬件状态**（`#ble-status-petroom`）：同步地图页 BLE 连接说明；**「去地图连接设备」** 跳转地图并滚动到 BLE 工具条，便于在地图页完成配对
- **房间热点（可点击交互入口）**
  - **地图**：回到地图页继续打卡
  - **日记**：打开旅行日记（弹窗）
  - **橱柜**：打开旅行见闻柜（弹窗，含“新物品红点”）
  - **床**：休息相关行为（状态切换）
  - **触碰**：让宠物靠近/触碰触发互动
  - **小锅**：吃东西相关行为
  - **音乐盒**：选择 BGM（本地保存偏好）
  - **回到初始位置**：回归发呆点
- **思考区（解释型 UI）**
  - 在播放思考步骤时显示
  - 第 1 步可额外展示“本次翻到的旅行记忆”（让用户理解 RAG/回忆来源）
- **照片墙**
  - 从橱柜中取最近若干物品，以“拍立得”形式贴在墙上做环境叙事

### 通用弹窗（Modal）

- **旅行日记弹窗**
  - 日记列表卡片（包含：日期、地点、正文、宠物头像/场景缩略）
  - “本次翻到 X 条旅行记忆”提示，可展开查看来源
  - 支持插入本地图片（`<input type="file">`，图片存前端）
  - 支持 AIGC 生图展示与“导出图片”
- **旅行见闻柜（橱柜）弹窗**
  - 12 格橱柜（空位提示“去旅行解锁”）
  - 新物品提示（获得后标记未读，用户打开橱柜后清除）
  - 橱柜记忆弹窗布局支持“分区 + 横向滑动卡片”（用于分层展示）
- **获得新物品弹窗（Reward Modal）**
  - 掉落或解锁后即时弹出：展示物品图、名称、徽章
  - 两个操作：**放入橱柜** / **立即摆放**
- **制作纪念品遮罩（Crafting Overlay）**
  - 展示“制作中”的过渡与进度条（用于家具制作流程）
- **连接设备（Web Bluetooth）**
  - 标题「连接设备」；不支持浏览器时仅提示说明 +「知道了」
  - 支持时：步骤说明 +「搜索并连接」（内部调用 `esp32Ble.connect()` → `navigator.bluetooth.requestDevice`）+「取消」；连接失败时在弹窗内显示错误文案

## 硬件与 Web Bluetooth（ESP32-C3）

### 前端依赖与配置

- **[`bleConfig.js`](bleConfig.js)**：导出 `window.ESP32_BLE_CONFIG`  
  - `DEVICE_NAME`：与固件广播/设备名一致（默认 `ESP32-C3-Tracker`）  
  - `SERVICE_UUID` / `CHAR_TX_UUID` / `CHAR_RX_UUID`：与固件 GATT 一致（参考 `esp_gps_blue` 侧服务实现）  
  - `TIER_TO_VIB`：打卡掉落 **tier** → 震动档位（`1` 短震 / `2` 长震）；当前策略为 **仅 C 短震，B/A/S 长震**；未知 tier 时 **C→1，其余→2**
- **[`esp32BleClient.js`](esp32BleClient.js)**：`createEsp32BleClient()`  
  - `connect()`：`requestDevice`（按 `DEVICE_NAME` 过滤）→ `gatt.connect` → 订阅 TX 特征 **notify**（JSON 文本）  
  - `sendCommand(cmd)`：向 RX 特征 **write** 文本命令（如 `VIB:1`）  
  - `disconnect()`：断开并清理状态

### 打卡联动（震动）

- 在打卡流程中，当 **掉落场景 `droppedScene` 与 `thinkingSteps` 已就绪** 时调用 `sendBleVibForCheckin(droppedScene, scene)`：仅当 BLE **已连接** 时发送；tier 取自掉落场景或兜底场景，映射为 `VIB:<mode>`。
- 与 **Reward Modal** 文案中的「小爪子都震了一下」等可形成体验上的一致叙事；硬件未连接时该发送静默跳过，不影响打卡主流程。

### 运行环境与限制

- **浏览器**：需支持 `navigator.bluetooth`（常见为 **Chrome / Edge**，**桌面或安卓**）；**iPhone/iPad 上的 Safari 不支持 Web Bluetooth**，页面会提示。
- **安全上下文**：生产环境需 **HTTPS**（如 Vercel 部署）；本机 `localhost` 亦可用。
- **系统弹窗**：用户每次发起「搜索并连接」都会出现 **操作系统/浏览器提供的蓝牙设备选择器**，属正常行为，不是应用可关闭的“多余弹窗”。

## RAG + 记忆（重点）

### 记忆类型与前端数据结构（`appState.memories`）

- **情景记忆（episodic）**
  - 主要来自“打卡后生成的一篇日记”
  - 字段包含：`date/location/location_city/time_slot/personality/summary/emotion/diaryId/scene/key_facts/strength/importance/recall_*` 等
  - 支持记忆强度衰减（按周衰减），并在被使用时提升 strength（recall 强化）
- **语义记忆（semantic）**
  - 由当前人格配置生成的“长期特质片段”（用于展示与口吻一致性）
- **人格设定快照（semanticProfile）**
  - identity / preferences / speaking_style / call_user 等
  - 会被裁剪成“轻量快照”用于日记生成，避免长文本干扰
- **小习惯（habit）**
  - 记录互动行为形成的习惯摘要（也会被取摘要注入日记生成查询）

### 记忆的生成（写入）链路

1. **打卡触发生成日记**：前端调用 `POST /api/diary` 获取统一 JSON（正文 + 行为计划 + 橱柜计划 + 思考步骤 + memoryCount）。
2. **抽取“可检索摘要”**：前端优先调用 `POST /api/memory-summary`，从日记与上下文抽取：
   - `summary`（30–50 字、一句话可检索）
   - `emotion`（excited/tender/curious/nostalgic/calm）
   - `key_facts`（2–4 关键词，用于检索与掉落/主题判定）
   - 失败时回退模板 `buildEpisodicSummary(...)`
3. **写入前端情景记忆**：`appendEpisodicMemory(...)` 写入 `appState.memories.episodic`（带 strength/importance/recall 字段）。
4. **写入向量记忆池（RAG）**：异步调用 `POST /api/embed-and-store`
   - 将 `summary` + `key_facts` 拼成文本，使用 embedding 写入内存向量库（`lib/memory-vector-store.js`）。

### 记忆的检索（召回）链路

#### A. 前端“启发式召回”（非向量）

- `recallRelevantMemories(...)`：
  - 综合考虑：地点匹配、最近地点、时间段、key_facts 命中、strength、importance、recency
  - 用于：
    - 日记卡片“本次参考的记忆来源”展示（用户可展开）
    - 宠物气泡随机引用过去的旅行/日常记忆

#### B. 后端“向量 RAG 检索”（embedding + topK）

- `POST /api/retrieve`：
  - 对 query 文本做 embedding
  - 在 `memory-vector-store` 中做 cosine similarity topK
  - 返回 `memories: [{ content, metadata }]`

### RAG 如何注入日记生成（闭环）

- `POST /api/diary`（**RAG + 统一 JSON 生成**）：
  1. 组装 RAG query（地点 + 性格 + 爱好 + 人格偏好 + 习惯摘要等）
  2. 调 `POST /api/retrieve` 召回 `episodicMemories`（字符串摘要列表）
  3. 把 `episodicMemories + semanticTraits + semanticProfileSnapshot + habitSummaries` 注入到系统提示词中
  4. 让模型输出严格 JSON：
     - `content`：旅行日记正文（80–200 字）
     - `behaviorPlan`：宠物房间行为序列（emote/walk/anim/state/wait）
     - `cabinetPlan`：解锁物品建议 `unlockItems` + 家具主题建议 `furnitureSuggestions`
     - `thinkingSteps`：思考过程（可用于可解释 UI）
  5. 响应附带 `memoryCount`（本次注入的记忆条数）

### 可视化与可解释（让用户“看见记忆在工作”）

- **思考区**：播放 `thinkingSteps`，并在第 1 步展示“本次翻到的旅行记忆”列表。
- **日记卡片**：展示“这次我翻到了 X 条旅行记忆”，可展开查看来源。
- **RAG 调试面板**：调用 `GET /api/debug-memories` 展示向量记忆池总数与最近 N 条，并给出“按地点分布”小图。

## 收集物 / 橱柜 / 家具（与记忆联动点）

- **掉落与橱柜**
  - 橱柜容量：12 格
  - 新地点可触发掉落（含分 tier 的掉落逻辑与“新物品红点”）
  - 掉落后弹出 Reward Modal，并写入橱柜数据
- **RAG 参与“解锁来源”**
  - `api/diary` 返回的 `cabinetPlan.unlockItems` / `furnitureSuggestions` 会在前端打卡流程中被提前抽取：
    - 用作“本次掉落/解锁的解释来源”（`ragUnlockSource`）
    - 用作“家具主题推荐”的持久化（`lastFurnitureSuggestion`）
- **家具制作（生成资产）**
  - `POST /api/generate-furniture`：根据地点/日记片段生成一张“单个家具资产”图（isometric 3D 风格）
  - 前端有“制作中遮罩”承接过程，并支持“立即摆放”

## AIGC 能力（除 RAG 外的生成）

- **日记生成（统一入口）**：`POST /api/diary`（推荐路径，包含 RAG）
- **（兼容/旧）通用 Chat 代理**：`POST /api/chat`（OpenRouter 透传）
- **日记配图生成**：`POST /api/generate-image`
  - 前端在日记生成后异步触发
  - 成功后写入 `appState.diaryImages[diaryId]` 并支持导出

## 本地存储与状态持久化

- **`localStorage`**
  - 布局偏好：`soulgo_layout_mode`
  - 主状态：`soulgo_app_state_v1`（包含日记/橱柜/记忆/摆放等）
  - BGM 选择与音量：`soulgo_bgm` 等
  - 处理配额：当图片 data URL 导致 QuotaExceeded，会自动剥离部分 data URL 再重试保存
- **`sessionStorage`**
  - 一次会话内的“提示是否看过”（例如宠物房提示）

## 后端接口清单（与前端关系）

- **`POST /api/diary`**：RAG 检索 + 生成“统一 JSON（日记+行为+橱柜+思考）”
- **`POST /api/memory-summary`**：从日记与上下文抽取结构化记忆（summary/emotion/key_facts）
- **`POST /api/embed-and-store`**：将 summary/key_facts embedding 后写入向量记忆池
- **`POST /api/retrieve`**：对 query embedding 后从向量记忆池 topK 召回
- **`GET /api/debug-memories`**：调试用：查看向量记忆池最近 N 条
- **`POST /api/generate-image`**：生成日记配图
- **`POST /api/generate-furniture`**：生成家具资产
- **`POST /api/chat`**：OpenRouter 透传代理（通用）

## 当前实现的关键约束（会影响“记忆”表现）

- **向量记忆池是“进程内存”**：`lib/memory-vector-store.js` 里用数组存储，实例重启/冷启动后会清空。  
  - 这也是前端调试面板提示“可能是刚重启的实例（内存向量库会清空）”的原因。
- **前端记忆是本地持久化**：`appState.memories` 会留在浏览器 `localStorage`，不随服务端重启而消失（但也不跨设备同步）。
- **BLE 不经过服务端**：连接、命令、通知均在浏览器与设备之间完成；**无** `/api` 代理或配对记录；刷新页面后需重新连接。

