# Notices

## McBopomofoWeb

MixZhuyin is a fork of McBopomofoWeb (https://github.com/openvanilla/McBopomofoWeb),
Copyright (c) The McBopomofo Authors, released under the MIT license (see
LICENSE.txt). Its dictionary data comes from McBopomofo
(https://github.com/openvanilla/McBopomofo), also MIT licensed.

## English word frequencies

`src/MixedInput/EnglishData.ts` is derived from wordfreq
(https://github.com/rspeer/wordfreq) by Robyn Speer. The wordfreq data is
licensed under the Creative Commons Attribution-ShareAlike 4.0 license
(https://creativecommons.org/licenses/by-sa/4.0/), and so is this derived file.
Its sources include data from Wikipedia, Google Books, the Leeds Internet
Corpus, OpenSubtitles, SUBTLEX, Twitter, Reddit and the Common Crawl; see the
wordfreq README for the full list and their terms.

The file is filtered with the word list from an-array-of-english-words
(https://github.com/words/an-array-of-english-words), MIT licensed.

## Word-pair (bigram) model

`src/MixedInput/BigramData.ts` and `src/MixedInput/testdata/heldout.txt`, once
trained, are derived from:

- Chinese Wikipedia (via the wikimedia/wikipedia dataset), licensed under the
  Creative Commons Attribution-ShareAlike 4.0 license;
- Traditional Chinese C4 by Yen-Ting Lin (originally yentinglin/zh_TW_c4;
  read from the mirror https://huggingface.co/datasets/botp/yentinglin-zh_TW_c4),
  licensed under the Open Data Commons Attribution License (ODC-By), itself
  filtered from Common Crawl.

Text is converted to Taiwan Traditional Chinese with OpenCC. Because of the
Wikipedia share-alike terms, these derived files are licensed under CC BY-SA
4.0. The file header states which sources a given build used.

## Lookup dictionary

`output/pime/lookup_dict.json`, which 框選查詢 (select text, tap Ctrl twice)
shows meanings from, is derived from CC-CEDICT
(https://www.mdbg.net/chinese/dictionary?page=cc-cedict), licensed under the
Creative Commons Attribution-ShareAlike 4.0 license
(https://creativecommons.org/licenses/by-sa/4.0/), and so is this derived
file. It is built by `tools/mixed/build_lookup_dict.py` and keeps the words
McBopomofo's dictionary has.

## Mixed input code

The code under `src/MixedInput/` and the mixed-mode changes elsewhere are
released under the MIT license, like the rest of the project.
