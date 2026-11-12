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

中文部分判斷完之後，會再用「詞與詞相鄰的機率」把整段重新選一次字，例如「記得帶傘」不會被選成「記得代傘」。模型是詞的二元語法（bigram），在本機計算、不連網，每句約 1–2 毫秒。

- 訓練語料：中文維基百科 1.5 億字＋繁體中文網頁語料（Traditional Chinese C4）3 億字，用 OpenCC 轉成台灣正體用語，以小麥注音的詞庫斷詞。
- 模型大小：30 萬組詞對，約 3 MB。
- 訓練方式：GitHub Actions 的「Train language model」工作流程（[`tools/mixed/train_bigram.py`](tools/mixed/train_bigram.py)），訓練完會自動評估並推到 `lm/bigram-<編號>` 分支。

在 2,000 句沒參與訓練的句子上（純注音輸入、大千配置）的結果：

| 測試句 | 只用詞頻（小麥注音原本） | 加上語言模型 |
| --- | --- | --- |
| 維基百科 1,000 句：字正確率 | 91.8% | 93.8% |
| 維基百科 1,000 句：整句全對 | 58.5% | 67.9% |
| 網頁文字 1,000 句：字正確率 | 89.6% | 92.1% |
| 網頁文字 1,000 句：整句全對 | 48.2% | 59.5% |
| 日常混打 146 句：整句全對 | 141 | 144 |

> 給譯者／詞庫維護者：`src/MixedInput/BigramData.ts` 是訓練產生的資料，請不要手改；要更新就重新跑訓練流程。它只影響混打模式的選字順序，不改變小麥注音詞庫本身。

## 操作

| 按鍵 | 功能 |
| --- | --- |
| 直接打 | 中文、英文自動判斷 |
| <kbd>Enter</kbd> | 送出 |
| <kbd>↓</kbd> | 選字（也可以選「改成英文／中文」） |
| <kbd>←</kbd> <kbd>→</kbd> | 在組字區移動 |
| 單按 <kbd>Shift</kbd> | 組字中：把游標所在那段中英互換；沒有組字時：切換英文模式 |
| <kbd>Tab</kbd> | 接受英文單字預測 |
| 數字鍵盤 | 打出來的一定是數字 |

中文與英文、數字之間會自動加半形空白（可在設定關閉）。

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
