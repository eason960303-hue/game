# Life Logger

日記、足跡與公開揪團應用：可發起最多 10 人的揪團邀請、預覽路線並直接參加。使用 FastAPI + SQLite 後端，提供網頁版介面與 Flutter App。

## 後端與網頁版

```sh
cd backend
pip install -r requirements.txt
python3 main.py
```

開啟 http://127.0.0.1:8000 即可使用網頁版。網頁版不需要建置：直接修改 `backend/static` 裡的檔案，重新整理頁面就會生效。

```
backend/static/
├── index.html   頁面結構
├── css/         tokens.css 集中定義顏色、字體與圓角（換風格改這裡），app.css 是版面與元件，由上而下依序覆蓋
└── js/          一般 script，共用全域範圍，index.html 裡的順序就是執行順序
```

### 手機安裝（PWA）

網頁版可以加到手機主畫面，像 App 一樣全螢幕開啟：Android 的 Chrome 會在首頁和「我的」顯示安裝按鈕，iPhone 則用 Safari 的分享按鈕選「加入主畫面」。這需要 HTTPS，`127.0.0.1` 除外。

- 離線時仍能開啟介面，但日記等內容不會存在手機上，要連線才看得到。`backend/static/sw.js` 不會快取任何 `/api/` 回應。
- 介面檔案會先向伺服器取得最新版，3 秒內沒有回應才用手機上的版本，所以修改 `backend/static` 後重新開啟就會生效。
- 安裝後的圖示綁定當時的網址。`trycloudflare.com` 的網址每次重開通道都會變，舊圖示就會失效，長期使用請改用固定網域。

### 環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 實體手機要連線時設為 `0.0.0.0` |
| `PORT` | `8000` | 服務連接埠 |
| `RELOAD` | `true` | 程式變更時自動重啟，正式環境請設為 `false` |
| `LIFE_LOGGER_DB` | `backend/data/life_app.db` | SQLite 檔案位置 |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:8000` | 對外網址，用於驗證信、密碼重設連結與第三方登入。使用 `https://` 時 Cookie 會加上 Secure |

### Google 地圖

地圖使用 Google Maps Platform，完整功能需要已啟用計費的 Google Cloud 專案。未設定金鑰時會改用 Google 的內嵌地圖，可以瀏覽地圖和足跡路線，但沒有站內搜尋、圖層和地圖選點。

| 變數 | 預設值 | 說明 |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | 無 | 網頁版金鑰。會傳到瀏覽器，請在 Google Cloud 限制 HTTP 參照網址，例如 `http://127.0.0.1:8000/*` |
| `GOOGLE_MAPS_MAP_ID` | `DEMO_MAP_ID` | 地圖 ID，`DEMO_MAP_ID` 僅供開發，正式環境請建立自己的 |
| `GOOGLE_MAPS_SERVER_KEY` | 無 | App 內搜尋、地點資訊和路線使用的伺服器金鑰，只留在後端。請另建一把，用 IP 限制，並啟用 Places API (New)、Routes API、Geocoding API |

金鑰要啟用 Maps JavaScript API、Places API (New)、Routes API、Geocoding API。搜尋、地點資訊和路線都會按用量計費，建議在 Google Cloud 設定預算與配額上限。

### Email 驗證

設定 `SMTP_HOST` 和 `SMTP_FROM` 後就會啟用電子郵件驗證與忘記密碼功能：註冊後要先開啟信中的連結才能登入；忘記密碼時可申請一次性重設連結，連結一小時後失效，更新密碼後會登出所有裝置。未設定時可直接註冊登入，方便本機開發，但不會寄送驗證或重設郵件。

| 變數 | 預設值 | 說明 |
|---|---|---|
| `SMTP_HOST` | 無 | 郵件伺服器位址 |
| `SMTP_FROM` | 無 | 寄件人，例如 `Life Logger <noreply@example.com>` |
| `SMTP_PORT` | `587` | 連接埠 |
| `SMTP_SECURITY` | `starttls` | `starttls`、`ssl` 或 `none` |
| `SMTP_USERNAME`、`SMTP_PASSWORD` | 無 | 登入帳密，留空則不登入 |

無論是否設定 SMTP，用 Google 或 Apple 登入一個未驗證的帳號時，都會清除該帳號的密碼並登出所有裝置，避免先用別人 Email 註冊的人保有存取權。已驗證的帳號不受影響，既有帳號在升級時會視為已驗證。

### 第三方登入

| 服務 | 環境變數 | 要登記的回呼網址 |
|---|---|---|
| Google | `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` | `{PUBLIC_BASE_URL}/api/auth/google/callback` |
| Apple | `APPLE_CLIENT_ID`、`APPLE_TEAM_ID`、`APPLE_KEY_ID`、`APPLE_PRIVATE_KEY` | `{PUBLIC_BASE_URL}/api/auth/apple/callback` |

Apple 要求 HTTPS，所以無法在 `http://` 的本機環境測試。

## Flutter App

```sh
cd frontend
flutter pub get
flutter run
```

需要完整的 Xcode（iOS、macOS）或 Android Studio（Android）。

- 預設連到本機後端，Android 模擬器會自動改用 `10.0.2.2`。其他位址用 `--dart-define=API_BASE_URL=https://<host>/api` 指定，或在 App 登入畫面按「伺服器位址」輸入，例如 cloudflared 的網址。
- 正式版 Android 只允許 HTTPS，HTTP 僅開放給 debug 版。
- App 的第三方登入會開啟系統瀏覽器，再透過 `lifelogger://auth` 回到 App。模擬器和實機都必須連得到 `PUBLIC_BASE_URL`，所以實務上需要公開的 HTTPS 網址。
- macOS 版未加入 Keychain 權限，因為那需要 Apple 開發者簽章。App 可以正常登入，但關閉後要重新登入。要保存登入狀態，請設定簽章並加入 `keychain-access-groups`。
- 不支援 Flutter Web，網頁版請使用後端提供的介面。
- 真實地圖需要 `--dart-define=GOOGLE_MAPS_API_KEY=<金鑰>`，金鑰要啟用 Maps SDK for Android 和 Maps SDK for iOS。未提供金鑰或在 macOS 上會顯示簡易示意圖。App 內的搜尋、地點資訊和路線透過後端取得，需要在後端設定 `GOOGLE_MAPS_SERVER_KEY`。
- 上架前請把 `com.lifelogger.life_logger`（Android）和 `com.lifelogger.lifeLogger`（iOS、macOS）換成你自己的識別碼。

## 測試

```sh
cd backend && python3 -m unittest tests.test_api
cd frontend && flutter analyze && flutter test
```

後端測試使用暫存資料庫，不會動到 `backend/data` 裡的資料。手動測試時也建議設定 `LIFE_LOGGER_DB` 指向暫存檔。
