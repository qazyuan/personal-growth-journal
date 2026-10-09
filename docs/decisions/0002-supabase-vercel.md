# ADR 0002：采用 Supabase + Vercel 托管架构

状态：已接受，取代 ADR 0001 中“本机独立 Fastify/API/Worker/PostgreSQL 是第一阶段运行架构”的部分。模块化单体和共享领域边界仍保留。

## 决策

- 为本产品建立独立 Supabase 项目，不与 `yiju` 共用数据库；
- Supabase PostgreSQL 是实时业务真源，Supabase Auth 管理身份，所有公开表启用 RLS；
- Next.js 同时提供网页和统一记录 API，部署在 Vercel；
- Web 和未来 iOS 客户端都使用稳定 ID、`operationId` 和本地 outbox；
- 创建记录通过 PostgreSQL RPC 在同一事务内写入 entry、revision、幂等操作和可选 AI 任务；
- AI、ASR 和 Markdown 归档不阻塞原始记录保存；
- Markdown 是从 Supabase 单向生成的长期档案，不承担实时同步；
- Vercel Function 不承担永久常驻 Worker。耗时任务后续通过数据库队列配合受限函数或独立 Worker 执行。

## 原因

- 复用 `yiju` 已验证的 Next.js、Supabase Auth、用户 JWT 和 RLS 结构；
- 避免 Intel Mac 本地 PostgreSQL 安装和始终在线服务成为多端使用前提；
- Supabase 仍是标准 PostgreSQL，便于迁移与完整导出；
- Vercel 适合部署响应式网页和以请求为边界的服务端逻辑；
- 本地 outbox 与 Markdown 归档分别解决弱网防丢和长期可读性问题。

## 后果

- 核心记录依赖互联网，但网络失败不会丢失已进入本地 outbox 的内容；
- 需要对 Supabase/Vercel 在真实移动网络下的延迟和可用性做实机验收；
- 第一阶段不提供端到端加密；
- 必须维护数据库迁移、最小权限 grants、RLS 测试、导出和恢复演练；
- 旧本机栈移动到 `archive/legacy-local-stack`，不再参与构建。
