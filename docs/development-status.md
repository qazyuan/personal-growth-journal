# 开发状态

更新时间：2026-10-09

## 当前方向

项目已从本机 Fastify + PostgreSQL 调整为独立 Supabase 项目 + Vercel/Next.js。旧实现保存在 `archive/legacy-local-stack`，不参与当前构建。

## 本轮已完成

- Next.js 内建立统一 `/api/entries` 记录接口；
- 加入 Supabase 邮箱密码登录和用户 JWT 验证；
- 建立 Supabase migration、最小权限 grants 和四组 RLS；
- 使用数据库 RPC 在一个事务内创建原始记录、revision、幂等操作与可选分析任务；
- 页面加入“只记录 / 记录并分析”切换；
- 保存前先写浏览器本地 outbox，网络恢复后自动重试；
- 根目录脚本、环境变量、README 和系统设计切换到新路线；
- 原 Fastify、独立 Worker 和本机数据库实现已可恢复归档。

## 尚未完成的真实验收

仓库中没有本项目的 Supabase 凭据，也没有授权直接创建云端项目。因此以下事项必须在建立独立 Supabase 项目后完成，不能以静态检查替代：

1. 应用 `supabase/migrations/202610090001_initial_journal.sql`；
2. 配置 Email/Password Auth 和 Vercel 回调域名；
3. 本地真实注册、登录、保存、刷新和 outbox 重试；
4. 用两个账号验证 RLS，确认账号 B 不能读取或修改账号 A 的数据；
5. 同一 `operationId` 重放两次，确认只有一条 entry、一条 revision 和一个 analysis request；
6. 部署 Vercel，并用 iPhone、iPad、Mac 的实际网络测量可用性。

## 已完成的代码检查

- `npm run typecheck`：通过；
- `npm run lint`：通过；
- `npm test`：通过，当前工作区尚未加入可脱离 Supabase 运行的自动化测试；
- `npm run build`：通过，生成静态首页与动态 `/api/entries`；
- `npm audit --omit=dev`：0 个生产依赖漏洞；
- 完整开发依赖审计仍报告 Next.js ESLint 工具链经 `fast-glob` / `micromatch` / `braces` 传递的公告。自动修复会把 `eslint-config-next` 降到与 Next.js 16 不兼容的 14.x，因此没有执行 `--force`。

## 下一步

先完成 Supabase/Vercel 的真实纵向链路验收。通过后实现分析任务执行器和模型适配器；Markdown 归档仍在后续独立阶段，不进入保存请求。
