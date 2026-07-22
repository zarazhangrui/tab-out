# Tab Out

[English](README.md) | [简体中文](README.zh-CN.md)

**轻松管理你的所有标签页。**

Tab Out 是一个 Chrome 与 Microsoft Edge 扩展，可将新标签页替换成简洁的标签页管理仪表盘。它会按域名对已打开的标签页进行分组，将 Gmail、X、LinkedIn 等网站的主页集中到一个分组，并提供带音效和动画的快捷关闭操作。

无需服务器，也无需注册账户。扩展唯一的外部 API 请求是访问 `https://myip.ipip.net/` 获取公网 IP；返回结果仅用于当前页面显示，不会被保存。

这个增强 Fork 由 [`zjwww/tab-out`](https://github.com/zjwww/tab-out) 维护，基于 Zara 的[原始 Tab Out 项目](https://github.com/zarazhangrui/tab-out)开发。

---

## 本 Fork 的增强功能（v1.1.0）

这些改动也已通过[上游 PR #64](https://github.com/zarazhangrui/tab-out/pull/64)提交给原项目。

### 改动内容

- 增加自动适配操作系统的深色模式，并允许持久保存“跟随系统、浅色、深色”选择
- 增加英语与简体中文界面，包括本地化的扩展名称和说明
- 通过 `https://myip.ipip.net/` 显示公网 IP 和原始归属地信息，并提供超时、重试、响应式对齐和主题强调色
- 补充 Google Chrome、Microsoft Edge 安装说明和公网 IP 请求说明
- 对来自标签页的文本进行 HTML 转义，降低恶意网页标题注入扩展界面的风险

### 为什么进行这些改动

原版新标签页仅提供英文浅色界面，也没有显示网络信息。这些改动让扩展能够适配操作系统主题、支持简体中文，并同时服务于 Chrome 和 Edge 用户。新增的外部请求被严格限制在公网 IP 接口，并在文档中明确说明。

### 对用户的影响

用户可以跟随系统主题或手动选择主题，在英语和简体中文之间切换，并在问候语下方查看公网 IP 及接口返回的原始归属地。界面偏好和稍后查看的标签页仍保存在本地，公网 IP 返回结果不会持久化。

### 验证方式

- 对 `app.js` 和 `background.js` 进行 JavaScript 语法检查
- 验证 Manifest 和两份语言文件均为有效的 UTF-8 JSON
- 运行 `git diff --check`
- 在 Microsoft Edge 中以未打包扩展方式进行人工验证，包括最终的 IP/归属地对齐效果
- 检查 Manifest V3 API 和权限在 Chrome 与 Edge 中的兼容性

---

## 使用编程助手安装

将下面的仓库地址发送给 Claude Code、Codex 等编程助手，并告诉它“安装这个扩展”：

```text
https://github.com/zjwww/tab-out
```

编程助手会引导你完成安装，通常只需要约一分钟。

---

## 功能特性

- **一览所有标签页**：在整洁的网格中按域名分组显示
- **主页分组**：将 Gmail 收件箱、X 首页、YouTube、LinkedIn、GitHub 等主页集中到一张卡片
- **快捷关闭**：通过音效和纸屑动画关闭单个标签页或整个分组
- **重复检测**：标记重复打开的页面，并支持一键清理
- **跨窗口跳转**：点击标题即可切换到对应标签页，不会重复打开页面
- **稍后查看**：关闭前将标签页保存到待办清单
- **本地开发分组**：显示 localhost 端口号，方便区分不同项目
- **可展开分组**：默认展示前 8 个标签页，其余内容可一键展开
- **自动深色模式**：跟随操作系统，也可手动选择浅色或深色
- **中英文界面**：支持英语和简体中文并保存选择
- **公网 IP 与归属地**：显示接口返回的公网 IP 和原始归属地信息
- **Chrome 与 Edge 兼容**：基于 Chromium Manifest V3
- **本地保存**：界面偏好和稍后查看内容保存在 `chrome.storage.local`
- **纯浏览器扩展**：无需服务器、Node.js、npm 或额外构建步骤

---

## 手动安装

### 1. 克隆仓库

```bash
git clone https://github.com/zjwww/tab-out.git
```

### 2. 加载扩展

1. 在 Chrome 中打开 `chrome://extensions`，或在 Edge 中打开 `edge://extensions`
2. 打开页面右上角的“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择克隆仓库内的 `extension/` 文件夹

### 3. 打开新标签页

打开一个新标签页即可看到 Tab Out。

---

## 工作原理

```text
打开新标签页
  → Tab Out 按域名显示所有已打开的标签页
  → Gmail、X、YouTube 等网站主页优先归入“主页”分组
  → 点击标题可直接跳转到对应标签页
  → 关闭不再需要的标签页或整个分组
  → 重要标签页可以先保存到“稍后查看”
```

所有主要功能都在扩展内部运行。保存的标签页和界面偏好存储在 `chrome.storage.local`。每次打开新标签页时，公网 IP 组件会直接请求一次 `https://myip.ipip.net/`，但不会持久保存返回内容。

---

## 技术栈

| 项目 | 实现方式 |
|---|---|
| 扩展平台 | Chromium Manifest V3 |
| 本地存储 | `chrome.storage.local` |
| 音效 | Web Audio API 动态合成，无音频文件 |
| 动画 | CSS 过渡与 JavaScript 纸屑动画 |

---

## 许可证

MIT

---

原项目由 [Zara](https://x.com/zarazhangrui) 创建。本 Fork 在保留原项目署名和许可证的基础上增加上述功能。
