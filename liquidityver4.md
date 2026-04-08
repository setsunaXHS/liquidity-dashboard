# USD Liquidity Watcher v4 — 开发记录

## 今日工作（2026-04-08）

### 一、雷达图评分对齐主看板

原来雷达图用自己一套独立的 5 年滚动分位评分逻辑，和下面板块打出来的分数不一致。

改动：删掉雷达内部所有独立评分函数（`rollingPct / fromPct / RADAR_ROLLING / WEIGHTS` 等），直接复用主看板的 `scoreTGA / scoreRRP / scoreReserves / scoreNetLiquidity / scoreEFFR_IORB / scoreSOFR_EFFR / compositeScore`，两边现在完全同源。

改完后发现加载明显变慢——根因是 O(n²)：每个历史时间点重新 filter 1500 条日度数据，300 个周度点 × 1500 = 45 万次比较。修复方案：日度数组预排序 + 三个指针增量推进，每条日度数据只访问一次，O(n²) → O(n)，快约 200 倍。

相关 commits：
- `7826493`：v4 radar uses main scoring functions, aligned with panel scores
- `b87227e`：v4 radar O(n²) → O(n) incremental map build

---

### 二、数据预缓存架构

每次刷新都打 10 个 FRED API 是浪费，数据日度更新就够了。

新架构：
- `api/fetch-data.js`：Vercel Serverless，一次拉 10 个 FRED 系列 + 预算 587 个雷达历史评分点，返回 JSON
- `data.json`（353KB）：打包进仓库随 Vercel 部署，CDN 直出
- `v4.html loadData()`：优先 `fetch('/data.json')`，失败才 fallback 到直接拉 FRED
- 雷达图：有预算历史数据直接读，零计算

效果：10 次串行 API → 1 次静态文件 fetch，加载快 5–10 倍。

OpenClaw Cron（ID: `aacea674-34b0-48ff-be0a-dc366b075494`，每天 08:00 北京时间）：
自动调 `/api/fetch-data` → 写 `data.json` → git push → Vercel 部署，数据日度自动更新。

相关 commit：
- `144a83b`：v4 data.json cache, api/fetch-data.js, radar precomputed history

---

### 三、SRF 用量 Demo（srf-demo.html）

独立页面，FRED `WORAL` 系列（2021 年 7 月 SRF 设立至今）。
- 自动判断信号状态（休眠 / 轻度 / 显著放量），月末窗口自动标注"季节性报表效应"
- 全历史 + 近 52 周放大双图
- 历史高点 Top 10 表，附背景说明

地址：https://liquidity-dashboard-one.vercel.app/srf-demo.html

相关 commit：
- `d41a7d6`：add srf-demo.html

---

## 当前版本状态

| 文件 | 状态 | 线上地址 |
|------|------|----------|
| v3.html | 锁定 | https://liquidity-dashboard-one.vercel.app/v3.html |
| v4.html | 主开发版本 | https://liquidity-dashboard-one.vercel.app/v4.html |
| srf-demo.html | 已上线 | https://liquidity-dashboard-one.vercel.app/srf-demo.html |
| swaplines-demo.html | 已上线 | https://liquidity-dashboard-one.vercel.app/swaplines-demo.html |

---

## 关键配置

- FRED API Key：`cd80bce065d6d311df574fbe558929f6`
- Vercel Token：`vcp_REDACTED`
- GitHub：https://github.com/setsunaXHS/liquidity-dashboard
- 部署命令：`cd ~/.openclaw/workspace/liquidity-dashboard && git add . && git commit -m "msg" && export PATH="/home/node/.local/bin:$PATH" && vercel deploy --token "vcp_..." --yes --prod`

---

## 待做事项

- [ ] v4 Part III：跨市场美元流动性观测
  - EUR/USD 3M CCS Basis（Bloomberg，ticker 待确认）
  - USD/JPY 3M CCS Basis（Bloomberg，ticker 待确认）
  - DXY（FRED: DTWEXBGS）
  - HY OAS（FRED: BAMLH0A0HYM2）
  - VIX（FRED: VIXCLS）
  - 2s10s（FRED: T10Y2Y）
  - 3m10y（FRED: T10Y3M）
- [ ] Bloomberg CCS Basis 正确 ticker 待用户在终端确认
- [ ] 市场新闻自动化（Cron → news.json → Vercel）
- [ ] 前瞻性信号：准备金 + EFFR-IORB 联合预警
- [ ] 历史事件标注合并进 v4

---

## 设计原则（已定型）

- v3 锁定，所有新功能在 v4
- 雷达图与主看板评分完全同源，不维护独立逻辑
- 数据加载：优先静态缓存（data.json），fallback 实时 API
- Bloomberg 数据：Excel Add-in 手动导出 CSV（blpapi 不可用，BAA 架构限制）
- SRF / Swap Lines 不进主看板（极端危机确认信号，日常监控价值低）
