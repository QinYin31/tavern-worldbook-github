# Tavern Worldbook

一个本地运行的世界书驱动剧情对话应用，支持章节原文、角色设定、长期记忆、关系状态、原著锚点和 AI 灵感选项。

## 启动

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。

生产模式：

```bash
npm run build
npm run start
```

打开 `http://127.0.0.1:8787`。

## 配置 API

打开应用内的设置，填写自己的 `Base URL`、`API Key` 和模型名称。支持 OpenAI-compatible、Anthropic-compatible 和 Gemini-compatible 接口。

本项目不会在代码中保存 API Key。配置默认保存在浏览器 IndexedDB 中，发布副本不包含任何本地配置、对话或同步数据。

## 导入世界书

可以在设置中导入自己的 `worldbook.json`，也可以参考 `examples/worldbook.json`。

世界书格式为 `tavern-worldbook/v1`，支持角色、地点、物品、势力、章节、原文锚点、世界规则和叙事风格。

## AI 灵感

点击输入框旁的“AI 灵感”，应用会结合当前场景、人物关系、已确认记忆和章节锚点生成几个行动建议。点击建议只会填入输入框，仍由用户确认后发送。

## 本地数据

书籍、会话、记忆和 API 配置保存在浏览器 IndexedDB 中。服务端同步数据保存在运行目录的 `server/data/sync.json`，该文件已被 `.gitignore` 排除，不应提交到公开仓库。
