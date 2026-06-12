# 🖼️ 网页图片下载器 — Chrome 扩展

一键提取、筛选、批量下载当前网页上的所有图片。支持懒加载图片、CSS 背景图、图片放大预览、防盗链绕过。

## ✨ 功能

| 功能 | 说明 |
|------|------|
| 🔍 **一键提取** | 提取页面上所有 `<img>`、CSS `background-image`、`<picture>` 等来源的图片 |
| 🎨 **格式筛选** | 按 JPEG / PNG / GIF / WebP / SVG 格式过滤 |
| 📐 **尺寸筛选** | 按最小宽度 × 高度过滤 |
| 🖼 **网格预览** | 缩略图网格展示，每张标注尺寸和格式 |
| ✅ **批量勾选** | 全选 / 取消 / 逐张勾选，选中后一键下载 |
| 📦 **ZIP 打包** | 多张图片打包成一个 ZIP 文件，只下载一次，不弹多次确认 |
| 🔒 **防盗链绕过** | 自动注入页面 Referer 头，绕过 CDN 防盗链 |
| 🔄 **实时刷新** | 滚动懒加载后点刷新，重新扫描页面图片 |
| 🖥 **独立预览** | 双击图片弹出全屏灯箱窗口，支持键盘 ← → 翻页 |
| ⬇ **单张下载** | 预览窗口内随时单张下载 |

## 📦 安装

### 从源码加载（开发者模式）

```bash
# 克隆或下载本项目
git clone <repo-url>

# 进入目录
cd chrome-image-downloader
```

1. 打开 Chrome → `chrome://extensions`
2. 开启右上角 **"开发者模式"**
3. 点击 **"加载已解压的扩展程序"**
4. 选择 `chrome-image-downloader/` 目录

### 加载后需要

- 点击扩展图标，Chrome 会请求权限 → **确认授权**
- 权限说明见下方

## 🎯 使用指南

### 基本流程

1. 访问任意包含图片的网页（如 X/Twitter、微博、电商网站等）
2. 点击扩展图标 ![icon](chrome-image-downloader/icons/icon16.png)
3. 等待自动扫描，弹出面板显示所有图片
4. 在工具栏筛选格式 / 最小尺寸
5. 勾选需要的图片
6. 点击 **"下载选中"** → 浏览器下载一个 ZIP 包
7. 解压后得到所有原图

### 操作细节

| 操作 | 效果 |
|------|------|
| **单击** 图片卡片 | 选中 / 取消选中 |
| **双击** 图片卡片 | 弹出独立预览窗口 |
| **全选** / **取消** | 批量操作 |
| **↻ 刷新** | 重新扫描页面（处理懒加载） |
| 预览窗口 **← →** | 上一张 / 下一张 |
| 预览窗口 **Esc** | 关闭预览 |

## 🔐 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` | 获取当前标签页的图片 |
| `scripting` | 注入图片提取脚本 |
| `downloads` | 下载 ZIP 文件 |
| `declarativeNetRequest` | 动态注入 Referer 请求头（绕过防盗链） |
| `storage` | 预览窗口数据共享 |
| `host_permissions: \<all_urls\>` | 后台 Service Worker 跨域抓取原图 |

> ⚠️ `host_permissions` 用于后台脚本下载跨域图片，**不收集、不发送任何用户数据**。
> 所有代码运行在本地，无外部请求（除了抓取你指定的图片本身）。

## 🏗 技术架构

```
popup.html / popup.js      ← 弹出面板 UI + 交互逻辑
background.js              ← Service Worker（DNR 规则 + ZIP 打包）
preview.html / preview.js  ← 独立预览窗口
manifest.json              ← 扩展清单 (MV3)
```

### 下载流程

```
用户点击 "下载选中"
  → popup 提取选中图片 URL + 当前页面 URL（作为 Referer）
  → 通知后台 SW 创建 DNR 规则（注入 Referer 头）
  → 后台 SW 用 fetch() 逐张抓取原图（无 CORS 限制，带 Referer）
  → 后台 SW 用纯 JS 打包成 ZIP 文件
  → 后台 SW 通过 chrome.downloads.download 下载 ZIP（单次下载）
  → DNR 规则自动清理
```

### 防盗链原理

许多图片 CDN 检查 HTTP `Referer` 头来防止盗链。当用户右键另存为时，浏览器自动带上页面 Referer，CDN 放行。而 `chrome.downloads.download` 不携带页面 Referer，导致 CDN 返回缩略图或错误页。

本扩展通过 `declarativeNetRequest` API，在发起下载前动态创建规则，为图片请求注入正确的 `Referer` 头，从而拿到原图。

## 🧪 本地测试

打开 `test-page.html`（在项目目录内），点击扩展图标即可测试图片提取和下载。

## 📄 License

MIT
