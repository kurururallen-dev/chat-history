# chat-history

Claude Code 的過往對話側邊欄，自動依專案分類，點一下就能切回舊對話。

## 快速安裝

需要先裝好 [Claude Code](https://claude.com/claude-code)。在 Claude Code 的輸入框貼上這行：

```
/plugin install chat-history --marketplace kurururallen-dev/chat-history
```

問「Add marketplace?」時按 `y`，安裝範圍選 **user**（所有資料夾都能用），裝好後重開 Claude Code。

> ⚠️ 不用按綠色的「Code → Download ZIP」，下載下來沒辦法用，請用上面的指令安裝。

裝好後，按輸入框下方的「☰ 過往對話」，或打 `/chats`，就會打開右側面板。

## 功能

- **過往對話面板**：依專案分組，顯示每段對話的時間、訊息數。點對話標題就會在輸入框填好 `/resume`，按 Enter 切換過去；其他資料夾的對話會複製 `cd … && claude --resume …` 指令。
- **自動分類**：用 Haiku 把對話分到你的專案；分錯可以按「移動」手動改。分不出來的對話之後有新訊息會再試，按 ↻ 會全部重試。
- **開新對話到指定專案**：專案旁的「＋」會開一段新對話，送出第一句後自動歸到那個專案。
- **刪除**：每段對話後面的「刪除」按兩次才會執行。對話檔會搬到 `~/.claude/chat-archive/`，不是永久刪除，搬回 `~/.claude/projects/` 原資料夾即可救回。
- **狀態列按鈕**：輸入框下方的提示列旁有「☰ 過往對話」，按一下開關面板。也可以打 `/chats`。

## 其他安裝方式

從終端機：

```
claude plugin install chat-history --marketplace kurururallen-dev/chat-history
```

桌面版 App（`/plugin` 不能用時）：按輸入框旁的 +，選 Plugins，Add marketplace 填 `kurururallen-dev/chat-history`，再 Add plugin。

## 自訂分類

預設分類是：工作、學習、程式開發、Claude Code 設定、設計、生活、其他。

想用自己的分類，寫一份 Markdown 筆記（Obsidian 筆記也可以），在「## 專案」標題底下列出專案，格式是「- 專案名稱：判斷提示」，判斷提示是給 Haiku 參考的關鍵字。縮排兩格可以加子專案，面板會顯示成「專案／子專案」。

```markdown
## 專案

- 畢業製作：畢製、展場、採訪
  - 展場：佈展、觀眾動線
- 接案：客戶、報價、外包
- 其他：其他無法歸類的
```

然後在 Claude Code 打 `/plugin configure chat-history`，把「分類清單筆記」填成這份筆記的完整路徑（可用 `~/` 開頭）。每次刷新面板都會重讀這份筆記。

注意：分類是用專案名稱記住的，改名或刪除專案後，原本歸在裡面的對話會回到「未分類」。

## 需求與限制

- 面板放在畫面右側，終端機寬度太窄時放不下，會提示你把視窗拉寬。
- 對話清單讀的是 `~/.claude/history.jsonl`，只包含 Claude Code 裡的對話，讀不到桌面版 Claude 的聊天。
- 自動分類會呼叫 Haiku，會用到一點點額度。

## 授權

MIT
