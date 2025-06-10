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

本前端应用设计为与 FastAPI 后端 API 集成。它使用 Next.js 的 API 代理功能，通过以下路径访问后端：

- `/api/backend/*` - 代理到后端的 `/api/v1/*` 端点
- `/api/agent/*` - 代理到后端的 `/api/v1/agent/*` 端点  
- `/api/health` - 代理到后端的 `/health` 端点

### 配置说明

#### 开发环境
在 `.env.local` 文件中配置：
```
API_BASE_URL=http://localhost:8000
```

#### 生产环境配置

**方案1：同服务器部署**
如果前端和后端部署在同一台服务器上：
```
API_BASE_URL=
```

**方案2：不同服务器部署**
如果前端和后端分别部署：
```
API_BASE_URL=http://your-backend-server:8000
```

**方案3：使用域名**
```
API_BASE_URL=https://your-backend-domain.com
```

### 代理的优势

1. **跨域问题解决** - 前端和后端使用相同域名，避免CORS问题
2. **网络访问优化** - 其他设备访问前端时，后端API通过前端服务器代理
3. **安全性提升** - 隐藏后端服务器的直接地址
4. **部署灵活性** - 可以轻松更改后端地址而无需重新构建前端

确保后端 API 服务器正在运行，并且 `API_BASE_URL` 环境变量正确配置。

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
