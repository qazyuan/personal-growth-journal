# Personal Growth Journal

产品名：**来时路**。产品文案：**记录此刻，看见一路走来的自己。**

个人成长记录系统当前采用与 `yiju` 一致并进一步加固的云端路线：Next.js 同时承载响应式网页和统一记录 API，部署到 Vercel；Supabase 提供 PostgreSQL、Auth 和 RLS；客户端使用本地 outbox 防止弱网丢失；后续由 Mac 单向导出 Markdown 到 Obsidian。

## 当前纵向链路

- 邮箱密码注册与登录；
- Mac、iPad、iPhone 浏览器共享同一记录服务；
- 在写完内容后直接选择“只保存 / 保存并分析”；
- 保存前先进入浏览器本地 outbox，失败后恢复网络自动重试；
- Vercel 上的 Next.js API 验证用户和输入；
- Supabase PostgreSQL 事务写入原文、第一版 revision、幂等操作和可选分析任务；
- 模型无关 AI 适配器生成有原文证据的短回望，分析状态与结果单独持久化；
- 即时回望下可以展开多轮对话；默认上下文仅包含当前日记、即时回望和本次对话；
- AI 失败不回滚原始记录，页面可以稍后重试；
- RLS 限制每个用户只能访问自己的数据。
- 记录删除采用软删除：立即从时间线移除，但不会直接物理销毁原文。
- 首页显示“那年今日”，按记录发生时的本地月日回看历年原文，不依赖 AI；
- “完整历史”按月份和日期浏览全部记录，首页仍只保留最近记录，避免被历史内容挤满。
- “半年回顾”把最近六个月的日记分段整理为可追溯的主题、转折与变化，每条证据都可以点回原文。

当前即时分析支持智谱、DeepSeek 和其他 OpenAI Chat Completions 兼容接口。业务层只依赖统一适配器，后续替换模型不需要改记录或结果数据模型。

## 环境要求

- Node.js 20.9+
- npm
- 一个独立的 Supabase 项目

不再要求本机安装 PostgreSQL、Docker或长期运行 Fastify 服务。

## 本地启动

1. 安装依赖：

   ```bash
   npm install
   ```

2. 复制根目录环境变量到 `apps/web/.env.local`，填写 Supabase 项目 URL 与 publishable key：

   ```bash
   cp .env.example apps/web/.env.local
   ```

3. 在确认选中的是本项目独立 Supabase 项目后，通过 Supabase SQL Editor 应用：

   ```text
   supabase/migrations/202610090001_initial_journal.sql
   ```

   如果数据库曾在 2026-10-09 的“那年今日”日期字段加入前初始化，还需要继续执行：

   ```text
   supabase/migrations/202610090002_add_local_date_for_memories.sql
   ```

   为启用真实 AI 分析，还需要继续执行：

   ```text
   supabase/migrations/202610090003_persist_ai_analysis.sql
   ```

   为启用多轮回望对话，还需要继续执行：

   ```text
   supabase/migrations/202610090004_reflection_conversations.sql
   ```

   为启用记录删除，还需要继续执行：

   ```text
   supabase/migrations/202610100005_soft_delete_entries.sql
   ```

   为启用历史 Excel 日记导入，还需要继续执行：

   ```text
   supabase/migrations/202610100006_import_journal_entries.sql
   ```

   为启用半年及其他阶段回顾，还需要继续执行：

   ```text
   supabase/migrations/202610110007_periodic_reviews.sql
   ```

4. 在 `apps/web/.env.local` 中配置服务端 AI 环境变量。以 DeepSeek 为例：

   ```dotenv
   AI_PROVIDER=deepseek
   AI_API_KEY=你的密钥
   AI_MODEL=你要使用的模型名
   AI_FALLBACK_MODEL=
   ```

   若使用其他兼容 OpenAI Chat Completions 的服务，设置 `AI_PROVIDER=openai-compatible`，并把 `AI_BASE_URL` 指向其 API 根路径。

5. 在 Supabase Authentication 中启用 Email/Password。开发期可以暂时关闭邮箱确认；正式开放前应配置自定义 SMTP 和正确的 Site URL。

6. 启动：

   ```bash
   npm run dev
   ```

登录后可在回看区选择“导入日记”。当前导入器读取 `.xlsx` 的第 3 个工作表，要求至少包含“时间”和“文本内容”两列；“地址”“标签”“更新时间”为可选列。确认前会展示可导入、重复和错误记录，历史日记默认只保存原文，不自动触发 AI 分析。导入后可通过“完整历史”按日期范围查看；首页下方的“那年今日”会自动聚合往年同月同日的原始记录。“半年回顾”会读取最近六个月最多 500 篇日记，生成一次可保存、可回查原文的阶段总结。

7. 打开 <http://localhost:3000>，创建账号或登录。

## Vercel 部署

1. 把仓库推送到 GitHub，并在 Vercel 导入；
2. Framework 选择 Next.js，Root Directory 选择 `apps/web`；
3. 配置 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 和服务端 `AI_*` 变量；
4. 将 Vercel 正式域名加入 Supabase Auth 的 Site URL / Redirect URLs；
5. 部署后用两个浏览器会话验证保存、刷新、跨端读取和用户隔离。

publishable key 可以进入浏览器，但所有公开表必须启用 RLS。不得把 Supabase secret/service role key 或 AI API Key 放入 `NEXT_PUBLIC_` 环境变量。

## 验证

```bash
npm run typecheck
npm run lint
npm run build
```

真实数据链路还必须完成人工验收：同一 `operationId` 重试不重复写入；断网保存进入 outbox；账号 B 无法读取账号 A 的记录。

## 目录

```text
apps/web                 Next.js 网页、登录和统一 API
packages/contracts       Web、API 与未来 iOS 共享契约
supabase/migrations      PostgreSQL schema、RLS 与事务函数
docs                     领域、同步、归档和架构决策
archive/legacy-local-stack  调整前的本机 Fastify/Worker/PostgreSQL 实现，只供回查
```
