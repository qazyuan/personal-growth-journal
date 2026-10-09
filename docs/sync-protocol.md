# 同步协议

## 第一阶段

第一阶段实现客户端稳定 ID、`operationId` 幂等提交、本地 outbox 和 Supabase 时间线。用户点击保存后先写浏览器本地 outbox，再请求统一 API；成功确认后移除，失败时等待浏览器恢复网络自动重试。未提交草稿只保存在产生它的设备。

## 后续协议

第二阶段增加：

- `change_events.sequence` 服务端递增游标；
- `GET /api/sync/changes?after={cursor}`；
- iOS 使用本地数据库实现与网页相同语义的 outbox；
- 修改时携带 `base_revision`；
- 版本冲突返回 `revision_conflict`，不得最后写入覆盖；
- 软删除产生 tombstone 事件。
