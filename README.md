# Stream Panel

[English](#english) | [中文](#中文)

---

## English

### Overview

**Stream Panel** is a Chrome DevTools extension that allows developers to monitor and inspect streaming requests in real-time. It supports both **Server-Sent Events (SSE)** and **Fetch-based Stream** connections, making it an essential tool for debugging streaming APIs and viewing real-time data pushes.

### Features

- 🔍 **Real-time Monitoring**: Intercept and display all EventSource and Fetch-based SSE connections
- 📊 **Message Inspection**: View detailed message data with JSON syntax highlighting
- 🔗 **Connection Management**: Track multiple streaming connections simultaneously
- 🎯 **URL Filtering**: Filter connections by URL to focus on specific endpoints
- 🔎 **Message Filtering**: Filter messages by JSON field values (equals/contains)
- 🖼️ **Iframe Support**: Monitor streaming connections in both main page and iframes
- 🌓 **Dark Mode**: Automatic dark mode support based on system preferences

### Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the extension directory
5. The extension is now installed and ready to use

### Usage

1. Open Chrome DevTools (F12 or Right-click → Inspect)
2. Navigate to the **Stream Panel** tab
3. The panel will automatically capture all streaming connections from the current page
4. Select a connection from the left panel to view its messages
5. Click on any message to view its detailed JSON content
6. Use the URL filter in the toolbar to filter connections
7. Use message filters to filter messages by JSON field values

### How It Works

The extension consists of four main components:

1. **inject.js**: Injected into web pages to intercept `EventSource` and `fetch` API calls
2. **content.js**: Acts as a message bridge between the injected script and the background script
3. **background.js**: Manages data storage and communication between content scripts and DevTools panels
4. **devtools/panel**: The UI panel displayed in Chrome DevTools

### Technical Architecture

```
Web Page
  └── inject.js (intercepts EventSource/fetch)
      └── content.js (message bridge)
          └── background.js (data storage)
              └── devtools/panel (UI display)
```

### Message Filtering

The extension supports filtering messages by JSON field values:

- **Field Selection**: Automatically extracts all available fields from message data
- **Match Modes**:
  - **Equals**: Exact match (field value === filter value)
  - **Contains**: Partial match (field value includes filter value)
- **Multiple Filters**: Supports multiple filter conditions with AND logic
- **Nested Fields**: Supports nested JSON fields using dot notation (e.g., `user.profile.name`)

### Development

#### Project Structure

```
StreamPanel/
├── manifest.json          # Extension manifest
├── background.js          # Background service worker
├── content.js             # Content script
├── inject.js              # Injection script
├── devtools/
│   ├── devtools.html      # DevTools page
│   ├── devtools.js        # DevTools initialization
│   ├── panel.html         # Panel UI
│   ├── panel.js           # Panel logic
│   └── panel.css          # Panel styles
└── icons/                 # Extension icons
```

### Roadmap

- [ ] Export data functionality (JSON/CSV)
- [ ] Advanced message search
- [ ] Performance optimization for large message volumes
- [ ] WebSocket monitoring support
- [ ] Message replay functionality
- [ ] Custom filter presets
- [ ] Connection statistics and analytics

### Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

For detailed instructions on how to submit a PR, see [docs/PR_GUIDE.md](docs/PR_GUIDE.md).

### License

[Add license information here]

---

## 中文

### 简介

**Stream Panel** 是一个 Chrome DevTools 扩展，允许开发者实时监控和检查流式请求。它支持 **服务器发送事件 (SSE)** 和 **基于 Fetch 的流式连接**，是调试流式 API 和查看实时数据推送的必备工具。

### 功能特性

- 🔍 **实时监控**：拦截并显示所有 EventSource 和基于 Fetch 的 SSE 连接
- 📊 **消息检查**：查看详细的消息数据，支持 JSON 语法高亮
- 🔗 **连接管理**：同时跟踪多个流式连接
- 🎯 **URL 过滤**：按 URL 过滤连接，专注于特定端点
- 🔎 **消息筛选**：根据 JSON 字段值筛选消息（全等/包含）
- 🖼️ **Iframe 支持**：监控主页面和 iframe 中的流式连接
- 🌓 **深色模式**：根据系统偏好自动支持深色模式

### 安装方法

1. 克隆或下载此仓库
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`
3. 启用**开发者模式**（右上角的开关）
4. 点击**加载已解压的扩展程序**，选择扩展目录
5. 扩展已安装，可以使用了

### 使用方法

1. 打开 Chrome DevTools（F12 或右键 → 检查）
2. 导航到 **Stream Panel** 标签页
3. 面板会自动捕获当前页面的所有流式连接
4. 从左侧面板选择一个连接以查看其消息
5. 点击任何消息以查看其详细的 JSON 内容
6. 使用工具栏中的 URL 过滤器来过滤连接
7. 使用消息筛选器根据 JSON 字段值筛选消息

### 工作原理

扩展由四个主要组件组成：

1. **inject.js**：注入到网页中以拦截 `EventSource` 和 `fetch` API 调用
2. **content.js**：作为注入脚本和后台脚本之间的消息桥梁
3. **background.js**：管理数据存储以及内容脚本和 DevTools 面板之间的通信
4. **devtools/panel**：在 Chrome DevTools 中显示的 UI 面板

### 技术架构

```
网页
  └── inject.js (拦截 EventSource/fetch)
      └── content.js (消息桥梁)
          └── background.js (数据存储)
              └── devtools/panel (UI 显示)
```

### 消息筛选

扩展支持根据 JSON 字段值筛选消息：

- **字段选择**：自动从消息数据中提取所有可用字段
- **匹配模式**：
  - **全等**：精确匹配（字段值 === 筛选值）
  - **包含**：部分匹配（字段值包含筛选值）
- **多条件筛选**：支持多个筛选条件，使用 AND 逻辑
- **嵌套字段**：支持使用点号表示法访问嵌套 JSON 字段（例如：`user.profile.name`）

### 开发

#### 项目结构

```
StreamPanel/
├── manifest.json          # 扩展清单
├── background.js          # 后台服务工作者
├── content.js             # 内容脚本
├── inject.js              # 注入脚本
├── devtools/
│   ├── devtools.html      # DevTools 页面
│   ├── devtools.js        # DevTools 初始化
│   ├── panel.html         # 面板 UI
│   ├── panel.js           # 面板逻辑
│   └── panel.css          # 面板样式
└── icons/                 # 扩展图标
```

### 后续计划

- [ ] 导出数据功能（JSON/CSV）
- [ ] 高级消息搜索
- [ ] 大量消息场景的性能优化
- [ ] WebSocket 监控支持
- [ ] 消息重放功能
- [ ] 自定义筛选预设
- [ ] 连接统计和分析

### 贡献

欢迎贡献！请随时提交 Pull Request。

有关如何提交 PR 的详细说明，请参阅 [docs/PR_GUIDE.md](docs/PR_GUIDE.md)。

### 许可证

[在此添加许可证信息]

