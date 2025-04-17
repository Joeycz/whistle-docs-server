#!/usr/bin/env node

// 添加 ReadableStream polyfill
import 'web-streams-polyfill';

/**
 * 检查 Node.js 版本
 */
const currentNodeVersion = process.versions.node;
const semver = currentNodeVersion.split('.');
const major = parseInt(semver[0], 10);

// 需要 Node.js v16 或更高版本才能支持 ReadableStream
if (major < 16) {
  console.log(
    '您正在使用的 Node.js 版本 ' +
    currentNodeVersion +
    ' 过低。\n' +
    'whistle-docs-server 需要 Node.js 16.0.0 或更高版本。\n' +
    '请升级您的 Node.js 版本。'
  );
  process.exit(1);
}

/**
 * Whistle 文档 MCP server
 *
 * 这个 MCP server 提供了 whistle 文档的访问功能，包括：
 * - 列出 whistle 文档的主要章节作为资源
 * - 提供搜索 whistle 文档的工具
 * - 提供获取 whistle 特定功能说明的工具
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import * as cheerio from "cheerio";
import { URL } from "url";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Whistle 文档章节类型
 */
type DocSection = {
  id: string;
  title: string;
  content: string;
  url: string;
};

/**
 * Whistle 文档搜索结果类型
 */
type SearchResult = {
  sectionId: string;
  sectionTitle: string;
  matchedContent: string;
  url: string;
};

/**
 * Whistle 文档缓存
 */
class WhistleDocsCache {
  private sections: Map<string, DocSection> = new Map();
  private lastFetchTime: number = 0;
  private readonly CACHE_TTL = 3600000; // 1小时缓存过期时间
  private readonly BASE_URL = "https://wproxy.org/whistle/";
  private readonly CACHE_DIR = path.join(os.tmpdir(), "whistle-docs-cache");
  private isInitialized = false;

  constructor() {
    // 创建缓存目录
    if (!fs.existsSync(this.CACHE_DIR)) {
      fs.mkdirSync(this.CACHE_DIR, { recursive: true });
    }
  }

  /**
   * 使用 curl 命令获取网页内容
   */
  private fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      console.log(`Fetching URL: ${url}`);
      
