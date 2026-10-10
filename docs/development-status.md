# 开发状态

更新时间：2026-10-09

## 当前方向

项目已从本机 Fastify + PostgreSQL 调整为独立 Supabase 项目 + Vercel/Next.js。旧实现保存在 `archive/legacy-local-stack`，不参与当前构建。

## 本轮已完成

- Next.js 内建立统一 `/api/entries` 记录接口；
- 加入 Supabase 邮箱密码登录和用户 JWT 验证；
- 建立 Supabase migration、最小权限 grants 和四组 RLS；
- 使用数据库 RPC 在一个事务内创建原始记录、revision、幂等操作与可选分析任务；
- 记录页把模式切换与保存动作合并为“只保存 / 保存并分析”两个按钮；
- 产品名统一为“来时路”，文案为“记录此刻，看见一路走来的自己”；
- 记录保存本地日历日期和 IANA 时区，为“那年今日 / 同日多年”避免跨时区错位；
- 提供 `202610090002_add_local_date_for_memories.sql`，升级已经应用过早期 schema 的 Supabase 项目；
- 保存前先写浏览器本地 outbox，网络恢复后自动重试；
- 根目录脚本、环境变量、README 和系统设计切换到新路线；
- 原 Fastify、独立 Worker 和本机数据库实现已可恢复归档。
- 加入真实即时 AI 分析闭环：模型适配器、严格结构校验、原文证据校验、结果持久化和失败重试；
- AI 分析绑定 entry revision，并记录 provider、model 和 prompt version，原始日记不被改写；
- 时间线可显示分析进度、短回望、引用证据、开放问题和安全提示；
- 加入可脱离 Supabase 运行的 AI 结果边界测试。
- 加入日记级多轮回望对话：消息持久化、客户端消息幂等、失败重试和刷新恢复；
- 多轮模型上下文默认限制为当前日记、即时回望和当前对话最近消息，不读取其他历史日记。

## 尚未完成的真实验收

仓库中没有本项目的 Supabase 凭据，也没有授权直接创建云端项目。因此以下事项必须在建立独立 Supabase 项目后完成，不能以静态检查替代：

1. 应用四个 migration，包括最新的 `202610090004_reflection_conversations.sql`；
2. 配置 Email/Password Auth 和 Vercel 回调域名；
3. 本地真实注册、登录、保存、刷新、AI 分析和 outbox 重试；
4. 用两个账号验证 RLS，确认账号 B 不能读取或修改账号 A 的数据；
5. 同一 `operationId` 重放两次，确认只有一条 entry、一条 revision 和一个 analysis request；
6. 部署 Vercel，并用 iPhone、iPad、Mac 的实际网络测量可用性。

## 已完成的代码检查

- `npm run typecheck`：通过；
- `npm run lint`：通过；
- `npm test`：通过，包含 AI 结构、证据引用、诊断越界和安全响应测试；
- `npm run build`：通过，生成静态首页与记录、分析 API；
- `npm audit --omit=dev`：0 个生产依赖漏洞；
- 完整开发依赖审计仍报告 Next.js ESLint 工具链经 `fast-glob` / `micromatch` / `braces` 传递的公告。自动修复会把 `eslint-config-next` 降到与 Next.js 16 不兼容的 14.x，因此没有执行 `--force`。

## 下一步

先应用 AI 增量迁移、配置一个真实模型并完成 20 条自选记录的短回望验收。通过后优先开发“那年今日 / 同日多年”的确定性原文回顾；Markdown 归档仍在后续独立阶段，不进入保存请求。
