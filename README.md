# TradeDocs · macOS 构建

两个版本，各自独立，同一个仓库分别打包：

| 目录 | 版本 | 说明 |
|---|---|---|
| `classic/` | **经典版** | 18 种单据，不含任何定制单据 |
| `salesinvoice/` | **销售发票版（定制）** | 在经典版基础上新增 `Sales Invoice Duplicate`，排第一个 |

## 出 macOS 包（两种方式）

1. **手动触发**：Actions → `Build macOS (classic + sales invoice)` → Run workflow
2. **打标签**：`git tag v1.0.x && git push origin v1.0.x`

产物（Actions 页面下载）：

- `classic-mac-arm64` / `classic-mac-x64`
- `salesinvoice-mac-arm64` / `salesinvoice-mac-x64`

每个包含 `.dmg` 与 `.zip`（未签名，首次打开需右键「打开」，或执行：

```bash
xattr -dr com.apple.quarantine /Applications/TradeDocs.app
```
）

## 本地（macOS 上）

```bash
cd classic && npm install && npm run dist:mac:arm   # 或 dist:mac:x64
cd salesinvoice && npm install && npm run dist:mac:arm
```
