# Echo Ledger

**Filter the echo. Record the signal.**

> **Lineage.** This repository continues [Echo Ledger](https://github.com/nguyenkhangph/echo-ledger), submitted to the BLI Legal Tech Hackathon 2 (October 2026). The full history is kept so the work added for the RYO-CHAN hackathon is visible commit by commit.

**[RYO-CHAN demo video (3:53)](https://youtu.be/eYvjbwHupcM)** ([Drive copy](https://drive.google.com/file/d/1D_y6W7nk9LCdFiBFggqeuTshUIk3IZqv/view?usp=sharing)) · **[Live dashboard](https://www.echoledger.shop)** ([RYO check](https://www.echoledger.shop/ryo) · [for judges](https://www.echoledger.shop/judge)) · BLI-round site: [echoledger.fun](https://www.echoledger.fun) ([BLI video](https://youtu.be/UW116HZeuKU)) · **[Contract on Sepolia](https://sepolia.etherscan.io/address/0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0)** ([source verified on Sourcify](https://repo.sourcify.dev/11155111/0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0))

Echo Ledger is an AI agent that watches public crypto voices (KOLs), works out which of them are saying something *independently* and which are just repeating someone else, checks the claim against market data, argues it out in a bull/bear/judge debate, and then opens a **practice** position. Every decision produces a *reasoning card*, and the card's hash, the settlement and the resulting change in each source's trust score are written to Ethereum Sepolia by **Chainlink CRE** workflows.

The point is accountability: anyone can recompute a card's hash from its contents and check it against the chain, and every source's track record is public and cannot be edited after the fact.

> Practice positions only. No real capital, no exchange keys, not financial advice.

---

![How a decision becomes evidence](docs/img/architecture.png)

## RYO-CHAN Hackathon 2026 entry

**Tracks:** Track 1 (Agents and strategy), Track 2 (Dashboards and interfaces) and Track 3 (New skills: `narrative_independence`, `stale_call`). **Demo video:** [https://youtu.be/eYvjbwHupcM](https://youtu.be/eYvjbwHupcM). **Pages for judges:** [`/ryo`](https://www.echoledger.shop/ryo) (the RYO check) and [`/judge`](https://www.echoledger.shop/judge) (each criterion with a link); locally: `bun run dashboard:dev`.

> **Note for judges: why the RYO calls show 429.** Our RYO key was issued with its call allowance switched off: `whoami` reports `call_limit 200, used 0, remaining 200, allowed: false`. We did not use up any quota; every tool call was refused with `429 RATE_LIMITED "MCP call allowance exhausted"` from the first request, and we reported this to RYO. The real refusals are committed as evidence (`fixtures/ryo/samples/`, `fixtures/ryo/runs/`), and the agent decided nothing it could not back. The decision logic is exercised against RYO's published envelope by the tests and the 26-case eval; once the key is enabled, `bun run ryo:run` produces live decisions with no code change.

**User and decision.** Someone who follows crypto KOLs and has to decide whether a narrative is worth acting on. The decision: is this independent agreement backed by the market, or one opinion echoed many times?

**What is new in this round.** Echo Ledger already folded reposts into the voice they repeat. It now asks RYO-CHAN's research layer whether the independent voices are backed by the market, and decides only from RYO's structured `data`:

| RYO tool | Called | Used for |
|---|---|---|
| `market_overview` | once per run | market risk regime; raises the independence bar from 0.60 to 0.67 when tense, vetoes when high |
| `monitor_market_sentiment_shift` | once per run | reversal alarm: vetoes a call against a turning sentiment regime |
| `scan_market` | once per run | RYO first: which tokens RYO ranks, and which KOLs named them independently or only echoed |
| `deep_analysis` | per narrative with an independent voice | price, 24 h change, RYO's verdict (does it back the KOLs?), RSI(14) (is the call late?), ATR(14) (stop distance), listed risks (safety: a severe risk vetoes; no risk list means safety not verified, so nothing opens) |
| `compare_tokens` | per narrative | the token against BTC and a fixed same-sector peer; weaker than its basket means no entry |
| `analyze_token` | per narrative; again at the 24 h horizon | second reading of the same token: must agree with `deep_analysis` on direction and on price within 1% or the call is rejected; fallback for price/direction/RSI/ATR when `deep_analysis` is down; the price at the horizon for settlement |

**Rules (all in code, [`shared/src/ryo/`](shared/src/ryo)):**
- Every RYO response becomes numbered evidence (E1, E2, …) with a keccak256 of its payload. Every gate, claim and price level on a card cites its evidence id and the payload path, e.g. `E4 data.market.price`.
- Only `status: ok` with `data_mode: live` counts as live. `partial`, `unavailable`, `mixed`, `simulated` and `unknown` are recorded as such and never used as numbers; a missing measurement is never turned into zero.
- KOL words are claims: each voice is marked *corroborated*, *unconfirmed* (not a buy signal) or *contradicted* by RYO. A crowd calling up while RYO reads down is rejected in public.
- A token RYO does not cover is *not analysable*; nothing is invented for it.
- Practice levels are computed in code from RYO's live price: stop = 1.5 × ATR(14) clamped to 2–8%, target = 2R, size ≤ 5%. No language model writes a level. No real money.
- After 24 h, `bun run ryo:settle` reads RYO's price again and scores each KOL call right or wrong by direction (±0.25% is flat): trust +2.5 / −2.5, and −2.5 more for an echo. The *source validity* table on `/ryo` ranks sources by outcome, never by followers.
- Decisions are pure functions of the stored evidence: `bun run ryo:replay` (or the Replay button) recomputes each decision with the same hash, without calling RYO.

**Coping with failure.** RYO calls back off with jitter on 429/503/network errors and honour `Retry-After`; invalid arguments are not retried; a client-side throttle stays under the key's per-minute limit; the key is redacted from every log and file. This was tested for real: our key was issued with `call_allowance.allowed: false` (0 of 200 used), so every tool call returned `429 RATE_LIMITED "MCP call allowance exhausted"`. The agent recorded those refusals as evidence and produced *Missing evidence* rather than numbers. See [`fixtures/ryo/`](fixtures/ryo).

**Run it**

```bash
bun install
cp .env.example .env                 # set RYO_MCP_KEY (and LLM_* for extraction); never commit .env
bun run ryo:whoami                   # key, quota and catalog; spends no tool calls
bun run --cwd agent ingest           # read public posts → fixtures/posts
bun run --cwd agent extract          # LLM: one structured call per post → fixtures/extracted
bun run --cwd agent converge         # fold echoes, score independence → fixtures/candidates
bun run ryo:run                      # RYO stage → fixtures/ryo/runs/<run>.json
bun run ryo:replay                   # same decisions, same hashes, no RYO call
bun run ryo:recheck --token SOL      # call deep_analysis + analyze_token again, record before/after on the card
bun run ryo:settle                   # after 24 h: RYO price at the horizon, right/wrong per KOL, trust moves
bun run skills:serve                 # Track 3 skills on http://localhost:8790
bun run dashboard:dev                # /ryo and /judge
```

Tests: `bun test` (agent, shared, RYO client and stage with a fake RYO server), `bun run ryo:eval` (26 cases: pure echo, echo-made majority, split sources, KOL vs RYO, high/medium market risk, late call, weaker than BTC or peer, risk flagged, outside the catalog, tool down, partial, simulated, overview down, sentiment reversal, a short, the two RYO tools agreeing / disagreeing / quoting prices 3% apart, two finfluencer cases, a fabricated number in the debate; reports accuracy and invented-number rate), `bun run verify` (re-derives the on-chain ledger).

### Track 3: two new skills in RYO's tool format

RYO measures the market. Nothing in RYO measures **whether the people talking about a token are independent of each other**, or **how stale a call already is**. Echo Ledger adds both as research tools that follow the RYO Builder MCP Guide's public response contract exactly: every result is the envelope `schema_version, tool, status (ok | partial | unavailable), data_mode, as_of, request, data, summary, availability, warnings`, logic lives in `data`, and a missing measurement is `null`, never `0`. Code: [`shared/src/ryo/skills/`](shared/src/ryo/skills).

| Skill | Input | Returns in `data` | Degrades to |
|---|---|---|---|
| `narrative_independence` | `symbol`, `posts[]` (id, handle, sentiment, posted_at, echo_of / is_echo, text), optional `market_risk` | independent vs naive agreement and whether each passes the bar (0.60, or 0.67 when `market_risk` is medium), echo ratio, originators, echo clusters (declared, near-duplicate text, same account) with lag, pivotal voices, timeline | `partial` when posts lack a sentiment (excluded and listed) or a timestamp; `unavailable` with no posts |
| `stale_call` | `symbol`, `side` (long \| short), `posted_at` | 0–100 score and `fresh / aging / stale / invalidated` from three published components: age (0 at 2 h → 100 at 48 h, weight 0.40), move already made in the call's direction vs 1.5 × ATR% (0.35), RSI(14) in the call's direction (0.25); the RYO evidence paths used | `partial`, age only, when RYO's `analyze_token` is not live; `unavailable` on invalid arguments |

Served like RYO's own tools (`bun run skills:serve`): `GET /tools` (definitions with `inputSchema`), `POST /tools/{name}/call` → `{"result": envelope}`, and MCP JSON-RPC at `POST /mcp` (`initialize`, `tools/list`, `tools/call` with the envelope as text content). `narrative_independence` needs no key; `stale_call` uses the server's own `RYO_MCP_KEY` for `analyze_token`.

```bash
curl -s localhost:8790/tools/narrative_independence/call -d '{"symbol":"SOL","market_risk":"low","posts":[
  {"id":"1","handle":"alpha","sentiment":"bullish","posted_at":"2026-11-10T00:00:00Z","text":"SOL breaking out above 150"},
  {"id":"2","handle":"beta","sentiment":"bullish","posted_at":"2026-11-10T01:00:00Z","echo_of":"1"},
  {"id":"3","handle":"gamma","sentiment":"bearish","posted_at":"2026-11-10T02:00:00Z"}]}' | jq .result.data.independent
```

The RYO stage runs both skills on every narrative (stale_call on each original call, from the same RYO evidence, so no extra calls) and shows them under the voices on each card.

**Finfluencer case.** `/ryo` shows two eval cases decided by the same rules as live runs: one account promotes a token and four repost it while RYO sees no direction (rejected), and a loud consensus with RYO evidence missing (not decided). Illustrative only; not legal advice and no finding about any real person.

**Disclosures.** Code was written during the event window (from 18 August 2026); the Echo Ledger base was built in October 2026 for the BLI Legal Tech Hackathon 2 and is kept with its full history. Libraries: Bun, TypeScript, React, Vite, viem, zod, Foundry/forge-std, Chainlink CRE SDK. Market research comes only from RYO-CHAN; KOL posts are public posts (see *Data sources and content use*). Nothing on the RYO pages is placeholder or simulated: they render only runs recorded from the live RYO endpoint. One older practice position on the BLI ledger (SOL, 26 Oct) was recorded from a pipeline test card whose two sources, `alice-crypto` and `block-research`, are fictional test handles, not real KOLs; it is a real Sepolia transaction but not a real narrative, and is labelled here so it is not mistaken for one.

---

## BLI round: judge's 3-minute path

1. **Open [echoledger.fun](https://www.echoledger.fun).** The four numbers under the headline (practice PnL, audit checks, decisions, trust updates) are read from Sepolia and re-derived in your browser.
2. **Echo Graph:** it opens on BTC, 26 Oct. A bot that counts reposts scores 0.67 and trades; Echo Ledger discounts the echo, scores 0.50 and holds back.
3. **Chainlink CRE section:** three workflows (HTTP → record, Cron → settle, EVM log → reputation), with live report counts and the latest transaction of each.
4. **Independent audit → Try to tamper:** turn a loss into a win or inflate a trust score in a private copy of the data and watch the checks fail.
5. **§ certificate** on any position: a printable Certificate of Record with the grounds for the decision, the sources relied on and the chain of custody.
6. **§ printable case file** ([echoledger.fun/casefile](https://www.echoledger.fun/casefile)): the whole record as one document for a lawyer, with third-party evidence outside the chain.
7. **Compliance map:** each feature matched to EU AI Act Art. 12/13, MiCA Art. 91 and FTC §255.5, with evidence links.
8. **Check it without us:** `bun install && bun run verify` reads the contract and re-derives everything.

### What you will see

| | |
|---|---|
| ![Echo Graph: a naive bot would trade, Echo Ledger holds back](docs/img/echo-flip.png) | ![Three Chainlink CRE workflows with live report counts](docs/img/cre-workflows.png) |
| **Echo Graph:** counting reposts gives 0.67 and a trade; discounting the echo gives 0.50 and no trade. | **Chainlink CRE:** HTTP → record, Cron → settle, EVM log → reputation, with the latest transaction of each. |
| ![Try to tamper: the audit catches an edited result](docs/img/tamper.png) | ![Certificate of Record](docs/img/certificate.jpg) |
| **Try to tamper:** turning a loss into a win in a private copy fails 3 checks at once. | **Certificate of Record:** grounds, sources, chain of custody, third-party corroboration and the verification seal. |

> If the public Sepolia RPC is slow, the site shows the bundled copy of the ledger (block and time are printed) until the live read succeeds.

---

## BLI round: how Echo Ledger met the RYO-CHAN bounty brief

The bounty asks for an autonomous agent that **combines many sources of information** and **handles failure** instead of breaking or guessing. Both are central to Echo Ledger, and each claim below points to the code that does it.

### It combines many sources

- **19 public voices** on two platforms: Telegram channels read automatically every cycle, and X analysts through a manual feed ([`agent/kols.json`](agent/kols.json), [`agent/src/ingest/`](agent/src/ingest)).
- **A structured call per post:** a language model extracts token, direction, conviction and urgency, and flags paid promotions with the reason, which are then set aside ([`agent/src/extract/`](agent/src/extract)).
- **Independence, not volume:** posts that forward, quote or repeat another source are folded into the original and count for nothing; a narrative needs at least 2 independent voices and a 0.60 agreement score ([`agent/src/convergence/score.ts`](agent/src/convergence/score.ts)).
- **Market evidence** (price, volume, 24 h move from CoinGecko) is attached before the bull, bear and judge argue the case ([`agent/src/convergence/evidence.ts`](agent/src/convergence/evidence.ts), [`agent/src/debate/`](agent/src/debate)).
- **Three price sources inside Chainlink CRE:** the record workflow needs CoinGecko, Binance and Coinbase within 1% of each other; the settle workflow uses the median of at least two that agree ([`cre/record/workflow.ts`](cre/record/workflow.ts), [`cre/settle/workflow.ts`](cre/settle/workflow.ts)).
- **Memory across decisions:** every settled call rescores each source on-chain, and the dashboard already shows what a trust-weighted score would change.

### It handles failure

- **A source disappears:** an unreachable or renamed Telegram channel is skipped and logged; the cycle continues with the rest ([`agent/src/ingest/telegram.ts`](agent/src/ingest/telegram.ts)).
- **Network or API errors:** HTTP, LLM, market-data and CRE calls retry up to 3 times with exponential backoff and timeouts; permanent 4xx errors fail fast instead of looping ([`agent/src/ingest/http.ts`](agent/src/ingest/http.ts), [`agent/src/extract/llm.ts`](agent/src/extract/llm.ts), [`agent/src/submit/client.ts`](agent/src/submit/client.ts)).
- **The model answers badly:** every LLM output is schema-validated; an invalid answer gets one corrective retry, then the stage stops rather than inventing a result ([`agent/src/extract/llm.ts`](agent/src/extract/llm.ts), [`agent/src/debate/debate.ts`](agent/src/debate/debate.ts)).
- **A crash mid-cycle:** extraction results are cached as they arrive, so a rerun resumes instead of paying for the same calls; a corrupt cache line is skipped ([`agent/src/extract/extractor.ts`](agent/src/extract/extractor.ts)).
- **The same story keeps growing:** a replay guard allows one decision per token per horizon ([`agent/src/submit/replay-guard.ts`](agent/src/submit/replay-guard.ts)).
- **Price sources disagree or time out:** the record workflow rejects the decision (reason code 1002); the settle workflow treats a timed-out source as unavailable and settles on two that agree.
- **Too much exposure:** the risk gate caps size at 5% and limits open positions. In the live run it rejected two decisions on-chain with reason code 1004; a stop closes any position at 8%.
- **Stale or duplicate writes:** settle re-reads a position at the latest block before writing, and the contract refuses duplicate positions and duplicate trust updates.
- **The dashboard's RPC is down:** it tries a second public RPC, then shows the bundled snapshot with its block number.
- **Someone edits the record:** `bun run verify` and the in-browser audit re-derive everything and fail loudly; the "Try to tamper" panel demonstrates it.

Several of these happened for real during the live run; the [lessons](#lessons-from-the-live-run) describe each one and how it was fixed.

**What still needs a person:** X posts are added by hand to `agent/manual_posts.json`, the processes are started by an operator, and because CRE runs in local simulation the settle cron is driven by a loop script. Everything from a fetched post to the on-chain trust update runs without intervention.

---

## For lawyers: a record you can print and check elsewhere

- **[Case File](https://www.echoledger.fun/casefile):** the whole record as one printable document: summary, index of decisions with their grounds, each source's track record, the audit result, the rules applied and a SHA-256 fingerprint of the data it was built from.
- **Certificate of Record** (`/record/<positionId>`): one decision with its particulars, grounds, sources, chain of custody and verification seal.
- **Evidence outside the chain:** each certificate and the case file compare every on-chain price with Binance's own public 1-minute candle for that minute (checked live in the browser, with the link to the exchange record), link the original public posts the agent relied on, and point to the verified contract source on Sourcify and the code on GitHub. None of these depend on Ethereum, Chainlink or us.

---

## On-chain proof (Ethereum Sepolia)

Contract **EchoLedger** [`0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0`](https://sepolia.etherscan.io/address/0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0), written through the CRE simulation forwarder `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`.

### A live decision from real sources

The agent read public Telegram channels, found an independent bullish BTC narrative, debated it and opened a practice long. Each step below was written by a different CRE workflow:

| Step | CRE workflow (trigger) | Transaction | Result |
| --- | --- | --- | --- |
| Open | `record` (HTTP, posted by the agent) | [`0xba6549…683b`](https://sepolia.etherscan.io/tx/0xba6549c2fb6f5ded676ed5d15df1b185c6685b150998475d9484592e71ea683b) | `PositionOpened`: BTC long (block 12004347, 27 Oct) |
| Settle | `settle` (cron) | [`0xd7c1b6…b362`](https://sepolia.etherscan.io/tx/0xd7c1b6ebafaf4a271d8af6b63fc03db1ec3d870d17b496d54ed7f1853a30b362) | `PositionSettled` at the 24 h horizon, **+234 bps** (block 12011543, 28 Oct) |
| Trust update | `reputation` (EVM log) | [`0xa452f5…2f28`](https://sepolia.etherscan.io/tx/0xa452f537347113d5c0bd61b9716bbbdcce94df3a8779cc5c1837884750ef2f28) | `TrustUpdated`, 5000 → 5250, for the four sources behind the call: Wu Blockchain, Glassnode, The Daily Hodl and CryptoQuant (block 12011544, the next block) |

All live decisions so far (every one is a BTC call from real Telegram sources):

| Opened | Decision | Open tx | Settle tx | Result | Trust update |
| --- | --- | --- | --- | --- | --- |
| 27 Oct, block 12004347 | APPROVE, long 2.5 % | [`0xba6549…683b`](https://sepolia.etherscan.io/tx/0xba6549c2fb6f5ded676ed5d15df1b185c6685b150998475d9484592e71ea683b) | [`0xd7c1b6…b362`](https://sepolia.etherscan.io/tx/0xd7c1b6ebafaf4a271d8af6b63fc03db1ec3d870d17b496d54ed7f1853a30b362) | **+234 bps** | [`0xa452f5…2f28`](https://sepolia.etherscan.io/tx/0xa452f537347113d5c0bd61b9716bbbdcce94df3a8779cc5c1837884750ef2f28) |
| 27 Oct, block 12004747 | APPROVE, long 3 % | [`0xcaecb7…8da8`](https://sepolia.etherscan.io/tx/0xcaecb75332aeffed6dea3619d88f26e72b8d4c779d72be8fa19868e7a58c8da8) | [`0x244a07…6bdf`](https://sepolia.etherscan.io/tx/0x244a07b66d3551ff462cebd673abcf55b6a7931a576a6a8fe6669ca167a66bdf) | **+169 bps** | [`0xbf4d5d…e6ae`](https://sepolia.etherscan.io/tx/0xbf4d5d6f4d0c1eecbb527e0e34dc8b2621b114bf97e1678844b6324b60d0e6ae) |
| 27 Oct, block 12005491 | APPROVE, long 3 % | [`0x35e13f…a1b8`](https://sepolia.etherscan.io/tx/0x35e13fe9a8db5fddd11725cbcb8e46700e7780e688640f76df625bb26052a1b8) | [`0x115336…db34`](https://sepolia.etherscan.io/tx/0x115336607aa8bf14f8d6f63b218e42c0417a89acad131f85fc07da93febddb34) | **+72 bps** | [`0x9e95d3…7caf`](https://sepolia.etherscan.io/tx/0x9e95d32305a8fe72165a82016c0cc86073ab8cafc0b4522c863782dad4d67caf) |
| 27 Oct, block 12005688 | REJECT | [`0xacc7f8…788c`](https://sepolia.etherscan.io/tx/0xacc7f8d2ad91a15648260c829beeb94c089e5b888c6822d6a4f89c46e0e0788c) | | recorded, no position | |
| 27 Oct, block 12006794 | REJECT | [`0xdd9baf…f35e`](https://sepolia.etherscan.io/tx/0xdd9baf845a2fc5702ab754b80344b2bad0f46f7d14eb00de8c3f61b6ed21f35e) | | recorded, no position | |
| 28 Oct, block 12014014 | APPROVE, long 2.5 % | [`0x31fc06…7430`](https://sepolia.etherscan.io/tx/0x31fc0653d8ec294c7929e3e5da034b67bb408135a7e78c7b7c54355501de7430) | | open at time of writing | |

After three settled wins, Glassnode, The Daily Hodl and CryptoQuant stand at 5750 trust and Wu Blockchain at 5500.

The first five rows exposed a real flaw: every new post joining the same BTC narrative changed its source set and looked like a new signal, so one story opened three positions before the `max_open` limit stopped it, and the next two attempts, made while those three positions were still open, were recorded as REJECT. The agent now allows one decision per token per horizon (see [Lessons from the live run](#lessons-from-the-live-run)); the sixth decision came only after the previous BTC decision's 24 h horizon had passed. The extra positions stay on chain as recorded.

### Pipeline verification run

Before the live run, one fixture card was pushed through all three workflows to prove the on-chain path:

| Step | CRE workflow (trigger) | Transaction | Result |
| --- | --- | --- | --- |
| Open | `record` (HTTP) | [`0x0e7299…a62d`](https://sepolia.etherscan.io/tx/0x0e729f4a7b02a3f4688bb37f92775992af29dce3423c1611f883951a2219a62d) | `PositionOpened`: SOL, long, APPROVE |
| Settle | `settle` (cron) | [`0x38efa1…eca09`](https://sepolia.etherscan.io/tx/0x38efa182cb2775e6b8e8d51173884d6496adac2f96b81538505f28581c3eca09) | `PositionSettled` at the 24 h horizon, **−81 bps** (block 12002764) |
| Trust update | `reputation` (EVM log) | [`0x7b7459…8ec7b`](https://sepolia.etherscan.io/tx/0x7b7459824750fa355af5c05fe4cdc50559bb0f5b14e1acf202006f627018ec7b) | `TrustUpdated` for both sources, 5000 → 4750 (block 12002765) |

This card is the repository fixture `card-sol-approve-001`; its two sources (`alice-crypto`, `block-research`) are fictional. The transactions, the price-based settlement and the trust penalty are real.

The dashboard reads all of this straight from the contract (no indexer, no backend): the **On-chain ledger** section on the Radar page, the live Scorecard, and a hash check on every reasoning card page that turns green when the locally computed card hash matches a `PositionOpened` event.

---

## How it works

```mermaid
flowchart LR
  subgraph Agent [Agent pipeline, Bun + LLM]
    A1[A1 Ingest<br/>Telegram previews + X posts] --> A2[A2 Extract<br/>token, direction, conviction<br/>sponsored-post filter]
    A2 --> A3[A3 Converge<br/>independent vs echo]
    A3 --> A4[A4 Debate<br/>bull, bear, judge + risk rules]
    A4 --> A5[A5 Submit<br/>canonical card hash, replay guard]
  end
  A5 -- HTTP POST --> R[CRE record<br/>HTTP trigger]
  R -- OPEN report --> L[(EchoLedger<br/>Sepolia)]
  S[CRE settle<br/>cron trigger<br/>3-source median price] -- SETTLE report --> L
  L -- PositionSettled log --> P[CRE reputation<br/>EVM log trigger]
  P -- TRUST_UPDATE report --> L
  L --> D[Dashboard<br/>reads events + views]
```

**1. Ingest (A1).** Public Telegram channels are read from their `t.me/s/<channel>` previews; X posts are added to `agent/manual_posts.json` (there is no X API client). Forwards, quotes and replies keep a pointer to the post they reference. A channel that fails to load is skipped with a warning instead of stopping the run.

**2. Extract (A2).** An LLM (any OpenAI-compatible endpoint) turns each post into a structured signal: token, bullish/bearish, conviction, timeframe. Paid promotion is caught by a deterministic guard (disclosure tags, or a bullish push combined with a referral code and a call to action) on top of the LLM's own judgement. Filtered posts are not silently dropped: they go to `fixtures/extraction-audit/` with the reason. Results are cached per post, so each post is extracted once.

**3. Converge (A3).** Signals are grouped by token and direction. A post that quotes, forwards or explicitly attributes another source is an **echo**: it is shown, but it never counts towards the score. A token passes only with a convergence score of at least 0.6 **and** at least two independent sources.

**4. Debate (A4).** A bull, a bear and a judge argue over the evidence (lead time versus price, volume, price agreement across sources). Deterministic risk rules (minimum market cap, maximum open positions, position size) are recorded alongside the verdict as APPROVE, CONSTRAIN or REJECT.

**5. Submit (A5).** The card is serialised canonically and hashed (`shared/src/hash.ts`), deduplicated by signal identity so a restart cannot open the same call twice, and posted to the CRE `record` workflow. Without `CRE_RECORD_URL` this step is a dry run.

**6. Settle and score.** The `settle` workflow checks each open position against a median of CoinGecko, Coinbase and Binance prices and closes it at the 24 h horizon or an 8 % stop loss. The `reputation` workflow reacts to each `PositionSettled` log and moves the trust score of every source in that position up on a win and down on a loss. A source flagged as an echo takes an extra penalty: it never gains from a winning call and loses twice as much on a losing one, so repeating other people cannot build a track record.

---

## Chainlink CRE

Three TypeScript workflows in [`cre/`](cre/), built and run with CRE CLI v1.39.0:

| Workflow | Trigger | Writes | Notes |
| --- | --- | --- | --- |
| [`record`](cre/record/) | HTTP | OPEN report (type 0) | Re-checks the card hash, runs the risk gate against live prices, records APPROVE / CONSTRAIN / REJECT. REJECT is stored for audit but never becomes an open position. |
| [`settle`](cre/settle/) | Cron | SETTLE report (type 1) | Reads `openPositionIds`, prices each token from three sources, settles on horizon or stop loss. A `HOLD` performs no write. |
| [`reputation`](cre/reputation/) | EVM log (`PositionSettled`, finalized) | TRUST_UPDATE report (type 2) | Batched update for every source of the settled position. |

All reports go through `writeReport` to `EchoLedger.onReport` (`ReceiverTemplate` / `IReceiver`).

Two lessons from running this for real, both now covered by code and tests:

- **A successful transaction is not a delivered report.** The first broadcast succeeded at the transaction level, but the forwarder emitted `ReportProcessed(success=false)`: the receiver call had run out of gas, and the ledger was unchanged. Tracing the transaction and replaying it with more gas found the cause. Every workflow now checks `receiverContractExecutionStatus` as well as the transaction status and fails loudly if the receiver reverted.
- **Gas limits come from measurements, not guesses.** Foundry tests with the worst case of 20 sources measure 3.54 M gas for OPEN, 0.43 M for SETTLE and 6.89 M for TRUST_UPDATE. The workflow configs use 5 M, 750 k and 9.5 M.

### Why local simulation and not a deployed DON

Chainlink told us directly that deploying CRE workflows to a testnet or mainnet DON currently requires a commercial agreement with them, and that local simulation is the intended path for hackathon projects. The workflows therefore run with `cre workflow simulate … --broadcast`: the same workflow code, compiled to WASM and executed by the CRE simulator, writing real reports to Sepolia through the simulation forwarder. `record` and `reputation` run as persistent `--listen` processes; `settle` is driven by an operator loop because the simulator executes a cron trigger once per invocation. The full operating procedure is in [`cre/LIVE_RUN.md`](cre/LIVE_RUN.md).

---

## Verify it yourself

Do not trust the dashboard, replay it. One command reads the public Sepolia ledger and re-derives the track record with the same rules the contract and the CRE workflows use:

```bash
bun install
bun run verify                       # live read of the Sepolia ledger
bun run verify --snapshot shared/test/fixtures/ledger-snapshot.json   # the recorded live run, offline
```

It checks, for every decision:

- **Profit and loss** is recomputed from entry and exit price (signed by side, truncated toward zero like the contract).
- **Horizon:** a position closes after 24 h, or earlier only at the 8% stop.
- **Risk:** no opened position is larger than 5%; a REJECT never opens or settles.
- **Reputation:** every `TrustUpdated` event is replayed (+250 on a win, −250 on a loss, −250 more for an echo, clamped) and must equal the score on chain, and the final score and trade count of each source must equal what the contract stores.
- **Timing:** a trust update follows each settlement within 30 minutes.

It exits with code 1 if any check fails. The dashboard runs the same code in the browser:

- **Independent audit** panel with a **Try to tamper** control: edit a private copy of the chain data (turn a loss into a win, inflate a trust score, hide an oversized bet, close a trade early) and watch which checks catch it.
- **Certificate of Record** for every decision (`/record/<positionId>`): particulars, sources relied upon, chain of custody from card hash to trust update, the verification result and a SHA-256 fingerprint of the proof pack. It prints to PDF.
- **Proof pack** download per position: the on-chain record plus the re-derived checks, hashed.
- **Grounds for every decision:** the reason code the CRE risk gate stored (e.g. `1002` price sources disagreed by more than 1%, `1005` the judge decided not to trade) is shown on the ledger and the certificate, and the audit checks that it matches the attestation.
- **Compliance map:** each feature matched to the rule it answers (EU AI Act Art. 12 and 13, MiCA Art. 91(2)(c) and 91(3)(c), FTC 16 CFR §255.5) with a link to the evidence. Illustrative, not legal advice.
- **Composable reputation:** a Solidity and viem snippet for reading `kolTrust` from any contract or agent.
- **Naive vs Echo Ledger** on the Echo Graph: what a bot that counts every repost would have scored, next to the independent-only score. The CI workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs typecheck, tests, the audit on the recorded run, the dashboard build and the contract tests; the same steps run locally with `bun run typecheck && bun test && bun run verify --snapshot shared/test/fixtures/ledger-snapshot.json && bun run dashboard:build` and `cd contracts && forge test`.

---

## Live run

The agent and all three workflows were run continuously against Sepolia from 26 Oct 2026 (local simulation, five terminals, see [`cre/LIVE_RUN.md`](cre/LIVE_RUN.md)). The watchlist in [`agent/kols.json`](agent/kols.json) holds 19 sources:

- **Telegram, fully automated:** WatcherGuru, Cointelegraph, Wu Blockchain, Lookonchain, The Daily Hodl, CryptoQuant, Glassnode, DaanCrypto, BitcoinBullets.
- **X, via `manual_posts.json`:** TedPillows, AltcoinSherpa, KillaXBT, Morecryptoonl, ZordXBT, CryptoAnup, Ali Martinez, Rekt Capital, and two Vietnamese-language analysts.

The list deliberately mixes large accounts that are often repeated with small independent ones that cover the same tokens, which is exactly where echo detection matters. In the first hours on real data, the agent extracted bearish calls on HYPE and ETH and flagged a bullish BTC post as an echo of another account, so it did not count towards convergence. The next day a bullish BTC narrative passed convergence with independent sources; the resulting position settled at +234 bps and raised the trust of the four sources behind it (see [On-chain proof](#a-live-decision-from-real-sources)).

---

## Lessons from the live run

Running the system for real against Sepolia surfaced problems no test had caught. Each is fixed in code, and all but the stale-read fix (which needs the CRE runtime) have a unit test:

- **One narrative, several positions.** The replay guard keyed on the exact set of source posts, so a growing narrative looked new on every cycle. Decisions are now limited to one per token per horizon.
- **Stale reads after a settlement.** `settle` discovers open positions at the finalized block, about 15 minutes behind the head. For that window a just-settled position still looked open and was sent again; the ledger rejected it inside the forwarder call while the outer transaction succeeded. The workflow now re-checks the position at the latest block before writing.
- **Free price APIs are not always up.** Requiring all three price sources made settlement fail whenever one was rate-limited. It now settles on the median of at least two sources that agree within 1 %.
- **The agent-to-CRE hop.** The simulator's HTTP trigger listens on `/trigger` and expects `{"input": ...}`; the first live submission failed with a 404 until the client was fixed.
- **Dead sources.** The first watchlist had channels that had stopped posting, so the agent saw no posts at all. Candidate channels were then checked for posts in the last 24 hours before being added, and one unreachable channel no longer stops ingestion.

---

## Repository layout

| Path | What it is |
| --- | --- |
| [`agent/`](agent/) | Pipeline stages A1 to A5 (`src/ingest`, `extract`, `convergence`, `debate`, `submit`) and the watchlist |
| [`cre/`](cre/) | The three CRE workflows, their configs and the live-run runbook |
| [`contracts/`](contracts/) | `EchoLedger.sol` (Foundry), including worst-case gas tests |
| [`shared/`](shared/) | Reasoning-card schema, canonical hashing, fixtures, and the Sepolia reader used by the dashboard |
| [`dashboard/`](dashboard/) | Vite + React UI: Radar, reasoning cards, Scorecard |
| [`fixtures/`](fixtures/) | Pipeline inputs and outputs per day |

---

## Running it

Prerequisites: [Bun](https://bun.sh) 1.3+, [Foundry](https://getfoundry.sh), and CRE CLI v1.39.0 for the workflows.

```bash
bun install
(cd shared && bun test) && (cd agent && bun test) && (cd dashboard && bun test)
(cd contracts && forge test)  # contract tests, including worst-case gas
# CRE workflow tests: run `bun install` and then `bun test` inside cre/record, cre/settle and cre/reputation
```

**Dashboard** (reads Sepolia directly from the browser):

```bash
# dashboard/.env
VITE_LEDGER_ADDRESS=0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0
# optional: VITE_SEPOLIA_RPC_URL, VITE_LEDGER_FROM_BLOCK (defaults to the deployment block 11974596)

bun run dashboard:dev
```

If Sepolia cannot be read, the Scorecard falls back to sample data and says so in its header.

**Agent pipeline** (from `agent/`, with `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` set in `agent/.env`):

```bash
bun run ingest
bun run extract --date 2026-10-27
bun run converge --window 24
bun run debate --date 2026-10-27
bun run submit --date 2026-10-27   # dry run unless CRE_RECORD_URL is set
```

**CRE workflows:** follow [`cre/LIVE_RUN.md`](cre/LIVE_RUN.md). Any command with `--broadcast` sends real Sepolia transactions.

---

## Next

- **Second-model consensus inside CRE:** run the judge step on two independent models through CRE Confidential HTTP and record a decision only when both agree.
- **Trust-weighted convergence:** promote the shadow score (independent voices weighted by on-chain trust) from display to the decision rule once enough settlements exist.
- **Agent circuit breaker:** let the contract refuse new OPEN reports after a drawdown limit, so the guardrail sits on-chain rather than in the agent.

## Data sources and content use

Echo Ledger is a research prototype, and its data use should be read that way.

- **Telegram:** during the live run the agent read the public web previews of 9 Telegram channels (`t.me/s/<channel>`). Telegram's Terms of Service were updated in February 2026 to prohibit scraping or using its content for AI or machine-learning purposes without the explicit consent of the users concerned. A production deployment must not collect Telegram content this way; it should use only sources whose terms allow it, such as channels whose owners opt in through a bot, publisher RSS feeds, or licensed data.
- **X:** posts were added by hand to `agent/manual_posts.json`, not collected automatically.
- **What is stored and shown:** the repository keeps the posts the agent read in `fixtures/` as the audit trail of the live run. The dashboard shows excerpts with a link back to the original post; nothing is republished as a feed.
- **Swappable ingest:** sources are adapters behind one interface ([`agent/src/ingest/`](agent/src/ingest)), so a licensed source can replace a scraped one without changing extraction, convergence, debate or the on-chain record.

---

## Known limitations

- X has no automated client; X sources contribute only the posts pasted into `agent/manual_posts.json`.
- Workflows run in the CRE simulator rather than on a DON (see above).
- The `settle` cadence is an external loop, not exact wall-clock cron.
- The LLM provider is configurable; extraction quality depends on the model behind it.
