# Life Logger

日記與足跡記錄應用：FastAPI + SQLite 後端、網頁版介面，以及 Flutter App。

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
├── css/         依功能分開的樣式，reset.css 必須最後載入
├── js/          一般 script，共用全域範圍，index.html 裡的順序就是執行順序
└── vendor/      第三方函式庫（Leaflet 1.9.4）
```

### 環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 實體手機要連線時設為 `0.0.0.0` |
| `PORT` | `8000` | 服務連接埠 |
| `RELOAD` | `true` | 程式變更時自動重啟，正式環境請設為 `false` |
| `LIFE_LOGGER_DB` | `backend/data/life_app.db` | SQLite 檔案位置 |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:8000` | 對外網址，用於驗證信連結與第三方登入。使用 `https://` 時 Cookie 會加上 Secure |

### Email 驗證

設定 `SMTP_HOST` 和 `SMTP_FROM` 後就會啟用：註冊後要先開啟信中的連結才能登入。未設定時可直接註冊登入，方便本機開發，但帳號會維持未驗證。

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

- 預設連到本機後端，Android 模擬器會自動改用 `10.0.2.2`。其他位址用 `--dart-define=API_BASE_URL=https://<host>/api` 指定。
- 正式版 Android 只允許 HTTPS，HTTP 僅開放給 debug 版。
- App 的第三方登入會開啟系統瀏覽器，再透過 `lifelogger://auth` 回到 App。模擬器和實機都必須連得到 `PUBLIC_BASE_URL`，所以實務上需要公開的 HTTPS 網址。
- macOS 版未加入 Keychain 權限，因為那需要 Apple 開發者簽章。App 可以正常登入，但關閉後要重新登入。要保存登入狀態，請設定簽章並加入 `keychain-access-groups`。
- 不支援 Flutter Web，網頁版請使用後端提供的介面。
- 上架前請把 `com.lifelogger.life_logger`（Android）和 `com.lifelogger.lifeLogger`（iOS、macOS）換成你自己的識別碼。

## 測試

```sh
cd backend && python3 -m unittest tests.test_api
cd frontend && flutter analyze && flutter test
```

後端測試使用暫存資料庫，不會動到 `backend/data` 裡的資料。手動測試時也建議設定 `LIFE_LOGGER_DB` 指向暫存檔。
