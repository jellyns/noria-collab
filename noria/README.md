# Noria 界面评审入口

本目录用于 Noria 的只读协作评审，位于公开的共享协作仓库 jellyns/gpt-collab 下。以下相对路径均以 noria/ 为基准。当前流程是：Pro 只读评审并在对话中返回建议 → Codex 保存结果并与用户讨论 → 按确认范围修改插件。不要尝试创建分支、提交文件或修改代码。此前私有读取/写入测试材料仅是历史背景，不再执行。

## 本轮材料

1. [用户原始需求与后续澄清](inputs/user-request.md)。
2. [13 张原图索引](inputs/images.md)：前 6 张为当前界面，后 7 张为参考图，原分辨率保存在 images/。
3. [讨论背景](inputs/discussion.md)：区分用户明确要求、助手建议与待定事项。
4. [完整评审任务](inputs/review-prompt.md)。
5. [当前代码快照](code/)：含未提交的最新实现。主要入口为 code/src/main.js、code/src/workbench.js、code/src/diary-workspace.js、code/src/record-fields.js、code/src/property-stat-cards.js、code/src/runtime/views/tasks-timeline/view.js 和 code/src/runtime/views/task-timeline/。
6. [代码哈希清单](code-manifest.json) 与 [材料清单](manifest.json)。

## 代码版本与验证

code/ 是当前工作区的固定快照，不是公开插件仓库旧 main 的副本。源码快照 SHA256 为 6b977ec0a7ce263d32df056731fc3a1232fd5d2466514f673dfdd2fc4503e54e，共 287 个源码及配套文件。旧 Git 基线为 4e613ba781c68181b1ceacda68680b5542a3c7b6，不能用它代替此快照。当前源码测试为 1048 通过、0 失败；本轮新方案尚未实现。

评审请读取本目录 code/，不要直接使用 jellyns/obsidian-noria 的旧 main 判断截图对应实现。图像无法实际查看时必须说明，不得用文件名或需求描述代替视觉检查。

## 输出与后续清理

完整建议在 Pro 对话中输出 Markdown，由 Codex 收回、保留到本地 Noria 项目，再继续讨论。无需写入 GitHub。评审和相关任务基本完成后，先将建议和所需材料保留本地，再清理 noria/ 项目目录。gpt-collab 是多个项目共用的协作仓库，不因 Noria 评审结束删除整个仓库。
