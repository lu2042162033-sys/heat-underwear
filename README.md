# HEAT UNDERWEAR 商品展示网页

中西双语 · 简约轻奢。支持两种使用方式：

- **静态模式**：双击即用，数据保存在本机浏览器；
- **服务模式**（推荐）：启动 Python 服务，数据保存在服务器，所有人可访问、有口令者可在管理面板增删改商品。

## 一、静态模式（无需安装）

- 双击 `打开网站.bat`，或直接打开 `w\outputs\site\index.html`。
- 管理面板口令：默认 `8888`（改 `w\outputs\site\data\site-config.js` 中的 `adminPasscode`）。
- 注意：静态模式下商品改动只保存在本机浏览器，换设备不共享。

## 二、服务模式（本地电脑 / 服务器）

1. 双击 `启动服务器.bat`（需要本机已安装 Python 3.8+）；
2. 浏览器打开 `http://localhost:3000`；
3. 页脚「管理」→ 输入口令（默认 `8888`，上线前务必修改）；
4. 服务模式下，新增/编辑/删除的商品会保存到 `server-data\products.json`，所有访客看到同一份数据；上传的图片保存到 `w\outputs\site\images\products`。

## 三、部署到公网（所有人可访问）

需要一个能运行 Python 3.8+ 的平台或服务器（任选其一），服务零第三方依赖：

### 方式 A：Railway（推荐，无需自己买服务器）

前置：注册一个 GitHub 账号，并用它登录 [railway.app](https://railway.app)（免费；部分新账号首次部署可能需要验证支付方式，用免费额度即可，不花钱）。

1. 在 GitHub 新建一个仓库（Public / Private 均可），例如 `heat-underwear`；
2. 把本项目推送到该仓库（本项目已初始化 git）：
   ```bash
   git remote add origin https://github.com/你的用户名/heat-underwear.git
   git branch -M main
   git push -u origin main
   ```
   （或直接把整个 `shangpin` 文件夹拖进 GitHub 网页的 “Upload files”。）
3. 打开 Railway → New Project → **Deploy from GitHub repo** → 选择 `heat-underwear`；
4. Railway 会自动识别 Dockerfile 并构建，几分钟后生成 `https://你的项目.up.railway.app` 网址；
5. 设置环境变量（Settings → Variables）：
   - `ADMIN_PASSWORD` = 你的管理口令（务必修改，不要用默认的 8888）
   - `SECURE_COOKIE` = `1`
6. 添加持久化磁盘（防止重启/重新部署丢失商品数据）：Settings → **Volumes** → 新建 Volume（1GB 即可）→ Mount Path 填 `/app/server-data`；
7. 重新部署一次让配置生效；打开网址，页脚「管理」用你设置的 `ADMIN_PASSWORD` 登录。

以后日常加商品直接在网页管理面板操作；若要更新代码或初始数据，改动后 push 到 GitHub，Railway 会自动重新部署（商品数据在磁盘卷里，不受影响）。

备用方式（不想用 GitHub）：安装 [Railway CLI](https://docs.railway.com/reference/cli-api) 后，在项目目录执行 `railway login` → `railway init` → `railway up`，同样需要设置上面两个环境变量和持久化卷。

### 方式 B：Docker / 任意支持 Docker 的平台（VPS 等）

```bash
docker build -t heat-site .
docker run -d -p 3000:3000 \
  -e ADMIN_PASSWORD=你的上线口令 \
  -e SECURE_COOKIE=1 \
  -v /数据目录:/app/server-data \
  heat-site
```

### 方式 C：Render（网页控制台）

- 启动命令：`python server.py`（Render 选择 Python 运行时）
- 必须设置环境变量 `ADMIN_PASSWORD`（上线口令）；开启 HTTPS 后把 `SECURE_COOKIE` 设为 `1`。
- **持久化提醒**：商品数据写在 `server-data\products.json`。Render 免费版的磁盘是临时的（重启/重新部署会清空），请使用 Railway 持久化磁盘、Render 付费磁盘，或 VPS + Docker 卷挂载；并定期在管理面板「导出 JSON」备份。

## 四、目录结构

```
shangpin\
├─ README.md
├─ 打开网站.bat             ← 静态模式
├─ 启动服务器.bat           ← 服务模式
├─ server.py                ← Python 服务（静态托管 + 管理 API，零依赖）
├─ Dockerfile / render.yaml / railway.toml
├─ server-data\             ← 运行时商品数据（自动生成，勿手动改）
└─ w\
   ├─ work\                 ← 构建脚本（build_site.py）
   └─ outputs\site\         ← 完整站点
      ├─ index.html
      ├─ css\ js\ data\
      └─ images\products\   ← 商品图片（上传也保存在这里）
```

## 五、管理商品（新增 / 编辑 / 删除）

1. 打开网页 → 页脚「管理」→ 输入口令；
2. 「商品管理」面板中可新增、编辑、删除商品，支持分类筛选和搜索；
3. 新增商品时图片有三种方式：
   - 从「已有图片」下拉中选择（已内置 197 张）；
   - 点「上传图片」直接上传本地图片（服务模式下会保存到服务器）；
   - 手动输入文件名（图片需已存在于 `w\outputs\site\images\products\`）。

## 六、备份与恢复

- 管理面板「导出 JSON」下载备份；「导入 JSON」恢复；「恢复初始数据」回到最初的 192 个商品。
- 服务模式下，`server-data\products.json` 本身就是服务器端数据，可连同图片目录一起定期备份。

## 七、修改站点信息

打开 `w\outputs\site\data\site-config.js`，可修改：站点副标题、店铺地址行（storeLine）、静态模式口令、联系方式、货币符号。
服务模式的管理员口令请用环境变量 `ADMIN_PASSWORD` 设置（不要写在代码里）。

## 八、重新生成初始数据（可选）

- 需要 Python 与 openpyxl：`python w\work\build_site.py`
- 脚本读取「价格核对表」Excel 与 `E:\image`，重新生成 `products.js`、`images.js` 并复制图片。
- 服务模式下，重新生成种子数据后需在管理面板点「恢复初始数据」，或删除 `server-data\products.json` 让服务重新载入种子。

## 九、技术说明

- 前端纯 HTML / CSS / JS；后端 Python 标准库（http.server），零第三方依赖。
- API：`/api/me`（探测服务）、`/api/login`、`/api/logout`、`/api/products`（读/写）、`/api/reset`、`/api/images`（列表/上传）。
- 登录使用服务端口令校验 + HttpOnly 会话 Cookie；登录失败 5 次后限速 1 分钟。
