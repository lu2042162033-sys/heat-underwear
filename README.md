# HEAT UNDERWEAR 商品展示网页

中西双语 · 简约轻奢 · 永久免费托管于 GitHub Pages

## 线上地址

- **网站**：https://lu2042162033-sys.github.io/heat-underwear/
- **GitHub 仓库**：https://github.com/lu2042162033-sys/heat-underwear

## 架构

- **托管**：GitHub Pages（永久免费，无到期限制）
- **数据存储**：仓库内 `w/outputs/site/data/products.json`（192 条初始商品）
- **管理面板**：页脚“管理”入口 → 输入口令 + GitHub 令牌 → 增删改商品
  - 口令 `sarmiento2716` 存在仓库 Secret `ADMIN_PASSWORD` 中，不进代码
  - 修改通过 GitHub Actions 校验口令后自动提交并重新部署

## 管理员如何新增/修改商品

1. 打开网站 → 页脚点击 **管理**
2. 输入管理口令 `sarmiento2716`
3. 粘贴你的 GitHub 令牌（Settings → Developer settings → Personal access tokens → Fine-grained tokens，需对 heat-underwear 仓库有 Contents 读写权限；令牌只保存在你的浏览器里）
4. 在管理面板新增/编辑/删除商品，点保存；约 1 分钟内网站自动更新

## 添加新商品图片

- 把图片文件放进仓库 `w/outputs/site/images/products/` 并 push 到 main
- 然后在管理面板商品表单的图片输入框里填写文件名即可
- 也可以直接“上传图片”（1.5MB 以内，以 base64 存入商品数据）

## 本地开发

- 站点文件在 `w/outputs/site/`，双击 `index.html` 可直接预览（本地模式）
- 构建脚本 `w/work/build_site.py` 从 Excel 生成数据（可选）

## 重要安全说明

- 管理口令只存在于 GitHub Actions Secret，不出现在任何代码里
- 暴露的令牌仅能触发工作流，无法绕过口令校验写入数据
- 建议定期在管理面板 **导出 JSON** 备份商品数据
