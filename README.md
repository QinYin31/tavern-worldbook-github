# Tavern Worldbook

一个本地运行的世界书驱动剧情对话应用，支持章节原文、角色设定、长期记忆、关系状态、原著锚点和 AI 灵感选项。

## 获取项目

普通用户不需要创建或管理本地 Git 仓库，可以在 GitHub 页面点击 **Code > Download ZIP**，解压后进入项目文件夹。

如果熟悉 Git，也可以使用：

```bash
git clone https://github.com/QinYin31/tavern-worldbook-github.git
cd tavern-worldbook-github
```

首次下载项目后不需要执行 `git pull`。只有已经下载过项目，并且需要获取 GitHub 上的新版本时，才需要执行：

```bash
git pull origin main
```

## 开发模式

在项目文件夹中打开 CMD 或 PowerShell，首次使用先安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

打开 `http://127.0.0.1:5173`。

开发模式适合调试和修改代码，保存代码后页面通常会自动更新。

## 生产模式

生产模式适合正式运行：

```bash
npm run build
npm run start
```

打开 `http://127.0.0.1:8787`。

其中，`npm run build` 会生成优化后的正式文件，`npm run start` 会启动正式服务。

## 配置 API

打开应用内的设置，填写自己的 `Base URL`、`API Key` 和模型名称。支持 OpenAI-compatible、Anthropic-compatible 和 Gemini-compatible 接口。

项目不会在源码中保存 API Key。配置默认保存在浏览器 IndexedDB 中，公开仓库不包含任何本地 API 配置、对话或同步数据。

## 导入世界书

可以在设置中导入自己的 `worldbook.json`，也可以参考 `examples/worldbook.json`。

世界书格式为 `tavern-worldbook/v1`，支持角色、地点、物品、势力、章节、原文锚点、世界规则和叙事风格。

## AI 灵感

点击输入框旁边的“AI 灵感”，应用会结合当前场景、人物关系、已确认记忆和章节锚点生成几个行动建议。点击建议只会填入输入框，仍需由用户确认后发送。

## 本地数据

书籍、会话、记忆和 API 配置保存在浏览器 IndexedDB 中。服务端同步数据保存在运行目录的 `server/data/sync.json`，该文件已被 `.gitignore` 排除，不应提交到公开仓库。

## 发布前检查

提交代码前可以运行：

```bash
npm test
npm run build
```

不要提交 `.env`、API Key、原始小说 TXT、个人世界书、对话数据或 `server/data/sync.json`。