      exec(`curl -s "${url}"`, (error, stdout, stderr) => {
        if (error) {
          console.log(`Error fetching ${url}:`, error);
          reject(error);
          return;
        }
        
        if (stderr) {
          console.log(`Stderr when fetching ${url}:`, stderr);
        }
        
        console.log(`Successfully fetched ${url} (${stdout.length} bytes)`);
        resolve(stdout);
      });
    });
  }

  /**
   * 从缓存中获取文档内容
   */
  private getCachedContent(id: string): DocSection | null {
    const cachePath = path.join(this.CACHE_DIR, `${id}.json`);
    
    if (fs.existsSync(cachePath)) {
      try {
        const cacheData = fs.readFileSync(cachePath, 'utf8');
        const section = JSON.parse(cacheData) as DocSection;
        this.sections.set(section.id, section);
        return section;
      } catch (error) {
        console.log(`Error reading cache for ${id}:`, error);
      }
    }
    
    return null;
  }

  /**
   * 将文档内容保存到缓存
   */
  private saveCachedContent(section: DocSection): void {
    const cachePath = path.join(this.CACHE_DIR, `${section.id}.json`);
    
    try {
      fs.writeFileSync(cachePath, JSON.stringify(section), 'utf8');
    } catch (error) {
      console.log(`Error saving cache for ${section.id}:`, error);
    }
  }

  /**
   * 初始化文档缓存
   */
  async initialize(): Promise<void> {
    if (this.isInitialized && Date.now() - this.lastFetchTime < this.CACHE_TTL) {
      return;
    }

    try {
      // 获取主页内容
      const htmlContent = await this.fetchUrl(this.BASE_URL);
      const $ = cheerio.load(htmlContent);
      
      // 解析侧边栏菜单获取所有文档章节
      const sections: DocSection[] = [];
      
      // 尝试不同的选择器来获取菜单项
      const selectors = [
        ".sidebar-nav ul li a",
        ".sidebar ul li a",
        "nav ul li a",
        "#sidebar a",
        ".menu a"
      ];
      
      let foundLinks = false;
      
      for (const selector of selectors) {
        console.log(`Trying selector: ${selector}`);
        const links = $(selector);
        console.log(`Found ${links.length} links with selector ${selector}`);
        
        if (links.length > 0) {
          foundLinks = true;
          
          links.each((_, element) => {
            const $el = $(element);
            const href = $el.attr("href");
            const title = $el.text().trim();
            
            console.log(`Found link: ${title} -> ${href}`);
            
            // 只处理有效的链接
            if (href && !href.startsWith("http") && !href.includes("#")) {
              const id = href.replace(/^\/whistle\//, "").replace(/\.html$/, "") || "index";
              sections.push({
                id,
                title: title || id,
                content: "", // 稍后填充
                url: new URL(href, this.BASE_URL).toString()
              });
            }
          });
          
          // 如果找到了链接，就不再尝试其他选择器
          break;
        }
      }
      
      // 如果没有找到任何链接，添加一个默认的首页文档
      if (!foundLinks || sections.length === 0) {
        console.log("No links found with any selector, adding default index page");
        sections.push({
          id: "index",
          title: "Whistle 文档首页",
          content: "", // 稍后填充
          url: this.BASE_URL
        });
      }
      
      // 获取每个章节的内容
      for (const section of sections) {
        try {
          // 先尝试从缓存获取
          const cachedSection = this.getCachedContent(section.id);
          
          if (cachedSection) {
            console.log(`Using cached content for ${section.id}`);
            section.content = cachedSection.content;
          } else {
            // 如果缓存中没有，则从网络获取
            const sectionHtml = await this.fetchUrl(section.url);
            const $section = cheerio.load(sectionHtml);
            
            // 尝试不同的选择器来提取主要内容
            const contentSelectors = ["#main", ".content", "article", ".markdown-body", "body"];
            let content = "";
            
            for (const selector of contentSelectors) {
              const contentElement = $section(selector);
              if (contentElement.length > 0) {
                content = contentElement.text().trim();
                console.log(`Found content with selector ${selector} (${content.length} chars)`);
                break;
              }
            }
            
            // 如果没有找到内容，使用整个页面内容
            if (!content) {
              content = $section("body").text().trim();
              console.log(`Using body content (${content.length} chars)`);
            }
            
            section.content = content;
            
            // 保存到缓存
            this.saveCachedContent(section);
          }
          
          // 存储到内存缓存
          this.sections.set(section.id, section);
        } catch (error) {
          console.log(`Error fetching section ${section.id}:`, error);
        }
      }
      
      this.lastFetchTime = Date.now();
      this.isInitialized = true;
      console.log(`Initialized Whistle docs cache with ${this.sections.size} sections`);
    } catch (error) {
      console.log("Error initializing Whistle docs cache:", error);
      throw new Error("Failed to initialize Whistle docs cache");
    }
  }

  /**
   * 获取所有文档章节
   */
  async getAllSections(): Promise<DocSection[]> {
    await this.initialize();
    return Array.from(this.sections.values());
  }

  /**
   * 获取指定章节
   */
  async getSection(id: string): Promise<DocSection | undefined> {
    await this.initialize();
    return this.sections.get(id);
  }

  /**
   * 搜索文档
   */
  async search(query: string): Promise<SearchResult[]> {
    await this.initialize();
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    
    for (const section of this.sections.values()) {
      if (
        section.title.toLowerCase().includes(lowerQuery) ||
        section.content.toLowerCase().includes(lowerQuery)
      ) {
        // 提取匹配内容的上下文
        const contentLower = section.content.toLowerCase();
        const index = contentLower.indexOf(lowerQuery);
        
        let matchedContent = "";
        if (index !== -1) {
          // 提取匹配位置前后的一些内容作为上下文
          const start = Math.max(0, index - 100);
          const end = Math.min(section.content.length, index + query.length + 100);
          matchedContent = section.content.substring(start, end);
          
          // 如果不是从头开始，添加省略号
          if (start > 0) {
            matchedContent = "..." + matchedContent;
          }
          
          // 如果不是到末尾结束，添加省略号
          if (end < section.content.length) {
            matchedContent = matchedContent + "...";
          }
        } else {
          // 如果是标题匹配，则取内容的前一部分
          matchedContent = section.content.substring(0, 200) + "...";
        }
        
        results.push({
          sectionId: section.id,
          sectionTitle: section.title,
          matchedContent,
          url: section.url
        });
      }
    }
    
    return results;
  }

  /**
   * 刷新文档缓存
   */
  async refreshCache(): Promise<void> {
    console.log("Refreshing Whistle docs cache...");
    this.isInitialized = false;
    this.sections.clear();
    
    // 清除文件缓存
    try {
      const files = fs.readdirSync(this.CACHE_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(this.CACHE_DIR, file));
        }
      }
    } catch (error) {
      console.log("Error clearing cache directory:", error);
    }
    
    // 重新初始化
    await this.initialize();
  }
}

// 创建 Whistle 文档缓存实例
const whistleDocsCache = new WhistleDocsCache();

/**
 * 创建 MCP server 实例
 */
