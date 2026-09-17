# 智能文档问答系统 · RAG + MCP

使用 React、Ant Design 和 Express 构建的 PDF 问答项目。文档答案来自 LangChain RAG，网页答案来自通过 stdio MCP 调用的 SerpAPI。支持文字提问，以及浏览器提供的语音识别和答案播报。

## 功能与数据流

1. 上传一份含可提取文本的 PDF。后端检查文件类型、内容、大小和页数，解析并分块，返回独立文档编号。
2. 浏览器在每个请求中附带临时会话标识和文档编号。后端只允许当前会话访问自己的文档。
3. 第一次提问时通过 OpenAI 生成嵌入并建立内存向量索引。后续问题复用该索引，并发的首次提问也共享一次索引构建；失败的构建可以重试。
4. 从文档中检索最多 4 个文本块，生成文档答案；通过可复用的 MCP 客户端检索网页并生成第二份答案。
5. 语音识别结果每轮仅提交一次，退出语音模式或切换文档后不会自动恢复旧的录音任务。

## 本地运行

需要 Node.js 22 或更新版本、npm，以及有相应模型权限的 OpenAI API key 和 SerpAPI key。

```sh
npm ci
npm ci --prefix server --legacy-peer-deps
cp server/.env.example server/.env
cp .env.example .env
```

在 `server/.env` 填入自己的 API key。默认模型为 `gpt-5`，可以通过 `OPENAI_MODEL` 改为账户有权限使用的模型。

```sh
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)，上传 PDF 后提问。后端默认监听 127.0.0.1:5001。修改后端端口时，同步设置前端 `REACT_APP_API_URL`；修改前端地址时，同步设置后端 `FRONTEND_ORIGIN`。前端环境变量修改后需要重启开发服务器或重新构建。

Chat Mode 中点击录音开始说话，识别结束后自动提交；文档答案播报完成后继续录音。关闭 Chat Mode 会停止识别和播报。语音能力取决于浏览器、音色和麦克风权限，建议使用支持 Web Speech API 的浏览器。没有语音支持时仍可使用文字输入。

## 接口

所有文档接口需要 `X-Session-Id` 请求头（随机 UUID，由前端生成并保存在 sessionStorage）。文档编号同样为随机 UUID。

| 请求 | 输入 | 成功结果 |
| --- | --- | --- |
| GET /health | 无 | 服务状态 |
| POST /upload | multipart 的单个 file 字段 | 201，documentId、name、pages、chunks |
| GET /chat | question、documentId 查询参数 | ragAnswer、mcpAnswer |
| DELETE /documents/:id | 所属会话中的文档编号 | 204 |

错误用 JSON 的 `error` 字段返回。无文件/非法问题返回 400，缺少会话返回 401，文档不属于会话或已过期返回 404，超限返回 413，非 PDF 返回 415，损坏或无可提取文本的 PDF 返回 422。上游服务失败返回不包含密钥或响应详情的 502。

搜索工具仅接受去除首尾空白后长度为 1–2000 的 query，以及 1–10 的整数 num。返回内容会截断到请求数量。

## 存储与适用范围

- 每份文件最多 10 MB、200 页和 100 万个提取字符；暂不提供扫描件 OCR。
- 文档文本和索引只保存在当前后端进程内存中，文件原始字节不落盘。重启后需要重新上传。
- 文档闲置 1 小时后失效；每个会话最多保留 5 份文档，整个进程最多 50 份。界面替换文档时会删除旧文档，定时清理过期缓存。
- 会话标识是用于本地演示的随机访问凭据，不是账户登录系统。共享会话标识等同于共享访问权限。部署为公网、多实例或长期使用的服务前，还需要正式认证、HTTPS、限流和共享存储。
- API 问答会将文档文本发送到 OpenAI，将问题发送到 SerpAPI 和 OpenAI。仅上传自己有权使用并允许外发的内容，真实调用会消耗服务额度。
- 上传不会调用 AI；首次问答构建索引。两路答案当前顺序执行。

## 测试

```sh
npm run test:ci
npm run test:server
CI=true npm run build
```

默认测试不需要 API key，也不发送网络请求到模型或搜索服务。后端用原创的微型 PDF 夹具验证真实解析、HTTP、会话隔离、索引缓存和 MCP；仅外部模型/搜索服务使用替身。前端测试覆盖上传、文字交互、语音重复提交、相同问题的下一轮录音、退出模式和请求取消等。

可选的真实服务检查只发送代码生成的无敏感内容测试 PDF，不读取任何本地用户文档：

```sh
ALLOW_LIVE_API_TESTS=1 npm run test:live --prefix server
```

此命令需要有效密钥并产生少量 API 费用。测试方法和修复范围见 [docs/verification.md](docs/verification.md)。GitHub Actions 会在 push 和 pull request 时运行不需要密钥的测试及构建；最新结果见 [Tests and build](https://github.com/ZLI2038/rag-mcp-pdf-qa/actions/workflows/ci.yml)。

## 上传 GitHub

仓库已忽略所有层级的 node_modules、实际环境变量文件、上传目录、构建产物和本地历史测量记录。`.env.example` 只保留占位符，应该提交；不要提交真实密钥、个人简历 PDF 或使用 `git add -f` 强制加入被忽略的文件。

源码保留了项目起步时的课程实践背景，并在此基础上补充了输入校验、会话隔离、索引复用和回归测试。默认测试不依赖原有私人 PDF 或本机绝对路径。
