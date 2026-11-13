#!/usr/bin/env python3
"""Generates a colloquial Taiwanese Mandarin corpus with the Claude API.

Wikipedia and web text are short on everyday chat (對啊、好喔、等等我),
so the word-pair and word-triple models learn little about it. This script
asks Claude for the kind of messages people in Taiwan type every day, in
many settings, and writes one sentence per line for train_bigram.py
(--text-file).

Requirements: pip install anthropic
Environment: ANTHROPIC_API_KEY

Usage:
    python3 tools/mixed/generate_colloquial_corpus.py \
        --sentences 50000 --output colloquial.txt

Cost is bounded by --sentences (and --max-requests): each request returns
about --per-request lines.
"""

import argparse
import asyncio
import random
import re
import sys

SETTINGS = """
跟朋友用 LINE 約吃飯 | 家族群組聊天 | 跟同事討論專案進度 | 公司內部 Teams 訊息 |
跟主管請假 | 回覆客戶 email | 工程師回報 bug | IT 人員處理電腦問題 | 網購問賣家 |
叫外送、訂餐廳 | 跟房東聯絡 | 學生討論報告 | 社團活動通知 | 跟另一半聊天 |
爸媽關心小孩 | 討論旅遊行程 | 看完電影的心得 | 追劇、聊綜藝 | 打電動揪團 |
運動、健身、跑步 | 看醫生、掛號 | 天氣、颱風、停班停課 | 搭捷運、高鐵、公車 |
買車、修車、停車 | 寵物 | 煮飯、做菜 | 投資理財閒聊 | 3C 產品比較 | 職場抱怨 |
面試、找工作 | 婚禮、滿月、生日 | 搬家 | 社區管委會公告 | 學校老師跟家長聯絡 |
PTT、Dcard 留言 | 臉書貼文與留言 | 開會記錄與待辦 | 業務跟廠商議價 | 夜市與小吃 |
""".replace("\n", " ").split("|")

STYLES = [
    "很口語，像在手機上隨手打的",
    "有禮貌但不正式",
    "很短，一兩句話",
    "帶一點情緒（開心、抱怨、驚訝、無奈）",
    "夾雜台灣上班族常用的英文單字（例如 meeting、deadline、email、OK）",
    "問句和回答混在一起",
]

PROMPT = """請寫 {n} 句台灣人在「{setting}」時會打出來的訊息或句子，風格：{style}。

要求：
- 台灣正體中文與台灣用語（例如：軟體、網路、影片、計程車），不要用中國大陸用語。
- 自然的口語，可以有語助詞（啊、喔、欸、啦、耶、吧、齁、捏、嗎、呢）。
- 每句長短不同，內容不要重複，不要用編號、引號或說話者名字。
- 每行一句，只輸出句子本身。"""

CJK = re.compile(r"[㐀-鿿]")
NUMBERING = re.compile(r"^\s*(?:\d+[.、)）]|[-*•])\s*")


def clean(line):
    line = NUMBERING.sub("", line).strip().strip("「」\"'")
    if not (4 <= len(line) <= 80) or len(CJK.findall(line)) < 3:
        return None
    return line


async def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sentences", type=int, default=50000)
    ap.add_argument("--per-request", type=int, default=40)
    ap.add_argument("--max-requests", type=int, default=3000)
    ap.add_argument("--model", default="claude-haiku-5-5")
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(max_retries=5)
    rng = random.Random(args.seed)
    seen = set()
    requests = 0
    failures = 0
    lock = asyncio.Lock()

    async def worker():
        nonlocal requests, failures
        while True:
            async with lock:
                if len(seen) >= args.sentences or requests >= args.max_requests:
                    return
                requests += 1
                setting = rng.choice(SETTINGS).strip()
                style = rng.choice(STYLES)
            try:
                message = await client.messages.create(
                    model=args.model,
                    max_tokens=4000,
                    temperature=1.0,
                    messages=[{
                        "role": "user",
                        "content": PROMPT.format(n=args.per_request, setting=setting, style=style),
                    }],
                )
            except Exception as e:  # keep going; the SDK already retried
                failures += 1
                print(f"request failed: {e}", file=sys.stderr, flush=True)
                if failures > 50:
                    raise
                continue
            text = "".join(b.text for b in message.content if b.type == "text")
            async with lock:
                for raw in text.splitlines():
                    line = clean(raw)
                    if line and line not in seen:
                        seen.add(line)
                if requests % 50 == 0:
                    print(f"{requests} requests, {len(seen)} sentences", flush=True)

    await asyncio.gather(*(worker() for _ in range(args.concurrency)))
    lines = list(seen)
    rng.shuffle(lines)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write("\n".join(lines[: args.sentences]) + "\n")
    print(f"wrote {min(len(lines), args.sentences)} sentences from {requests} requests "
          f"({failures} failed) to {args.output}")


if __name__ == "__main__":
    asyncio.run(main())