const server = new Server(
  {
    name: "whistle-docs-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

/**
 * 处理列出可用资源的请求
 * 将 whistle 文档的主要章节作为资源列出
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    const sections = await whistleDocsCache.getAllSections();
    
    return {
      resources: sections.map(section => ({
        uri: `whistle:///${section.id}`,
        mimeType: "text/markdown",
        name: section.title,
        description: `Whistle 文档: ${section.title}`
      }))
    };
  } catch (error) {
    console.log("Error listing resources:", error);
    throw new McpError(ErrorCode.InternalError, "Failed to list Whistle documentation sections");
  }
});

/**
 * 处理读取资源内容的请求
 * 读取指定 whistle 文档章节的内容
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  try {
    const url = new URL(request.params.uri);
    const id = url.pathname.replace(/^\//, '');
    
    const section = await whistleDocsCache.getSection(id);
    
    if (!section) {
      throw new McpError(ErrorCode.InvalidRequest, `Whistle documentation section '${id}' not found`);
    }
    
    return {
      contents: [{
        uri: request.params.uri,
        mimeType: "text/markdown",
        text: `# ${section.title}\n\n${section.content}\n\n原文链接: ${section.url}`
      }]
    };
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    console.log("Error reading resource:", error);
    throw new McpError(ErrorCode.InternalError, "Failed to read Whistle documentation section");
  }
});

/**
 * 处理列出可用工具的请求
 * 提供搜索 whistle 文档和获取特定功能说明的工具
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_whistle_docs",
        description: "搜索 Whistle 文档",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "搜索关键词"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_whistle_feature",
        description: "获取 Whistle 特定功能的说明",
        inputSchema: {
          type: "object",
          properties: {
            feature: {
              type: "string",
              description: "功能名称，如 rules, plugins, webui 等"
            }
          },
          required: ["feature"]
        }
      },
      {
        name: "refresh_whistle_docs",
        description: "刷新 Whistle 文档缓存",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      }
    ]
  };
});

/**
 * 处理调用工具的请求
 * 实现搜索 whistle 文档和获取特定功能说明的功能
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "search_whistle_docs": {
        const query = String(request.params.arguments?.query);
        if (!query) {
          throw new McpError(ErrorCode.InvalidParams, "Search query is required");
        }
        
        const results = await whistleDocsCache.search(query);
        
        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: `没有找到与 "${query}" 相关的内容。`
            }]
          };
        }
        
        const formattedResults = results.map((result, index) => 
          `## ${index + 1}. ${result.sectionTitle}\n\n${result.matchedContent}\n\n[查看完整内容](${result.url})\n\n---\n`
        ).join("\n");
        
        return {
          content: [{
            type: "text",
            text: `# Whistle 文档搜索结果: "${query}"\n\n找到 ${results.length} 个相关结果:\n\n${formattedResults}`
          }]
        };
      }
      
      case "get_whistle_feature": {
        const feature = String(request.params.arguments?.feature).toLowerCase();
        if (!feature) {
          throw new McpError(ErrorCode.InvalidParams, "Feature name is required");
        }
        
        // 尝试直接匹配章节 ID
        let section = await whistleDocsCache.getSection(feature);
        
        // 如果没有直接匹配，尝试搜索
        if (!section) {
          const results = await whistleDocsCache.search(feature);
          if (results.length > 0) {
            // 使用最匹配的结果
            section = await whistleDocsCache.getSection(results[0].sectionId);
          }
        }
        
        if (!section) {
          return {
            content: [{
              type: "text",
              text: `没有找到关于 "${feature}" 功能的说明。请尝试使用 search_whistle_docs 工具搜索更多信息。`
            }]
          };
        }
        
        return {
          content: [{
            type: "text",
            text: `# ${section.title}\n\n${section.content}\n\n[查看原文](${section.url})`
          }]
        };
      }
      
      case "refresh_whistle_docs": {
        await whistleDocsCache.refreshCache();
        
        return {
          content: [{
            type: "text",
            text: "Whistle 文档缓存已刷新，现在包含最新的文档内容。"
          }]
        };
      }
      
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    console.log("Error calling tool:", error);
    throw new McpError(ErrorCode.InternalError, "Failed to execute tool");
  }
});

/**
 * 启动服务器
 */
async function main() {
  try {
    // 初始化 Whistle 文档缓存
    console.log("Initializing Whistle docs cache...");
    await whistleDocsCache.initialize();
    
    // 启动服务器
    console.log("Starting Whistle docs MCP server...");
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log("Whistle docs MCP server is running");
  } catch (error) {
    console.log("Failed to start server:", error);
    process.exit(1);
  }
}

// 处理错误和退出信号
process.on("uncaughtException", (error) => {
  console.log("Uncaught exception:", error);
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down...");
  process.exit(0);
});

// 启动服务器
main().catch((error) => {
  console.log("Server error:", error);
  process.exit(1);
});
