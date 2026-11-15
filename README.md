# 墨读

TypeScript 实现的私人 TXT 小说阅读器，使用 Node.js 在服务端保存书籍，无新增运行时依赖。

## 运行

需要 Node.js 20.19+ 或 22.12+（与 Vite 7 一致）。

```sh
npm ci
npm run dev
```

开发服务器同时提供书籍 API。需要局域网访问时：

```sh
npm run dev -- --host 0.0.0.0
```

正式运行：

```sh
npm run build
npm start
```

默认地址为 `http://127.0.0.1:5174`，可通过 `HOST` 和 `PORT` 修改：

```sh
HOST=0.0.0.0 PORT=3000 npm start
```

`npm start` 同时提供 `dist` 静态页面与 `/api/books` 接口。使用 Nginx 时，可将全部请求反向代理到这个服务。此版本需要 Node.js 后端，仅部署 `dist` 静态文件无法导入、读取或导出书籍。`npm run preview` 也支持书籍接口，供本地预览。

不想装依赖时，可只把 `dist`、`server`、`server.mjs` 三个文件（目录）拷到目标机器，直接 `node server.mjs`：运行时只用 Node 内置模块，不需要 `node_modules` 或 `package.json`。

也可以直接从 Git 仓库运行，`prepare` 脚本会在安装时自动构建 `dist`：

```sh
npx --yes git+https://gitee.com/MangaQQQ/bqread.git
# 或 GitHub 简写
npx --yes github:<用户名>/<仓库>
```

这种方式需要目标机器有 git、Node 20.19+，首次会安装构建依赖并编译，比拷贝 `dist` 慢。

## 功能与存储

- TXT 文件选择、拖放导入，或直接粘贴小说文本
- UTF-8 和 GB18030 自动识别，文件最大 10 MB
- 自动识别常见中文章节标题，支持目录跳转与键盘左右键翻章
- 三种阅读主题与三档字号
- 搜索书籍、按阅读状态筛选、移除书籍
- 封面右上角提供导出按钮，将上传书籍下载为 UTF-8 TXT（包含正文与章节标题）
- 三本原创短篇样例可直接阅读

上传的书籍保存为 **运行服务的系统用户**主目录下的 `~/.bqread/books/<书籍 ID>.json`，包含书名、作者、正文和章节。书架在同一服务的浏览器和设备之间共享；本项目没有账号隔离，部署范围应为可信的私人环境。删除书籍会删除对应的服务端文件。可通过 `BQREAD_DATA_DIR` 指定书籍目录，例如：

```sh
BQREAD_DATA_DIR=/path/to/books npm start
```

阅读进度与阅读设置保存在当前浏览器的 `localStorage`。清除浏览器网站数据不会删除服务端书籍，但会清除这台设备上的进度与设置。

旧版 IndexedDB 中的书籍会在打开原来的访问地址时自动迁移到服务端；只有全部书籍上传及阅读进度保存成功后，才清理旧数据库。迁移需要在原浏览器、原网站地址下进行，其他浏览器无法读取旧浏览器的 IndexedDB。迁移失败会保留旧数据，刷新可重试。

## 验证

```sh
npm test
npx playwright test
```

浏览器测试使用独立的临时书库，不会改动 `~/.bqread` 中的真实书籍。测试覆盖导入、服务端文件持久化、TXT 导出、旧数据迁移、浏览器数据清除后的书籍保留、目录导航、设置与进度、删除、错误提示及 390px 布局。
