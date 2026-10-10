# 领域模型

## Entry

一条记录的稳定身份。创建后 ID 不变，当前正文由 `current_revision` 指向。

Entry 同时保存 UTC 时间、记录发生时的本地日历日期和 IANA 时区。“那年今日”按当时的本地月日查询，不能用用户今天所在的时区重新解释历史记录。

## EntryRevision

Entry 的不可变正文版本。创建记录生成 revision 1；每次修改新增版本，不覆盖历史版本。

## ClientOperation

客户端提交操作的幂等凭据。`user_id + operation_id` 唯一；相同操作重复提交返回第一次结果，相同 ID 携带不同内容返回冲突。

## AnalysisRequest

“记录并分析”模式在保存原文的同一数据库事务中创建的任务。任务绑定具体 Entry revision；模型调用失败或尚未执行都不能影响原文。

## AnalysisResult

一次分析任务的不可变派生结果，绑定 Entry revision，并保存 provider、model 与 prompt version。即时分析只允许保存带原文证据的短观察、一个可选开放问题，或固定的安全支持提示；它不覆盖 EntryRevision。

## ReflectionConversation / ReflectionMessage

一篇日记的一个 revision 对应一个持续回望对话。消息按顺序独立保存，用户消息使用客户端生成 ID 保证重试幂等；AI 消息记录 provider、model 和 prompt version。模型默认只能读取当前日记、即时回望及本对话最近消息，不能自动读取其他历史日记。

## 当前边界

- 独立 Supabase PostgreSQL 是实时业务真源，Supabase Auth 用户 ID 标识数据归属，RLS 控制读取。
- 客户端不能直接写业务表；创建记录只能通过受约束的 `create_entry` 数据库函数。
- Markdown 是未来的单向归档，不参与实时编辑。
- AI 输出不能写回 EntryRevision。
- 第一阶段不建立心情、天气、地点和标签字段。
- “那年今日”和“同日多年”是原始记录的确定性查询，不依赖 AI；多年总结属于可删除、可重建的派生资料。
