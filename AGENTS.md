# AI Agent 开发规则

## 核心原则
- **效率至上**：快速单元式开发
- **不写文档**：只写代码，不创建 README、GUIDE 等文档文件
- **改完即退**：完成代码修改后立即退出，用户会手动测试
- **单元提交**：每个功能/修改单独提交到 Git
- **闭嘴**：非用户要求不输出任何内容，静默更改代码完毕后直接退出

## 工作流程
1. 理解需求
2. 编写/修改代码
3. 创建 Git 提交
4. 退出（不等待测试结果）

## 提交规范
- `feat:` - 新功能
- `fix:` - 修复 bug
- `refactor:` - 代码重构
- `style:` - 样式调整
- `perf:` - 性能优化
- `chore:` - 构建/工具/配置更新

# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
