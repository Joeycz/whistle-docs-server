# whistle-docs-server MCP Server

Whistle文档MCP服务器，提供Whistle文档的搜索和访问功能。

这是一个基于TypeScript的MCP服务器，提供了Whistle文档的访问功能，包括：

- 列出Whistle文档的主要章节作为资源
- 提供搜索Whistle文档的工具
- 提供获取Whistle特定功能说明的工具

## 功能

### 资源
- 通过`whistle:///`URI访问Whistle文档的各个章节
- 每个文档都有标题和内容
- 纯文本MIME类型，便于访问内容

### 工具
- `search_whistle_docs` - 搜索Whistle文档
  - 接受查询关键词作为参数
  - 返回搜索结果
- `get_whistle_feature` - 获取Whistle特定功能的说明
  - 接受功能名称作为参数
  - 返回该功能的详细说明
- `refresh_whistle_docs` - 刷新Whistle文档缓存

## Development

Install dependencies:
```bash
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

## 安装

### 通过npm全局安装

```bash
npm install -g whistle-docs-server
```

安装后，运行配置命令：

```bash
whistle-docs-setup
```

### 通过npx配置（无需全局安装）

```bash
npx whistle-docs-setup
```

这将自动配置Claude Desktop使用whistle-docs-server。

### 手动配置

如果您已经安装了whistle-docs-server，可以手动配置Claude Desktop：

在MacOS上: `~/Library/Application Support/Claude/claude_desktop_config.json`
在Windows上: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "whistle-docs-server": "whistle-docs-server": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "whistle-docs-server"
      ],
      "autoStart": true,
      "alwaysAllow": [
        "get_whistle_feature",
        "search_whistle_docs",
        "access_mcp_resource"
      ]
    }
  }
}
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.
