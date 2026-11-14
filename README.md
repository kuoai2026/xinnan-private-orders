# 信男藥局 私下訂單系統（第一期）

前端：GitHub Pages（本資料夾）｜後端：Google Apps Script（`gas/`）｜資料庫：「信男藥局_私下訂單系統_資料庫」Google Sheet

`config.js` 的 `API_URL` 留空時是**示範模式**：用遮蔽過的假資料，不連資料庫。

## 功能
- 人員登入：選人名 → 輸入密碼（密碼只存 SHA-256 雜湊；連錯 5 次鎖 10 分鐘；登入 6 小時後過期）
- 建單：客戶比對（電話優先）、商品搜尋（報價表／商品別名／商品主檔）、自動帶上次報價與成本、毛利預覽、客戶報價單開關（隱藏成本，列印另存 PDF）
- 訂單總覽：狀態篩選、搜尋、詳情（貨況時間軸、報價紀錄、毛利）、標記已收款
- 出貨：選待出貨訂單 → 填物流商與單號 → 寫入出貨紀錄
- 奶水回購提醒：出貨日 + 總罐數 ÷ 每日罐數 = 預計喝完日，前 5 天提醒；同客人再訂奶水自動結案；每天 09:00 推播到 LINE 員工群組
- 成本報價表：讀取資料庫「報價表」分頁（任務 B 完成後顯示）
- 人員管理（管理者）、變更自己的密碼

## 部署步驟

### 1. 後端（Apps Script）
1. 開啟資料庫 Sheet → 擴充功能 → Apps Script
2. 建立 `Code.gs`、`Setup.gs`，貼上 `gas/` 內同名檔案
3. 執行 `setupSheets`（第一次會要求授權）→ 新增分頁：人員、回購提醒、奶水品項、操作紀錄、LINE群組紀錄。**不會改動既有分頁**
4. 打開「奶水品項」分頁，確認每箱罐數（預設：補體素 26、倍速 26、力增 24）
5. 在 `Setup.gs` 的 `setStaffPassword` 填入你的姓名與密碼 → 執行 → **執行完把密碼從程式碼刪掉**
6. 執行 `importPriceTable`：讀取雲端硬碟「私下訂單系統/報價表/報價表.csv」建立「報價表」分頁（已有時先改名備份）
7. 部署 → 新增部署作業 → 類型「網頁應用程式」→ 執行身分「我」、存取權「所有人」→ 複製網址
8. 把網址填進前端 `config.js` 的 `API_URL`

### 2. LINE 推播（奶水回購提醒）
1. LINE Developers 後台：用官方帳號開一個 Messaging API channel，取得 Channel access token
2. Apps Script → 專案設定 → 指令碼屬性：新增 `LINE_CHANNEL_TOKEN`
3. Webhook URL 填上一步的 Apps Script 網址，開啟 Use webhook
4. 把機器人加入員工群組 → 「LINE群組紀錄」分頁會出現群組 ID → 新增指令碼屬性 `LINE_GROUP_ID`
5. 執行 `installDailyTrigger`（每天 09:00 推播）
6. （選用）執行 `backfillMilkReminders` 用舊訂單補建提醒

### 3. 前端（GitHub Pages）
```bash
gh auth login
gh repo create xinnan-private-orders --public --source=. --push
```
GitHub Pages 用免費方案時 repo 必須是 public；程式碼不含金鑰與客戶資料，客戶資料要登入後才會從後端讀取。

## 安全
- 金鑰只放 Apps Script 指令碼屬性，不進 Git
- 前端不存任何客戶資料；示範資料皆為遮蔽範例
- 所有寫入都在後端檢查登入；人員管理需「管理者」角色
