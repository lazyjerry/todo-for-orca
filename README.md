# Daily To-Do List（Orca 外掛）

給一天之內的小任務用的待辦清單。寫程式、跑 agent 的空檔，常會冒出「11:30 發 PR」「下午三點回信」「每 50 分鐘起來動一動」這類零碎事項。它們小到不值得開專案管理工具，卻又容易忘。Daily To-Do List 讓你在 Orca 右側欄隨手記下，時間到了跳桌面通知，底部狀態列隨時顯示「正在做什麼、下一件是什麼」。

> **English** — A to-do list for the small tasks of your day. Jot them down in Orca's right sidebar without leaving your work, get a desktop notification when each one is due, and keep the current and next to-do in the status bar. To-dos can repeat every N minutes / hours / days / weeks / months, stop after a number of runs or at an end time, and carry a duration. The interface follows Orca's language: Traditional Chinese when Orca is set to Chinese, English otherwise.

## 設計取向

- **以「今天」為範圍**：適合幾分鐘到幾小時就能完成的事。做完就標記完成，隔天用批次刪除清掉，清單保持短小。
- **記錄要快**：清單底部的輸入框打個標題、按 Enter 就建好，需要時間或內容再補。
- **提醒要準、不打擾**：只有設了開始時間的項目才會通知；剛存檔或重新啟用時，不會補發一串過去的提醒。
- **不取代專案管理工具**：沒有指派、標籤、跨日排程看板，也不跨裝置同步。長期或多人協作的工作，請交給專案管理工具。

## 安裝（社群外掛目錄）

