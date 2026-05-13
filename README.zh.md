<div align="center">

# Tab Out

[English](./README.md) &nbsp;·&nbsp;
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome%20Extension-MV3-blue)](https://developer.chrome.com/docs/extensions/mv3/)

</div>

<br>

> **掌控你的标签页。** 一个清爽的标签管理面板，按域名分组、一键清理。
> 无需服务器、无需账号、数据不外发。

<br>

## ✨ 功能

- 🗂 **域名分组** — 所有标签页按域名归类，清晰网格布局
- 🏠 **Homepages 卡片** — Gmail、X、YouTube、LinkedIn、GitHub 首页归入同一组
- 🧹 **一键清理** — 点击一下，关闭整个域名分组
- ✨ **嗖声 + 彩纸** — 关闭标签页伴有清脆音效和彩色粒子特效
- ⚡ **重复检测** — 同一页面打开多次显示 (2x) 标记，一键去重
- 🎯 **点击跳转** — 点击任意标签页标题，跨窗口直接跳转
- 📌 **稍后查看** — 关闭前保存到右侧便签清单，逐个处理
- 🔢 **端口识别** — localhost 标签显示端口号，轻松区分本地项目
- 📋 **折叠展开** — 每组展示前 8 个，点击「+N more」展开全部
- 🪟 **独立标签页** — 点击扩展图标打开，不劫持新标签页
- 🔒 **100% 本地** — 浏览数据从未离开你的设备

<br>

## 🧭 工作原理

```
点击 Tab Out 图标
  ├─ 在独立标签页中打开面板
  ├─ 按域名分组展示所有已打开标签
  ├─ Homepages（Gmail、X 等）位于顶部独立分组
  ├─ 点击标签页标题 → 跳转（跨窗口）
  ├─ 关闭已完成分组 → 嗖声 + 彩纸
  └─ 关闭前可保存到「稍后查看」清单

再次点击图标 → 聚焦已有面板，不重复打开。
```

全部逻辑在扩展内部运行。已保存的标签存储在 `chrome.storage.local` 中。

<br>

## 📦 手动安装

**1. 克隆仓库**

```bash
git clone https://github.com/zarazhangrui/tab-out.git
```

**2. 加载到 Chrome**

| 步骤 | 操作 |
|------|------|
| ① | 打开 `chrome://extensions` |
| ② | 右上角打开 **开发者模式** |
| ③ | 点击 **加载已解压的扩展程序** |
| ④ | 选择仓库中的 `extension/` 文件夹 |

**3. 固定图标**

点击工具栏上的 Tab Out 图标打开面板。右键 → **图钉固定** 方便日常使用。

<br>

## 🤖 AI 编程助手一键安装

将本仓库地址发给 AI 编程助手：

```
https://github.com/zarazhangrui/tab-out
```

说一句 **"install this"**，约 1 分钟即可完成安装。

<br>

## 📄 许可证

MIT · 作者 [Zara](https://x.com/zarazhangrui)
