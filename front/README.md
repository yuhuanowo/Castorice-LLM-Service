# AI 聊天网站前端

这是一个基于 Next.js 构建的 AI 聊天网站前端，与 FastAPI 后端集成。

## 技术栈

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui 组件
- Radix UI

## 功能

- AI 模型聊天界面
- 多模型支持 (通过后端 API)
- 聊天历史
- 响应式设计

## 安装和启动

1. 确保已安装 Node.js (版本 18.0.0 或更高)

2. 安装依赖：

```bash
cd front
npm install
```

3. 配置环境变量：

编辑 `.env.local` 文件，确保设置了以下环境变量：

```
API_BASE_URL=http://localhost:8000
```

4. 启动开发服务器：

```bash
npm run dev
```

然后访问 http://localhost:3000 查看应用。

## 与后端 API 集成

本前端应用设计为与 FastAPI 后端 API 集成。它通过 `/api/chat` 端点与后端通信，该端点代理请求到 FastAPI 服务器的 `/chat/completions` 端点。

确保后端 API 服务器正在运行，并且 `API_BASE_URL` 环境变量正确指向后端服务器地址。

## 构建生产版本

要构建生产版本，运行：

```bash
npm run build
```

然后可以使用以下命令启动生产服务器：

```bash
npm run start
```

## 项目结构

- `/app` - Next.js App Router 页面和路由
- `/components` - React 组件
- `/lib` - 工具函数和共享代码
- `/public` - 静态资源
