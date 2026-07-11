<div align="center">

# Tab Out

[English](./README.md) &nbsp;·&nbsp;
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome%20Extension-MV3-blue)](https://developer.chrome.com/docs/extensions/mv3/)

</div>

<br>

> **掌控你的标签页。** Tab Out 会替换 Chrome 新标签页，展示一个本地运行的标签页面板，
> 按域名分组，适合快速清理、跳转、保存和搬家。

无需服务器、无需账号、无需外部 API。你的标签页数据只保存在本机。

<br>

## 功能

- **域名分组**：用清爽网格按站点展示已打开标签页。
- **Homepages 分组**：Gmail、X、YouTube、LinkedIn、GitHub 首页会归到一个便于清理的分组。
- **一键清理**：支持关闭单个标签页、全部重复项、某个域名分组或全部打开的标签页。
- **嗖声 + 彩纸**：关闭标签页时有音效和粒子反馈。
- **重复检测**：同一页面打开多次会显示 `(2x)` 标记，并提供专门的去重操作。
- **跨窗口跳转**：点击标签页标题即可定位到对应标签页，即使它在其它 Chrome 窗口。
- **高级标签搬家**：开启后可把单个标签页、某个 Tab Out 分组或全部标签页搬到当前窗口。
- **自定义分组规则**：可按精确主机、主机后缀和可选路径前缀归并标签页。
- **稍后列表**：关闭前可把标签页保存到本地 checklist。
- **导入 / 导出会话**：导出当前分组，也可以导入历史会话文件。
- **导入 / 导出分组规则**：可在浏览器之间迁移规则，或保存一份本地备份。
- **全局搜索**：一个搜索框覆盖打开的标签页、导入会话和稍后列表。
- **浅色 / 深色 / 跟随系统主题**：可在 More 菜单中切换。
- **英文 / 中文界面**：可在 More 菜单中切换语言，默认英文。
- **稳定的站点图标**：优先使用真实标签页 favicon，失败后回退到 Chrome `_favicon` 和本地占位图。
- **100% 本地**：保存的标签页、导入会话、分组规则、设置、语言、主题和高级开关都存储在 `chrome.storage.local`。

<br>

## 工作方式

```text
打开一个新标签页
  -> Tab Out 按域名分组展示所有已打开标签页
  -> Homepages（Gmail、X 等）出现在独立分组中
  -> 点击标签页标题可跨窗口跳转
  -> 在 More 菜单中切换主题、语言、自动刷新、标签搬家和分组规则
  -> 按精确主机、主机后缀或路径前缀添加自定义分组规则
  -> 开启高级标签搬家后，可把标签页搬到当前窗口
  -> 关闭前可保存到稍后列表
  -> 需要快照时可导出或导入标签会话和分组规则
```

所有逻辑都在 Chrome 扩展内部运行。不需要服务器，也不需要构建步骤。

<br>

## 手动安装

**1. 克隆仓库**

```bash
git clone https://github.com/mrfoolish/tab-out.git
```

**2. 加载到 Chrome**

| 步骤 | 操作 |
|------|------|
| 1 | 打开 `chrome://extensions` |
| 2 | 打开右上角 **开发者模式** |
| 3 | 点击 **加载已解压的扩展程序** |
| 4 | 选择本仓库中的 `extension/` 文件夹 |

**3. 打开新标签页**

Tab Out 会替换 Chrome 默认新标签页。

<br>

## 使用 AI 编程助手安装

将本仓库地址发给 AI 编程助手：

```text
https://github.com/mrfoolish/tab-out
```

说 **"install this"**，它可以在约 1 分钟内引导你完成加载扩展。

<br>

## 技术栈

| 项目 | 实现 |
|------|------|
| 扩展 | Chrome Manifest V3 |
| 存储 | `chrome.storage.local` |
| 标签页 | `chrome.tabs` |
| 图标 | 标签页 favicon、Chrome `_favicon` endpoint、本地占位图 |
| 音效 | Web Audio API |
| UI | HTML、CSS、原生 JavaScript |

<br>

## 许可证

MIT。本 fork 由 [mrfoolish/tab-out](https://github.com/mrfoolish/tab-out) 维护。原始项目作者为 [Zara](https://x.com/zarazhangrui)。
