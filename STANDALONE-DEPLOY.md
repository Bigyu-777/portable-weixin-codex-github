# 微信直连 Codex 独立桥接部署说明

## 适用场景

这是一个不依赖 OpenClaw runtime 的独立版微信桥接器。

你可以把整个目录复制到另一台机器上使用，只要那台机器满足：

- 已安装 Node.js 22+
- 已安装并可运行 `codex`
- 能访问微信接口

## 目录里的关键文件

- `dist/`：编译后的可运行代码
- `node_modules/`：运行依赖
- `standalone-config.json`：独立配置文件
- `standalone-run.bat`：Windows 启动脚本

## 配置文件

编辑 `standalone-config.json`：

```json
{
  "sessionRoot": "F:\\weixin-codex-sessions",
  "httpProxy": "http://127.0.0.1:7890",
  "disableLocalProxy": false,
  "codexCommand": "",
  "codexWorkdir": "",
  "codexTimeoutMs": 180000
}
```

字段说明：

- `sessionRoot`
  每个微信会话保存文件的根目录。你以后可以直接改这里，不用改源码。
- `httpProxy`
  微信接口和网页抓取使用的代理，例如 `http://127.0.0.1:7890`。
- `disableLocalProxy`
  设为 `true` 时，不再默认使用本地 `7890` 代理。
- `codexCommand`
  `codex` 可执行文件路径。留空则默认尝试系统里的 `codex.exe`。
- `codexWorkdir`
  Codex 默认工作目录。留空则使用当前运行目录。
- `codexTimeoutMs`
  单次 Codex 执行超时时间，单位毫秒。

## 首次使用

在目录里打开终端：

```powershell
standalone-run.bat login
```

扫码登录后，启动桥接：

```powershell
standalone-run.bat run
```

## 日常使用

- 直接发文字：和 Codex 聊天
- 直接发文件/图片：只保存到当前 session，不自动处理
- 引用某个文件/图片再发文字：让 Codex 操作这个文件
- 如果 Codex 产出了当前 session 目录下的新文件，桥接器会优先直接把文件发回微信

## 进度反馈

桥接器会把 Codex 的执行状态转成微信进度消息，而不是只提示“任务进行中”。

你可能会看到：

- `我接着上次的线程继续处理。`
- `我在终端跑：...`
- `跑完了，输出前几行：...`
- `这条命令失败了，退出码 ...`
- `还在处理，已经约 N 分钟；我会继续等结果。`

命令输出只会截取前几行，避免刷屏。最终答案不会再提前作为“阶段摘要”重复发送；长期任务仍会保留低频心跳提示。

## 常用命令

- `/help`
- `/m` 或 `/menu`
- `/where`
- `/ls`
- `/g <目标>`
- `/p [任务]`
- `/s [skill] [任务]`
- `/pl [plugin] [任务]`
- `/st`
- `/model`
- `/model <编号|模型名>`
- `/effort`
- `/effort <编号|档位>`
- `/new`
- `/reset`
- `/thread`
- `/idea <内容>`
- `/ideas`
- `/send`
- `/send <文件名>`
- `/mode`

## 手机友好交互

微信聊天框没有补全，建议优先用菜单和自然语言。

### 菜单

发送：

```text
/m
```

桥接器会返回数字菜单：

```text
1. 设置目标
2. 打开/关闭计划模式
3. 使用 skill
4. 使用 plugin
5. 查看当前状态
6. 发送最近文件
7. 新建会话
```

之后直接回复数字即可。比如回复 `3` 选择 skill，再回复 `pdf`，然后继续发“总结刚才的文件”。回复 `0`、`取消` 或 `退出` 可以结束当前向导。

### 短别名

- `/g <目标>` 等同于 `/goal <目标>`
- `/p` 打开计划模式
- `/p <任务>` 对这一条任务使用计划模式
- `/s` 查看当前 skill
- `/s pdf` 设置默认 skill 为 `pdf`
- `/s pdf <任务>` 用 `pdf` skill 处理这一条任务
- `/pl github` 设置默认 plugin 为 `github`
- `/pl github <任务>` 用 `github` plugin 处理这一条任务
- `/st` 查看当前状态

### 自然语言触发

下面这些不用记命令，直接发中文也可以：

```text
目标：优化微信 bridge，让它更适合手机操作
开启计划模式
关闭计划模式
计划一下怎么整理这个项目
用 pdf skill 总结刚才的文件
用 github 插件查 CI
状态
菜单
```

自然语言触发只处理比较明确的句式；普通聊天不会被强行当成命令。

## Goal / Plan / Skills / Plugins

独立桥接器支持在微信里给当前联系人设置工作模式。这些模式会保存在该联系人自己的会话状态里，不影响其他联系人。

默认图像处理 skill 是 `image2`。当你明确要生成图片、出图、改图、修图、换背景、合成、风格化等操作时，桥接器会自动让 Codex 使用 `image2`；普通“这张图里有什么”这类图片理解不会强制触发。

- `/goal <目标>`
  设置长期目标。之后的普通消息会自动带上这个目标上下文。
- `/goal`
  查看当前目标。
- `/goal clear`
  清除当前目标。
- `/plan`
  打开计划模式。之后的普通消息会要求 Codex 先给短计划再执行。
- `/plan off`
  关闭计划模式。
- `/plan <任务>`
  只对这一条任务使用计划模式，不改变开关状态。
- `/skills [关键词]`
  扫描本机 `~/.codex/skills`、`~/.agents/skills` 和插件缓存里的 `SKILL.md`。
- `/skill <名称>`
  设置当前联系人默认 skill。之后普通消息会要求 Codex 读取并遵守该 `SKILL.md`。
- `/skill <名称> <任务>`
  只对这一条任务使用指定 skill。
- `/skill off`
  关闭默认 skill。
- `/plugins [关键词]`
  查看本机 Codex plugin 缓存。
- `/plugin <名称>`
  设置当前联系人默认 plugin。
- `/plugin <名称> <任务>`
  只对这一条任务优先使用指定 plugin。
- `/plugin off`
  关闭默认 plugin。

示例：

```text
/goal 优化 portable-weixin-codex，让微信里能调用 Codex skills 和插件
/plan
/skills pdf
/skill pdf 总结我刚刚发的 PDF
/plugins github
/plugin github 看一下当前 PR 的 CI 为什么失败
```

说明：当前 Codex CLI 的 `exec` 子命令没有原生 `--goal` 或 `--plan` 参数，所以这里的 goal/plan 是桥接器侧的提示上下文注入。它会把目标、计划模式、默认 skill/plugin 写进发给 Codex 的任务中。

## 迁移到另一台机器

1. 复制整个目录
2. 确保新机器安装了 Node.js 22+ 和 Codex CLI
3. 修改 `standalone-config.json`
4. 运行 `standalone-run.bat login`
5. 运行 `standalone-run.bat run`

## 建议

- 建议把 `sessionRoot` 放在独立盘符，例如 `F:\\weixin-codex-sessions`
- 如果新机器的 `codex` 不在 PATH 里，直接把 `codexCommand` 写成绝对路径
