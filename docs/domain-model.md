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

## ImportBatch / EntryImportSource

一次 Excel 确认导入对应一个 ImportBatch，保存原文件名、文件 SHA-256、总行数以及导入和重复数量。相同用户重复提交同一文件时直接返回第一次结果。

每条导入日记生成 EntryImportSource，保存工作表行号、来源指纹、源更新时间、地址和标签。来源指纹由发生时间、正文、地址和标签生成；同一条记录出现在后续导出文件中时会被跳过。地址和标签目前只是可追溯的导入元数据，不是 Entry 的正式查询字段。

## PeriodicReview

一段明确日期范围的阶段回顾。当前界面先提供最近半年，数据模型同时允许年度和自定义范围。生成时先按容量把日记分段提炼，再汇总为整体脉络、反复主题、重要转折、已经发生的变化、仍在路上的问题和一个可选开放问题。

PeriodicReview 保存日期范围、纳入的日记数量、状态、结构化结果、provider、model 和 prompt version。所有主题和转折证据都必须引用真实 Entry ID、本地日期和正文原句；展示时可以从引用跳回原始日记。它是可删除、可重建的派生资料，不改写 EntryRevision。

## 当前边界

- 独立 Supabase PostgreSQL 是实时业务真源，Supabase Auth 用户 ID 标识数据归属，RLS 控制读取。
- 客户端不能直接写业务表；创建记录只能通过受约束的 `create_entry` 数据库函数。
- Markdown 是未来的单向归档，不参与实时编辑。
- AI 输出不能写回 EntryRevision。
- 第一阶段不建立心情、天气、地点和标签正式字段；Excel 中的地址和标签先保存在导入来源元数据中。
- 历史 Excel 导入只创建 `record_only` 记录，不自动批量触发 AI 分析。
- “那年今日”和“同日多年”是原始记录的确定性查询，不依赖 AI；多年总结属于可删除、可重建的派生资料。
- 阶段回顾最多读取一个范围内 500 篇有效日记；超过上限时先要求缩短范围，避免静默遗漏。
