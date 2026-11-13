# 混打注音 MixZhuyin

用注音鍵盤直接打，**中文、英文自動判斷，不用切換**。

```
按鍵：1; ji3check u vu84
輸出：幫我 check 一下
```

混打注音是 [小麥注音 McBopomofoWeb](https://github.com/openvanilla/McBopomofoWeb) 的分支（fork），在小麥注音的核心上加入「中英混打模式」。小麥注音原本的詞庫、使用者詞彙、各種鍵盤配置、標點與選字窗都照常使用。

## 怎麼判斷中文還是英文

同一串按鍵同時用兩種方式解讀：當成目前鍵盤配置的注音，也當成英文字母。把整串切成「中文詞＋英文字」的各種組合，用中文詞頻（小麥注音詞庫）和英文詞頻算出每種切法的機率，挑最高的一種。中英切換一次會扣一點分，避免一句話裡亂跳。每按一鍵就整串重算，所以打 `up` 會先顯示英文，接著打 `jo4` 就變成「因為」。

程式在 [`src/MixedInput/`](src/MixedInput/)：

- `MixedDecoder.ts`：判斷與選字（動態規劃）
- `MixedComposer.ts`：組字狀態（游標、選字、Shift 中英互換、自動空白、學習）
- `EnglishModel.ts`、`EnglishData.ts`：英文詞頻

## 整句選字（本機語言模型）

中文部分判斷完之後，會再用「詞與詞相鄰的機率」把整段重新選一次字，例如「記得帶傘」不會被選成「記得代傘」。模型是詞的二元語法（bigram）加三元語法（trigram，看前兩個詞），在本機計算、不連網，每句約 1–2 毫秒。

- 訓練語料：中文維基百科 1.5 億字＋繁體中文網頁語料（Traditional Chinese C4）3 億字，用 OpenCC 轉成台灣正體用語，以小麥注音的詞庫斷詞；另外加上 2,841 句日常口語（[`tools/mixed/corpus/colloquial.txt`](tools/mixed/corpus/colloquial.txt)，用 AI 寫的聊天句子，訓練時加重 50 倍），補足網路文字裡少見的「對啊、好喔、等等我」。
- 模型大小：30 萬組詞對＋20 萬組三詞組，各約 3 MB。
- 訓練方式：GitHub Actions 的「Train language model」工作流程（[`tools/mixed/train_bigram.py`](tools/mixed/train_bigram.py)），訓練完會自動評估並推到 `lm/bigram-<編號>` 分支。

在 2,000 句沒參與訓練的句子上（純注音輸入、大千配置）的結果：

| 測試句 | 只用詞頻（小麥注音原本） | 加上語言模型 |
| --- | --- | --- |
| 維基百科 1,000 句：字正確率 | 91.8% | 93.8% |
| 維基百科 1,000 句：整句全對 | 58.5% | 67.9% |
| 網頁文字 1,000 句：字正確率 | 89.6% | 92.1% |
| 網頁文字 1,000 句：整句全對 | 48.2% | 59.5% |
| 日常混打 146 句：整句全對 | 141 | 144 |

加上三元語法後（第 8 次訓練），在同一批沒參與訓練的網頁與維基句子上，字正確率 93.3% → 93.5%、整句全對 64.5% → 65.0%；另寫的 30 句口語，整句全對 76.7% → 83.3%。


> 給譯者／詞庫維護者：`src/MixedInput/BigramData.ts` 和 `TrigramData.ts` 是訓練產生的資料，請不要手改；要更新就重新跑訓練流程。第 8 次訓練加入了三元語法和口語語料。它們只影響混打模式的選字順序，不改變小麥注音詞庫本身。

## 安裝（Windows）

1. 下載並執行 `MixZhuyin-<版本>-setup.exe`。安裝程式沒有數位簽章，Windows 會顯示 SmartScreen 警告，按「其他資訊 → 仍要執行」。
2. 按 <kbd>Win</kbd> + <kbd>空白鍵</kbd> 切換到「混打注音」。

安裝程式已經包含所需的一切（輸入法框架、Node.js 執行環境），不用另外安裝 PIME。需要 64 位元的 Windows 10 或 11（x64 或 ARM64）。

- 輸入法框架是 [PIME](https://github.com/EasyIME/PIME) 改名後自行編譯的版本，可以和 PIME 同時安裝；原始碼與修改紀錄在 [`windows/pime`](windows/pime/UPSTREAM.md)。
- 如果之前裝過 PIME 外掛版的混打注音，新版安裝時會自動把它從 PIME 移除，使用者詞庫、設定和學習紀錄會從 `%APPDATA%\PIME\mixzhuyin` 複製到新的 `%APPDATA%\MixZhuyin`。
- 解除安裝會保留 `%APPDATA%\MixZhuyin` 裡的資料。

偏好設定在工作列輸入法圖示的右鍵選單 →「偏好設定」。選字窗可以選字型（預設微軟正黑體）、字體大小、直排或橫排，設定頁有即時預覽。選字窗會跟著 Windows 的淺色／深色模式變換；開啟「高對比」時改用系統配色。

## 操作

| 按鍵 | 功能 |
| --- | --- |
| 直接打 | 中文、英文自動判斷 |
| <kbd>Enter</kbd> | 送出 |
| <kbd>↓</kbd> | 選字（也可以選「改成英文／中文」）。要換的字在組字區會加粗底線，選字窗從目前用的字開始，再按 <kbd>↓</kbd> <kbd>↑</kbd> 逐項移動 |
| <kbd>←</kbd> <kbd>→</kbd> | 在組字區移動 |
| 單按 <kbd>Shift</kbd> | 組字中：把游標所在那段中英互換（數字和注音也能互換，例如 103 ↔ 版）；沒有組字時：切換英文模式 |
| <kbd>Tab</kbd> 或 <kbd>→</kbd>（在最後） | 接受英文單字預測 |
| 密碼欄 | 輸入法自動停用，只打英文和數字 |
| 打太快多按一個鍵 | 兩個注音之間多出來的鍵會自動刪掉（可在設定關閉） |
| <kbd>`</kbd> 再按空白鍵 | 叫出快捷文字本（常用的地址、簽名等），用數字鍵或 Enter 選；在輸入法選單「編輯快捷文字本」新增 |
| 選取文字後連按兩下 <kbd>Ctrl</kbd> | 框選查詢：顯示中文的注音和英文意思，或英文單字的中文意思 |
| 組字時 <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | AI 修正整句（需在設定開啟「使用 AI 助手」） |
| 框選查詢後 <kbd>Ctrl</kbd>+<kbd>E</kbd>／<kbd>Ctrl</kbd>+<kbd>R</kbd> | AI 解釋／AI 改寫；改寫後按 <kbd>Enter</kbd> 取代選取的文字 |
| 數字鍵盤 | 打出來的一定是數字 |

上排數字也是注音鍵。整串數字剛好拼成有聲調的注音、而且打在最後時（例如 103 = ㄅㄢˇ），會當成中文；後面接空白或其他字時（103 年）則當成數字。按 Shift 互換後送出，下次同樣的數字會照你上次的選擇。

中文與英文、數字之間會自動加半形空白（可在設定關閉）。

### AI 助手（本機＋你自己的雲端）

AI 功能預設關閉，只有按 Ctrl+Enter、Ctrl+E、Ctrl+R 時才會問 AI，密碼欄永遠不會。每個功能可以各自選用本機或雲端，例如修正整句用本機、解釋和改寫用雲端。

- **本機 AI**：安裝 [Ollama](https://ollama.com)，下載中文模型（`ollama pull qwen2.5:7b`）。文字不會離開電腦，也不用額度。沒有獨立顯示卡時每次約 10 秒，模型閒置後第一次要多等約 20 秒載入；回答若是簡體字會自動轉成正體。
- **雲端 AI**：可選 Claude、OpenAI、Google Gemini，或任何 OpenAI 相容的服務，用你自己的 API 金鑰，費用由你的帳號支付。金鑰用 Windows DPAPI 加密存在這台電腦，設定檔裡沒有明碼，只有你的 Windows 帳號解得開。

設定：偏好設定 →「AI 助手」打開，再到「本機 AI」「雲端 AI」兩區填模型和金鑰。

不想花錢：

- 本機 AI 完全免費。
- Google Gemini API 有免費方案：到 Google AI Studio 用 Google 帳號建立金鑰，在「雲端 AI」選 Google Gemini 貼上即可。免費方案送出的內容 Google 可能用來改進產品，機密文字別用；免費額度也可能調整。
- ChatGPT、Claude、Gemini 的免費網頁版和 App 沒有給程式用的 API，無法串接。Claude 和 OpenAI 的 API 要另外儲值，跟聊天方案（Plus、Pro）分開計費。

建議：常用的「修正整句」用本機，偶爾用的「解釋」「改寫」用 Gemini 免費方案。

### 從微軟注音搬過來

輸入法選單 →「匯入微軟注音詞彙…」，選微軟注音匯出的檔案：「使用者造詞工具」匯出的 `.txt`，或設定頁「使用者定義的片語」匯出的 `.dat`。詞會加進使用者詞庫；檔案裡沒有注音的詞，會用詞庫查出讀音（查不到的會略過，完成後會告訴你加了幾個、略過幾個）。

## 判斷準確度

測試集是 146 句純中文、純英文與中英混合句（[`testdata/sentences.json`](src/MixedInput/testdata/sentences.json)），在各鍵盤配置下打出來後檢查中英判斷：

| 鍵盤配置 | 判斷正確 |
| --- | --- |
| 大千（標準） | 146 / 146 |
| 許氏 | 145 / 146 |
| IBM | 145 / 146 |
| 倚天 | 144 / 146 |
| 倚天 26 鍵 | 144 / 146 |

漢語拼音配置目前不支援混打模式（會自動改用一般模式）。

## 開發

```sh
npm ci
npm test              # 單元測試
npm run build         # 網頁範例 output/example
npm run build:pime    # Windows（PIME）版 output/pime
```

## 授權

程式碼採 MIT 授權，與小麥注音相同。英文詞頻資料 `src/MixedInput/EnglishData.ts` 衍生自 wordfreq、語言模型資料 `src/MixedInput/BigramData.ts` 衍生自維基百科與 Traditional Chinese C4，這兩個資料檔採 CC BY-SA 4.0。詳見 [NOTICE.md](NOTICE.md)。

小麥注音原本的說明文件見 [README.upstream.md](README.upstream.md)。
