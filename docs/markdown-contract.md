# Markdown 归档契约

本功能在第一条 Web/API 链路稳定后实现。

- 一条记录一个文件：`Journal/Entries/YYYY/MM/<entry-id>.md`
- 文件包含记录 ID、版本、发生时间、来源、正文校验值和正文。
- 使用临时文件加原子替换。
- 数据库通过 `archive_materializations` 保存路径、版本、校验值和状态。
- Obsidian 中的原始记录文件第一阶段只读，不反向同步。