[Open in Orca](https://onorca.dev/plugins/lazyjerry.todo-list?catalog=community)

也可以在 Orca 的 Settings → Plugins 搜尋 `todo-list`。本外掛收錄在 Orca 社群目錄（[orca-community-plugins](https://github.com/stablyai/orca-community-plugins)）：目錄只做自動檢查，沒有人工審查。第一次安裝時，Orca 會先詢問是否加入社群目錄，再列出外掛要求的權限（見〈權限〉），經你同意後才會安裝。

## 功能

- **快速新增**：在清單底部的輸入框打標題，按 Enter 或「新增」即可建立。其他欄位套用預設值（啟用、沒有開始時間，所以不會通知），建立後直接進入編輯頁補完細節。
- **依狀態瀏覽**：上方分頁切換「啟用／停用／已完成」，標籤帶筆數，預設停在「啟用」。啟用中的項目依「進行中 → 下一次時間」排序。
- **進行中與下一件**：清單最上方以醒目區塊顯示正在進行的項目及其結束時間，以及下一件要做的事。
- **內容頁**：點任一項目，面板會切換成內容頁，顯示標題、狀態、時間條件與 Markdown 內容。可在此編輯、測試通知、標記完成、停用／啟用或刪除；左上角「← 返回」回到清單。內容中的待辦方框只供顯示，要勾選請進編輯頁把 `[ ]` 改成 `[x]`。
- **時間條件**：開始時間、持續時間、重複（每 N 分鐘／小時／天／週／月），以及停止條件（不停止／總次數／截止時間）。開始時間有「帶入現在時間」與「選擇日期時間」（月曆點日期、下拉選時與分），持續時間有「15 分／半小時／2 小時／5 小時／8 小時」快速按鈕。
- **桌面通知**：每一場開始時發送通知。Orca 關閉期間錯過的場次，下次啟動只補發最近的一場，並標明是「錯過的提醒」。外掛無法得知 macOS 是否允許 Orca 通知、是否開著專注模式，沒收到通知時請到「系統設定 → 通知 → Orca」確認，並用內容頁的「測試通知」驗證。
- **狀態列**：顯示「進行中：標題（至 HH:mm）」與「下一個：今天 14:00 標題」，沒有項目時自動隱藏；點一下可查看摘要。
- **批次清理**：勾選要清掉的狀態（已完成、停用），確認將刪除的項目後才執行；啟用中的項目不會被刪。
- **確認提示**：單筆刪除、批次刪除，以及內容頁的停用／啟用，都需要再按一次確定；確認框會說明後果（例如重新啟用時，停用期間錯過的場次不補發）。
- **Markdown 內容**：編輯頁右上角的小按鈕切換「撰寫／預覽」。輸入時有兩項輔助：
  - 在列表項目按 Enter 會延續符號（`-`、`*`、`1.` 自動加一、待辦補 `- [ ] `），空項目按 Enter 則結束列表。
  - 在列表符號後打 `[` 會補成待辦 `[ ] `，例如 `- [` → `- [ ] `。
- **指定工作區**：編輯頁可替 todo 指定一個 Orca 工作區（Git worktree 或資料夾），從下拉選單選，或按「帶入目前工作區」。指定後，清單與內容頁會在項目下方顯示工作區名稱（與分支），點一下就切換過去，效果等同點 Orca 左側欄。

## 使用細節

- 時間格式為 `YYYY-MM-DD HH:mm`（也接受 `/` 與 `T`），依本機時區解讀。「帶入現在時間」會填入下一個整分。
- 「選擇日期時間」的月曆：點日期只換日期、保留原本的時分；分鐘下拉每 5 分一格，手打的非整 5 分仍會列出。欄位空白時點日期，時間先帶下一個整分。
- 存檔當下之前的場次不會通知，新增或修改時間時不會冒出舊提醒；重新啟用時，停用期間錯過的場次也不補發。
- 每月重複遇到小月時，會落在該月最後一天（1/31 → 2/28 → 3/31）。
- 只有「啟用」的項目會通知、計入進行中，並出現在狀態列。
- 沒有開始時間的項目只是一般清單項目，不會通知。
- **持續時間**目前僅作標記：場次開始後的這段時間視為「正在進行」，會顯示在清單上方、狀態列與內容頁。
- **介面語言**跟隨 Orca：語系以 zh 開頭（含簡體）時顯示繁體中文，其他一律英文。通知與狀態列由背景 worker 產生，但 worker 取得不到 Orca 的語言設定，因此沿用面板最後一次開啟時的語言（存在 storage key `lang`）；面板從未開啟過則使用系統語系。指令名稱與狀態列 tooltip 寫在 manifest 裡，Orca 不支援翻譯，固定為英文。

## Orca 限制下的取捨

| 原本想要的 | 實際做法 | 原因 |
|---|---|---|
| 點開後全畫面 popup | 整個側欄面板切換成內容頁 | Orca 元件面板沒有 modal／浮層，plugin API 也無法把面板開到主編輯區 |
| 日期時間選擇器 | 文字輸入加格式驗證 | 元件庫沒有日期選擇器 |
| 各種顏色的按鈕 | 成功、警告色改用外框上色 | `Button` 的 tone 只有 accent（solid）與 danger 會上色 |
| 返回箭頭圖示 | 文字按鈕「← 返回」 | 內建圖示集沒有箭頭或返回圖示 |
| 靠右的小頁籤 | 撰寫／預覽改用靠右的 xs 按鈕切換 | `Tabs` 無法調整大小與對齊；外掛的操作一律放右側，與 Orca 原生操作做出區隔 |
| 格式工具列（粗體、列表、標題…） | 只做 Enter 延續列表與 `[` 補成待辦 | `Textarea` 只回報整段文字，取不到也設不了游標與選取範圍，圖示集也沒有格式圖示 |
| 在內容頁直接勾選待辦 | 方框僅供顯示，到編輯頁修改 | `Markdown` 元件的方框是唯讀的；改畫可勾選元件後，每勾一次整個面板都要重畫 |
| 點清單項目上的工作區直接跳轉 | 工作區按鈕放在項目下方另起一列，有工作區的項目各自成段 | `List` 只能放 `ListItem`，`ListItem` 整列是按鈕、不能再放其他控制項 |
| 精準認出目前開啟的工作區 | 用名稱＋分支比對，比對不到改比唯一的分支，仍認不出就請使用者從清單選 | `workspace.readContext` 只給分支與顯示名稱，不給工作區 id |

## 權限

| 能力 | 用途 |
|---|---|
| `storage:own` | 存放待辦項目與介面語言（外掛自己的 storage，key 為 `todos`、`lang`） |
| `notifications:show` | 發送桌面通知 |
| `workspace:read` | 列出 Orca 的工作區、讀取目前開啟的工作區，供 todo 指定 |
| `workspace:write` | 點工作區按鈕時切換到該工作區 |

工作區功能需要 Orca 提供 host API 1.3（`workspace.list`、`workspace.open`）；版本較舊或未核准上述權限時，編輯頁會顯示提示，其他功能照常運作。從舊版更新後需重新核准權限。

執行層級為 `trusted-worker`：worker 每 15 秒檢查一次場次並更新狀態列。由於 manifest 宣告了 `statusBarItems`，外掛啟用期間 Orca 會持續執行 worker。

資料只存在本機（`~/Library/Application Support/orca/plugins-data/<外掛 key>/storage.json`），不會上傳，也不會跨裝置同步。

## 開發

型別檢查工具裝在上一層資料夾，因為外掛資料夾裡不能放 `node_modules`（Orca 拒收含 symlink 的外掛內容）。

```sh
cd ..                              # orca-ext/
npm install
npm run check:todo                 # typecheck + validate + test + check
orca plugin dev watch todo-list    # 以開發模式載入 Orca；第一次會要求 --approve
```

外掛 id 維持 `todo-list`：改 id 等於換成另一個外掛，既有資料與社群目錄的連結都會斷掉。

```
src/
├── core/          # panel 與 worker 共用：資料模型、場次計算（schedule）、草稿驗證（draft）、顯示格式（format）、介面文字（i18n）、Markdown 輸入輔助（markdown）
├── worker/        # storage 讀寫（store）、通知與狀態列的計算（engine）、Orca 工作區查詢（workspaces）
├── worker.ts      # worker 進入點：請求處理、定時檢查
├── panel.tsx      # 右側欄面板
└── protocol.ts    # panel 與 worker 的請求契約
```

## 授權

Apache-2.0
