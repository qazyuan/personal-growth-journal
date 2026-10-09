# 领域模型

## Entry

一条记录的稳定身份。创建后 ID 不变，当前正文由 `current_revision` 指向。

## EntryRevision

Entry 的不可变正文版本。创建记录生成 revision 1；每次修改新增版本，不覆盖历史版本。

## ClientOperation

客户端提交操作的幂等凭据。`user_id + operation_id` 唯一；相同操作重复提交返回第一次结果，相同 ID 携带不同内容返回冲突。

## AnalysisRequest

“记录并分析”模式在保存原文的同一数据库事务中创建的任务。任务绑定具体 Entry revision；模型调用失败或尚未执行都不能影响原文。

## 当前边界

- 独立 Supabase PostgreSQL 是实时业务真源，Supabase Auth 用户 ID 标识数据归属，RLS 控制读取。
- 客户端不能直接写业务表；创建记录只能通过受约束的 `create_entry` 数据库函数。
- Markdown 是未来的单向归档，不参与实时编辑。
- AI 输出不能写回 EntryRevision。
- 第一阶段不建立心情、天气、地点和标签字段。
