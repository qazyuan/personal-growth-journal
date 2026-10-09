# Personal Growth Journal

个人成长记录系统。当前采用与 `yiju` 一致并进一步加固的云端路线：Next.js 同时承载响应式网页和统一记录 API，部署到 Vercel；Supabase 提供 PostgreSQL、Auth 和 RLS；客户端使用本地 outbox 防止弱网丢失；后续由 Mac 单向导出 Markdown 到 Obsidian。

## 当前纵向链路

- 邮箱密码注册与登录；
- Mac、iPad、iPhone 浏览器共享同一记录服务；
- “只记录 / 记录并分析”两种模式；
- 保存前先进入浏览器本地 outbox，失败后恢复网络自动重试；
- Vercel 上的 Next.js API 验证用户和输入；
- Supabase PostgreSQL 事务写入原文、第一版 revision、幂等操作和可选分析任务；
- RLS 限制每个用户只能访问自己的数据。

“记录并分析”当前只创建可靠的 `analysis_requests` 任务，不调用具体模型。AI Provider Adapter 与任务执行属于下一阶段。

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

4. 在 Supabase Authentication 中启用 Email/Password。开发期可以暂时关闭邮箱确认；正式开放前应配置自定义 SMTP 和正确的 Site URL。

5. 启动：

   ```bash
   npm run dev
   ```

6. 打开 <http://localhost:3000>，创建账号或登录。

## Vercel 部署

1. 把仓库推送到 GitHub，并在 Vercel 导入；
2. Framework 选择 Next.js，Root Directory 选择 `apps/web`；
3. 配置 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；
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
