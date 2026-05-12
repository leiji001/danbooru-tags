# Danbooru Tags

基于 Cloudflare Workers 的 Danbooru 标签翻译与改写服务，使用 Gemini API 将中文描述转换为 Danbooru 标签格式。

## 功能

- **标签翻译** (`/api/translate`)：将中文自然语言描述翻译为英文 Danbooru 标签
- **标签改写** (`/api/rewrite`)：根据中文修改请求调整已有的 Danbooru 标签
- **流式响应** (`/api/stream`)：支持 SSE 流式输出，实时查看生成进度

## 技术栈

- Cloudflare Workers
- Gemini API (gemma-4-31b-it)

## 本地开发

```bash
pnpm install
pnpm dev
```

## 部署

```bash
pnpm deploy
```

## 参考项目

本项目参考了 [natureDrawImage](https://github.com/afoim/natureDrawImage) 的设计思路与标签词汇表。

## License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html)
