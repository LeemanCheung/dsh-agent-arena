# dsh-agent-arena

[English](README.md) | 中文

DSH 编码竞技场：在隔离 Git worktree 中比较 2–4 个已配置模型，用确定性命令验证改动，审阅每份 diff，并由用户显式应用一名获胜者。

## 界面截图

![Agent Arena 结果与 Diff 审阅](https://raw.githubusercontent.com/LeemanCheung/dsh-agent-arena/main/assets/screenshots/overview.png)

> 使用 GPT Image 根据已实现的 Client 布局和功能生成；实际外观会随 DSH 主题和视口变化。

## 执行与持久化

- 在操作系统临时目录创建 detached worktree，与被比较仓库分离。
- 通过公开的 `ctx.agents.create`、`SessionId`、`createUserMessage` 和 `Agent.followup` API 启动选手。
- Git 和验证 argv 都通过 `ctx.subprocess.spawn` 执行；绝不经过 shell，并拒绝 shell 操作符。
- 使用 `storageDomain` 保存比赛报告；Host 重启后，未结束的比赛会标记为失败。
- Settings 通过生成的 `agentArena` Remote 轮询状态，提供 Start、Cancel、diff 审阅和 Apply winner，不依赖浏览器全局变量。

## 评分与应用

每条验证命令有正权重。选手得分等于成功退出的验证权重占总权重的百分比；同分时按选手 id 稳定排序。不会使用 LLM 评委。

创建 worktree 前要求 `git status --porcelain=v1` 干净。获胜者 worktree 会保留到用户显式应用。应用时再次检查仓库干净、确认 `HEAD` 仍等于比赛开始时记录的 revision，先运行 `git apply --check`，再运行 `git apply --index --whitespace=error`。Arena 不会自动应用、提交、推送或改写历史。

## Settings 使用流程

1. 填写工作区干净的 Git 仓库路径和明确的任务目标。
2. 配置 2–4 位选手的显示名称、provider 与 model；每位选手都在独立会话和 worktree 中运行。
3. 添加 1–12 条验证 argv，并为每条设置正权重和 1–900 秒超时。界面会预先标出不安全的命令字符。
4. 在比赛面板查看阶段状态、事件时间线、加权得分、每条验证输出、改动文件和 diff；活跃比赛可取消。
5. 比赛完成后先审阅 diff，再点击“申请应用胜者”，并在确认面板中明确应用。应用前仍会检查仓库干净、起始 revision 漂移和补丁可用性。

Settings 通过生成的 `agentArena` Remote 轮询比赛状态；客户端不会把 API 放在浏览器全局变量中。

## 验证命令语法

Settings 字段接受保守的空格分隔 argv，例如 `corepack pnpm test` 或 `git status --porcelain=v1`。引号、shell 变量、管道、重定向、命令分隔符、反引号和换行都会被拒绝。请选择参数本身不含空格的命令。

## 安装

```powershell
dsh plugin --profile web add github:LeemanCheung/dsh-agent-arena
```

安装后重启原有 DSH Web 进程并刷新页面。profile 必须提供 `agents`、`subprocess`、`storageDomain`、Typert Remotes、Settings，以及至少两条可用 provider/model 路由。完整说明见[套件安装指南](../../INSTALL.zh-CN.md)。

## 模型体验

每个选手都在独立会话和 worktree 中接收一条包含 Arena 任务目标的用户消息，因此 token 和 KV cache 使用量会按 2–4 个独立选手会话增长。验证、评分、比较、取消、持久化与应用不会再调用其他模型。

## 已知限制

验证 argv 使用刻意保守的分词规则，无法表达本身包含空格的参数。取消依赖所选 provider 正确响应 abort signal。Host 使用支持二进制的 `git diff HEAD`，确保已暂存、未暂存和 intent-to-add 文件在审阅与应用时一致。超过 1 MB 审阅/应用上限的补丁会在修改原仓库前明确拒绝，而不是被截断。

## 开发

在仓库根目录运行 `corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build` 和 `corepack pnpm pack:check`。

MIT，见 [LICENSE](LICENSE)。
