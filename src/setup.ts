#!/usr/bin/env node

/**
 * whistle-docs-server 配置脚本
 * 
 * 这个脚本用于自动配置Claude Desktop使用whistle-docs-server
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 获取Claude Desktop配置文件路径
function getConfigPath(): string {
  const homedir = os.homedir();
  
  if (process.platform === 'darwin') {
    // macOS
    return path.join(homedir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (process.platform === 'win32') {
    // Windows
    return path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
  } else {
    // Linux或其他平台
    console.log('不支持的平台，请手动配置Claude Desktop');
    process.exit(1);
    return ''; // 为了TypeScript类型检查
  }
}

// 主函数
async function main() {
  console.log('配置whistle-docs-server MCP服务器...');
  
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  
  // 确保配置目录存在
  if (!fs.existsSync(configDir)) {
    console.log(`创建配置目录: ${configDir}`);
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  // 读取现有配置（如果有）
  let config: any = { mcpServers: {} };
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
      if (!config.mcpServers) {
        config.mcpServers = {};
      }
    } catch (error) {
      console.error('读取配置文件失败，将创建新配置', error);
    }
  }
  
  // 添加whistle-docs-server配置，使用npx命令
  config.mcpServers['whistle-docs-server'] = {
    type: "stdio",
    command: "npx whistle-docs-server",
    autoStart: true,
    alwaysAllow: [
      "get_whistle_feature",
      "search_whistle_docs",
      "access_mcp_resource"
    ]
  };
  
  // 写入配置文件
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  
  console.log(`whistle-docs-server已成功配置到: ${configPath}`);
  console.log('现在您可以在Claude Desktop中使用whistle-docs-server了！');
}

main().catch(error => {
  console.error('配置失败:', error);
  process.exit(1);
});