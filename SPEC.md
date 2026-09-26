# Horos — Project Spec (Tameion Agents Hackathon)

> **Working name.** This is the handoff document for the coding agent. Read the whole file before writing code.
> Anything marked **VERIFY** must be checked against official docs before it is hardcoded.
> Scope changes go through John.

---

## 0. Context at a glance

| Item | Detail |
|---|---|
| Event | Tameion Agents Hackathon: Canteen × Circle × Arc (invite-only, online) |
| Build window | Sep 27 – Oct 10, 2026 |
| Deadline | Oct 10, 11:59 PM ET. Resubmission is allowed, so submit early |
| Required | Public GitHub repo, video demo under 3 minutes, traction answers (businesses onboarded, value moved, problems solved) |
| Encouraged | Live deployed URL. Treat it as required |
| Judging | Agentic sophistication 30% · Traction 30% · Circle tool usage 20% · Innovation 20% |
| Team | Solo (John) |
| Network | Arc Testnet during the event. Arc mainnet only after passing the gate in §10 |

---

## 1. Goal

**Hackathon goal:** place. The realistic floor is the Standout tier (10–12 teams). A Grand Prize requires real traction.
Our own estimate against the rubric: about 50 on a bad run, 61 on a realistic run, 70 if traction lands.

**Product goal:** freelancers learn which clients pay on time *before* they start work. An AI agent sets payment terms and runs collections from that knowledge.

**Success criteria by Oct 10**
- 2–3 organizations that pay multiple contributors in USDC, each with invoices flowing through Horos
- 8+ freelancers, with client overlap (the same org invoiced by 2+ freelancers)
- 30+ acknowledged invoices settled onchain, with volume reported separately for testnet and mainnet
- Every agent decision logged, signed and replayable
- One demo moment that can't be reduced to rules (see §12)

---

## 2. Pitch and positioning

**One line:** Know which clients pay late before you start the work: invoices paid on Arc build a shared payment record, and an AI agent sets your terms from it.

**Positioning rules**
- The record is a **credential for good payers**, not a blacklist. Clients who pay on time *want* it, because it helps them attract contributors.
- Recruit **clients first**: organizations that pay many contributors. One org gives you instant client overlap.
- Money only flows **in**, plus refunds of overpayments. There is no escrow, so the agent can never be tricked into paying out a claim.

---

## 3. What it does (end to end)

1. **Freelancer onboards.** A Circle wallet is created for them. They set policy bounds (§5.5) and list upcoming cash needs (rent, subcontractors, etc.).
2. **Freelancer creates an invoice** in USDC or EURC, with an amount and due date. A **unique deposit address** (a Circle developer-controlled wallet) is generated for each invoice.
3. **Client acknowledges.** The client opens a link and signs an EIP-712 acknowledgment of the invoice hash. Only acknowledged invoices count toward the shared record.
4. **Agent proposes terms:** net days, deposit %, and early-pay discount. It draws on:
   - the network record for that client
   - the freelancer's private history with the client
   - the freelancer's cash forecast
   - the freelancer's policy bounds
5. **Client pays** to the deposit address, either directly on Arc or from another chain via CCTP/Gateway (P1).
6. **Backend detects the payment** by balance change on the deposit address, reconciles it (exact, partial, overpaid or duplicate), and updates the invoice state.
7. **On settlement, facts go onchain.** The attester writes to the `PaymentRecord` contract: invoice hash, client ID hash, due date, paid date, and amount band.
8. **Collections.** For overdue invoices, the agent chooses the next step: reminder, discount offer, late-fee notice, escalation to the freelancer, or a "pause new work" flag.
9. **Overpayments and duplicates.** The agent proposes a refund. The refund executes only after the payer confirms a refund address, and it is idempotent.
10. **Decision log.** Every decision goes into a hash-chained, signed log. The head of the chain is anchored onchain periodically.
11. **Client responses.** A client can attach a response to any record entry. Disputed entries are excluded from scoring until resolved.

---

## 4. What it does NOT do

- Guarantee payment or enforce late fees. Fees are notices, not collection.
- Collect debts in the legal sense, or arbitrate disputes.
- Verify client identity beyond their signature. It is **not sybil-proof**.
- Hold escrow, custody the freelancer's treasury, earn yield, or rebalance funds.
- Handle fiat, tax, credit underwriting or invoice financing.
- Prove the quality of work.

---

## 5. Architecture

### 5.1 Components

| Component | Tech | Responsibility |
|---|---|---|
| Frontend | React + Vite + TS + Tailwind (Vercel) | Freelancer dashboard, invoice creation, client pay/acknowledge page, approvals queue, decision replay, public metrics page |
| API | Node + TS + Express (Railway) | Auth, invoices, policies, agent orchestration, webhooks |
| DB | Postgres (Railway) | Source of truth. Unique constraints enforce idempotency. **Do not use a JSON file for persistence** |
| Watcher | Node worker | Polls deposit addresses, detects payments, triggers reconciliation |
| Agent | Anthropic Claude via SDK, strict JSON output | *Proposes* decisions. Never executes them |
| Policy checker | Deterministic TS | Validates every agent proposal against the freelancer's bounds, then routes it to auto-apply or approval |
| Executor | Node + Circle SDK | Executes approved actions (refunds, sweeps) with idempotency keys |
| Contracts | Solidity + Foundry | `PaymentRecord` registry and `DecisionAnchor` |
| Circle | Developer-Controlled Wallets, USDC, EURC, CCTP/Gateway (P1), App Kit Swap (P2) | Wallets, settlement, cross-chain payments |

### 5.2 Data model (Postgres, minimum)

- `freelancers` (id, name, email, main_wallet_id, main_wallet_address, created_at)
- `clients` (id, display_name, org_slug, salt, claimed_by_address nullable). `salt` is private; see crypto-shredding in §6.1
- `client_contacts` (client_id, email, wallet_address)
- `policies` (freelancer_id, min_terms_days, max_terms_days, max_discount_bps, max_deposit_bps, late_fee_bps_cap, approval_threshold_usdc)
- `cash_needs` (id, freelancer_id, due_date, amount_minor, label)
- `invoices` (id, freelancer_id, client_id, currency, amount_minor, due_date, terms_json, status, invoice_hash, deposit_wallet_id, deposit_address, ack_signature, ack_signer, ack_at, created_at)
- `payments` (id, invoice_id, tx_hash, log_index nullable, from_address, amount_minor, source_chain, detected_at). Constraint: **UNIQUE(tx_hash, log_index)**
- `refund_intents` (id, invoice_id, amount_minor, to_address, status, **idempotency_key UNIQUE**, confirmed_by_payer_at, circle_tx_id)
- `agent_decisions` (id, subject_type, subject_id, decision_type, input_snapshot_hash, proposal_json, reasoning, evidence_refs, policy_result, final_status, prev_hash, entry_hash, signature, created_at)
- `record_entries` (invoice_hash, client_id_hash, due_date, paid_at, amount_band, disputed, response_text, onchain_tx)

Store all amounts as integer minor units. The USDC and EURC ERC-20 interfaces use **6 decimals**.

### 5.3 Invoice state machine

```
DRAFT → SENT → ACKNOWLEDGED → PARTIALLY_PAID → PAID
                    │                │
                    └──── OVERDUE ◄──┘   (after due date, if not PAID)

PAID/PARTIALLY_PAID → OVERPAID → REFUND_PENDING → REFUNDED
Any state → DISPUTED | CANCELLED
```

Unacknowledged invoices can still be paid, but they are excluded from the shared record.

### 5.4 Contracts

**`PaymentRecord.sol`** (minimal state, events for indexing)
- `recordAcknowledged(bytes32 invoiceHash, bytes32 clientIdHash, bytes32 freelancerIdHash, uint64 dueDate, uint8 amountBand)`: onlyAttester
- `recordSettled(bytes32 invoiceHash, uint64 paidAt)`: onlyAttester
- `recordDispute(bytes32 invoiceHash, bytes32 responseHash)`: onlyAttester (relays a client-signed message)
- `setAttester(address attester, bool allowed)`: onlyOwner (for rotation)
- Writing the same `invoiceHash` twice must revert.

**`DecisionAnchor.sol`**
- `anchor(bytes32 chainHead, uint256 count)`: onlyAttester. Called every N decisions or every hour.

**Amount bands:** `0` = under 100 · `1` = 100–999 · `2` = 1,000–9,999 · `3` = 10,000 or more (USDC equivalent)

**Trust assumption (state it in the README):** in the hackathon version, the backend attester is a trusted reporter. Settlement facts can be cross-checked against the Arc transfers to each deposit address.

**Foundry tests required:** access control, duplicate-write revert, dispute flow, attester rotation, anchor ordering.

### 5.5 Agent loop

**Decision types**
- `SET_TERMS`: on invoice creation. Sets net days, deposit %, and early-pay discount.
- `EARLY_PAY_OFFER`: when the cash forecast shows a shortfall. Chooses which open invoices get a discount offer, and how much.
- `COLLECTION_STEP`: on overdue invoices. One of `REMINDER | DISCOUNT_OFFER | LATE_FEE_NOTICE | ESCALATE | FLAG_PAUSE_WORK`.
- `RECONCILE`: on a payment anomaly (`PARTIAL | OVERPAID | DUPLICATE`). May produce a refund proposal.

**Inputs** (a snapshot, hashed into the log entry)
- Computed client stats, never raw rows: network on-time rate, average days late, invoice count, distinct freelancers, confidence. Plus the freelancer's private history with this client.
- The freelancer's cash forecast: upcoming needs versus expected receivables.
- Policy bounds.
- Previous decisions on the same subject.
- Any client-supplied text, wrapped and labelled as **untrusted data**.

**Output** (strict JSON, validated with zod)
```json
{
  "decision_type": "SET_TERMS",
  "action": "PROPOSE_TERMS",
  "params": { "net_days": 14, "deposit_bps": 0, "early_pay_discount_bps": 150 },
  "reasoning": "Plain-language explanation citing the evidence.",
  "evidence_refs": ["stat:network_on_time_rate", "cash_need:123"],
  "confidence": 0.72
}
```

**Flow**
1. Build the input snapshot.
2. Call the model.
3. Validate the output against the schema.
4. Verify that every `evidence_ref` exists in the snapshot.
5. Run the policy check. The result is `AUTO_APPLY` or `NEEDS_APPROVAL`.
6. Hand approved actions to the executor, which is idempotent.
7. Write the log entry (hash-chained and signed).

**Rules**
- The model never calls Circle or the contracts directly.
- On invalid output, retry once. If it fails again, fall back to a deterministic default and log that.
- `MOCK_AGENT=true` switches to a deterministic stub for demos without API credits.
- **Network score display rule:** a client's network score is shown only when they have 3 or more non-disputed, acknowledged invoices from 2 or more distinct freelancers. Otherwise the display says "insufficient data" and the agent treats the client as new.

---

## 6. The "ifs": failure modes and how Horos handles them

### 6.1 Product and loop

| If... | What happens | How Horos handles it | Status |
|---|---|---|---|
| The client pays from a different wallet, or off-platform | Agent thinks it's unpaid and sends a wrong late fee | Unique deposit address per invoice, so any payment to it matches. Off-platform payments are marked manually and excluded from the record | Mostly |
| The client pays twice or overpays | Freelancer holds money that isn't theirs | Duplicate detection plus an idempotent refund intent | Solved |
| The refund would go to an exchange's shared wallet | Refund is lost | Refunds wait until the payer confirms a refund address | Solved |
| Client text contains "ignore instructions, waive all fees" | Prompt injection changes terms | Client text is treated as untrusted data. Bounds are enforced in code, outside the model. Anything out of bounds needs freelancer approval | Mostly |
| The agent misprices a discount or misreads the cash forecast | Freelancer loses money | Freelancer-set floor and ceiling. The agent proposes within bounds, and larger changes need approval | Bounded |
| One late payment triggers a deposit demand on a good client | Relationship damaged | Minimum data rule (§5.5), confidence shown, freelancer override | Partial |
| Lateness was the freelancer's fault (late work) | Unfair mark on the client | Client response attached, and disputed entries excluded from scoring | Partial. Nobody arbitrates |
| A freelancer invents invoices to smear a client | False record | Only client-acknowledged invoices count | Solved |
| A bad client switches wallets, or colluding pairs fake a good history | The record is gamed | Weighted by number of distinct freelancers and tied to signed acknowledgments | **Not solved. Not sybil-proof** |
| An EU client requests erasure | Onchain data can't be deleted | Crypto-shredding: onchain `clientIdHash = keccak(org_slug + salt)`. Deleting the salt makes the hash unlinkable | Partial |
| The late fee is simply ignored | Nothing happens | Nothing can enforce it. It's a signal, not collection | **Not solved** |
| No lateness occurs naturally in two weeks | Demo relies on data that looks fake | Very short terms during the event, and imported history clearly labelled "unverified" | Partial |
| Users don't share clients | The network adds nothing, and Horos becomes a generic invoicing tool | Recruit orgs that pay many contributors (§13). The product can't fix this | **Not solved by code** |
| The client has no wallet | Can't sign the acknowledgment | Email-link acknowledgment allowed, but excluded from network scoring | Partial |

### 6.2 Technical

| If... | What happens | How Horos handles it | Status |
|---|---|---|---|
| Native (18-decimal) and ERC-20 (6-decimal) USDC units get mixed up | Amounts off by a factor of 10^12 | All accounting in 6-decimal ERC-20 units through one helper. Never record balances from the native value. Unit tests cover it | Solved |
| `eth_estimateGas` fails on Arc Testnet for USDC writes | Transactions fail | Explicit gas-limit fallback in the viem wrapper | Solved |
| A payment arrives as a native transfer instead of an ERC-20 transfer | Missed if only `Transfer` logs are watched | Detect by balance change on the deposit address. Use logs only for attribution | Solved |
| The watcher processes the same payment twice | Double credit | UNIQUE(tx_hash, log_index) plus processed balance snapshots. Processing is idempotent | Solved |
| The server restarts mid-refund | Double refund, or a stuck refund | Refund intent persisted before submission, Circle idempotency key, resume on boot | Solved |
| The Circle API is down or rate-limited | Actions fail | Queue and retry with the same idempotency key. UI shows "pending" | Solved |
| The attester key leaks | Fake record entries | Key held only in server env, owner can rotate the attester, entries traceable by transaction | Partial |
| The model invents a fact | Wrong terms | The model sees only computed stats, and evidence refs are verified against the snapshot | Mostly |
| The LLM API is unavailable | No decisions | Deterministic fallback, plus `MOCK_AGENT` | Solved |
| An RPC endpoint lags or fails | Watcher stalls | Multiple RPC endpoints with failover | Solved |
| A sweep from a deposit wallet needs gas | Sweep fails | Sweeping is optional. Gas comes out of the received USDC, since Arc gas is USDC | Solved |

---

## 7. What to look out for

### Arc
- **Decimals:** native USDC (gas, `msg.value`, `eth_getBalance`) uses **18 decimals**. The USDC ERC-20 interface at `0x3600000000000000000000000000000000000000` uses **6 decimals**. Both share one balance.
- **Gas estimation:** it has been reported to fail on Arc Testnet for USDC writes (`approve`, `transfer`, CCTP calls). Always keep an explicit gas-limit fallback.
- **Faucet limits:** test USDC from `faucet.circle.com` is rate-limited. Design partners *and their clients* need test USDC, so plan how they get it early. If you fund them yourself, say so in the traction answers.
- **Before coding against them, VERIFY:** the EURC address on Arc, Gateway and CCTP support for Arc, and the blockchain identifier the Circle Wallets API uses for Arc.
- **Finality:** Arc has deterministic sub-second finality, so one confirmation is final. Still handle RPC lag.

### Circle SDK (lessons from earlier Arc builds)
- `walletId` versus `walletAddress` differs per method. Check each method individually.
- `createContractExecutionTransaction` has no `blockchain` parameter. Omit it.
- Set `server.keepAliveTimeout` and `server.headersTimeout` explicitly for long polling.
- Don't let file watchers (nodemon) restart the server on data writes.
- Always pass idempotency keys when creating transactions.

### Agent
- The model proposes and code decides. No code path lets model output move money without the policy check.
- Validate every output against the schema, and verify every evidence ref.
- Log the input snapshot hash with every decision so it can be replayed.
- Make decision reasoning human-readable. Judges will read it.

### Product and legal
- Record objective facts only: due date, paid date, amount band.
- Show a disclaimer: Horos is not a credit bureau, it's a beta, and it records facts only.
- Always show the client's response next to any entry about them.

### Hackathon rules
- **Read the FAQ for the prior-work rule** before reusing code from earlier projects (ArcSettle, Recourse, Lattice). Until that's confirmed, reuse lessons, not code.
- Luma registration: GitHub and Discord handles must match your submissions.
- No wash traffic between your own wallets. Exclude self-test invoices from reported numbers, and label imported history.
- Judges read the repo. The README must include the architecture, the failure-mode tables from §6, the trust assumptions, and how to run the project.
- Submit a working version by **Oct 3**, then resubmit later.

---

## 8. Resources needed

### Accounts and keys
- Circle Developer Console: a testnet API key and entity secret now, a live key only at the mainnet gate
- Anthropic API key (budget for credits, and keep `MOCK_AGENT` as the fallback)
- Railway (API, worker, Postgres) and Vercel (frontend)
- A public GitHub repo
- Luma registration (with the passphrase from the event page), plus the Canteen and Arc Discords
- Loom or YouTube for the demo video

### Tooling
- Node ≥ 20.18.2, TypeScript, Express, zod, viem, Foundry
- `@circle-fin/developer-controlled-wallets` SDK
- Circle CLI: `npm install -g @circle-fin/cli`
- ARC CLI: `uv tool install git+https://github.com/the-canteen-dev/ARC-cli`. It includes a Canteen-hosted testnet RPC and bundled Arc docs for coding agents
- App Kit SDK (Bridge, Swap, Unified Balance) for P1/P2
- React, Vite, Tailwind

### Network reference (VERIFY every value before hardcoding)

| Item | Arc Testnet | Arc Mainnet |
|---|---|---|
| Chain ID | `5042002` | `5042` (VERIFY) |
| RPC | `https://rpc.testnet.arc.network` (alternatives: `rpc.drpc.testnet.arc.network`, `rpc.quicknode.testnet.arc.network`, `rpc.blockdaemon.testnet.arc.network`) | `https://rpc.mainnet.arc.io` (VERIFY) |
| WebSocket | `wss://rpc.testnet.arc.network` | VERIFY |
| Explorer | `https://testnet.arcscan.app` | `https://explorer.arc.io` (VERIFY) |
| Faucet | `https://faucet.circle.com` | n/a |
| USDC (ERC-20, 6 decimals) | `0x3600000000000000000000000000000000000000` | VERIFY |
| EURC | VERIFY | VERIFY |
| CCTP V2 TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` (VERIFY) | VERIFY |
| CCTP V2 MessageTransmitter | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` (VERIFY) | VERIFY |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | VERIFY |

Some third-party docs still describe Arc as testnet-only, while `docs.arc.io` lists mainnet details. Confirm mainnet status, and Circle Wallets support on mainnet, before planning Phase D (§10).

### Docs and reference repos
- Circle Agent Stack: https://developers.circle.com/agent-stack
- Arc docs: https://docs.arc.network and https://docs.arc.io (connect-to-arc, contract addresses, EVM differences)
- Canteen, "Agents and Ledgers in 2026": https://thecanteenapp.com/analysis/2026/09/12/agents-and-ledgers.html (read before building the decision log)
- Sample apps: `circlefin/arc-multichain-wallet`, `circlefin/arc-stablecoin-fx`, `circlefin/arc-commerce`, `circlefin/arc-ecommerce-payments`, `circlefin/arc-p2p-payments`
- Reference only: `OCA/credit-control` (dunning ladder), `invoice-x/invoice2data` (invoice parsing, optional)

### People
- 2–3 organizations (DAOs, protocols, Web3 studios) that pay multiple contributors in USDC
- Their contributors, as freelancer users
- One contact per org who can sign acknowledgments and send payments

---

## 9. Priorities

**P0: must ship (core, by Oct 3)**
- Freelancer onboarding with a Circle wallet, policy bounds and cash needs
- Invoice creation with a per-invoice deposit address
- Client acknowledgment page (EIP-712)
- Watcher, payment detection and reconciliation
- Agent loop (`SET_TERMS`, `COLLECTION_STEP`, `RECONCILE`), policy checker and approvals queue
- Idempotent refund flow with payer-confirmed address
- Hash-chained, signed decision log plus a replay UI
- `PaymentRecord` and `DecisionAnchor` deployed on testnet, with Foundry tests

**P1: the differentiator and traction (by Oct 7)**
- Network client score, applying the display rule
- `EARLY_PAY_OFFER` driven by the cash forecast
- Client response and dispute flow
- Public metrics page, with testnet and mainnet reported separately
- "Pay from another chain" page (CCTP / Gateway via App Kit Bridge)

**P2: stretch**
- EURC invoices with optional auto-swap to USDC (App Kit Swap)
- Paymaster, so clients pay exactly the invoice amount
- Moving idle received USDC into USYC, **only** if testnet access is confirmed (USYC may be allowlisted)
- Limited mainnet pilot (§10, Phase D)

---

## 10. Testnet → mainnet plan

**Config:** `NETWORK=testnet|mainnet` switches the chain config, RPCs, contract addresses, Circle API key, attester key and database.
- Never share keys or databases between networks.
- Deploy mainnet contracts from a tagged commit.

**Phase A: local (days 1–2)**
- Foundry tests for both contracts
- Unit tests for the decimal helper, reconciliation, the policy checker and hash chaining
- Circle calls mocked, `MOCK_AGENT=true`

**Phase B: Arc Testnet development (days 2–6)**
- Deploy the contracts and create real Circle testnet wallets
- End-to-end run: create an invoice, acknowledge it, pay it, record it, run the agent's decisions
- Exercise every row of the §6 tables at least once on testnet, and note the results in `TESTING.md`

**Phase C: testnet pilot with design partners (days 7–12)**
- Real orgs and freelancers using test USDC. This counts as traction.
- Watch for manual database fixes. Every manual fix is a bug to close before mainnet.

**Mainnet gate: every box must be checked**
- [ ] All P0 tests pass. Every failure mode in §6 has been exercised on testnet.
- [ ] 20+ partner invoices settled on testnet with zero manual DB fixes
- [ ] Replayed polls and webhooks produce no double credits or double refunds
- [ ] Decimal handling verified on real transfers (native and ERC-20)
- [ ] Separate mainnet Circle key, entity secret, attester key and database
- [ ] Per-invoice cap (e.g. ≤ 500 USDC), refund cap, and a global kill switch that halts the executor and attester
- [ ] Arc mainnet values from §8 verified, and Circle Wallets support on mainnet confirmed
- [ ] Disclaimer and terms shown in the UI (beta, facts-only record, unaudited contracts)
- [ ] Each partner explicitly opts in to mainnet

**Phase D: limited mainnet (optional, days 11–13)**
- Only for partners who want it, with low caps
- Report mainnet volume separately. The judges weight real mainnet usage higher.

**Rollback:** set the kill switch, pause the attester, and tell partners. Record data already onchain stays, and can be marked disputed if needed.

---

## 11. 14-day plan

| Day | Date | Work |
|---|---|---|
| 0 | Sep 25–26 | Apply. Read the FAQ (prior-work rule). Message 10+ orgs. Set up accounts. Verify §8 values |
| 1–2 | Sep 27–28 | Repo scaffold, contracts plus Foundry tests, testnet deploy, Circle wallet and deposit-address creation |
| 3–4 | Sep 29–30 | Invoice flow, EIP-712 acknowledgment, watcher, reconciliation, refund intents |
| 5–6 | Oct 1–2 | Agent loop, policy checker, approvals queue, decision log, replay UI |
| 7 | Oct 3 | **First submission** (working core). Onboard the first org |
| 8–9 | Oct 4–5 | Network score, `EARLY_PAY_OFFER`, disputes, metrics page |
| 10 | Oct 6 | Pay-from-another-chain page (CCTP / Gateway) |
| 11–12 | Oct 7–8 | Hardening, failure-mode tests, mainnet gate and optional Phase D |
| 13 | Oct 9 | Demo video, README, final metrics |
| 14 | Oct 10 | Final submission well before 11:59 PM ET |

---

## 12. Demo script (under 3 minutes)

| Time | Content |
|---|---|
| 0:00–0:20 | **Problem:** freelancers find out a client pays late only after doing the work |
| 0:20–0:50 | One org, two freelancers. Invoice created, agent proposes terms with reasoning, client acknowledges and pays, record written (explorer link) |
| 0:50–1:40 | **Key moment:** two clients with similar records get *different* terms, because the freelancer's cash forecast shows a shortfall. The agent offers an early-pay discount to the reliable client. Show the reasoning and the policy bounds |
| 1:40–2:10 | **Failure handling:** duplicate payment detected, refund held until the payer confirms an address. Injected text in a client response is ignored |
| 2:10–2:40 | Decision replay plus the onchain anchor. Metrics page with real numbers |
| 2:40–3:00 | Honest limits (not sybil-proof, fees not enforceable) and what's next |

---

## 13. Traction plan

- **Before Sep 27:** message 10+ organizations that pay contributors in USDC. The pitch: "verifiable proof that you pay on time."
- Onboard the **org first**, then its contributors.
- Give partners a one-page guide to getting test USDC from the faucet.
- Collect at least one quote per org about the problem Horos solved.
- The metrics page is generated automatically from the database, with testnet and mainnet reported separately and self-test invoices excluded.

---

## 14. Open questions (resolve before or during day 1)

1. Does the FAQ's prior-work rule allow reusing code from earlier projects?
2. What is the EURC address on Arc, and are Gateway and CCTP available on Arc Testnet (and mainnet)?
3. Which blockchain identifier does the Circle Wallets API use for Arc Testnet and Arc mainnet?
4. Should clients be required to have a wallet, or is email acknowledgment allowed as a weaker path?
5. Final project name.
6. Go to mainnet within the event window? Decide at the gate (§10).

---

## 15. Conventions for the coding agent

- Strict TypeScript. Use viem, not ethers. Use Foundry for contracts.
- Scripts must work on Windows (Git Bash / WSL). Avoid bash-only npm scripts, or provide cross-platform versions.
- UI: dark theme, teal accent `#00C2A8`, no purple, no gradients. Responsive at the sm/md/lg/xl breakpoints.
- Env-flag fallbacks (`MOCK_AGENT`, `NETWORK`) so the app always deploys.
- Money paths are tested before features are added on top of them.
- Never commit secrets. Keep `.env.example` up to date.
- Keep this file updated as decisions change, and log changes at the bottom.

## Changelog
- 2026-09-24: Initial spec.
- 2026-09-25: Build decisions. The decision log is a separate append-only `decision_log` table: approvals and executions are new chained entries, never edits. Added `PaymentRecord.resolveDispute` so disputes can be resolved. Circle SDK 8.4.1 has no Arc blockchain enum entry (still VERIFY). Local dev uses PGlite (embedded Postgres). Agent model defaults to `claude-opus-5` (override with `ANTHROPIC_MODEL`).
- 2026-09-26: **Client recovery (approved by John).** The client score is now "reliability": time-decayed with a 90-day half-life and graded by lateness (on time 1 · 1–3 days 0.5 · 4–14 days 0.25 · 15–29 days 0.1 · 30+ days or unpaid 0). Unpaid overdue invoices never fade. Invoices resolved more than 18 months ago drop out of scoring but stay visible. A recent streak (last 5) and a trend (improving / steady / declining) are shown and given to the agent, along with on-time payments under strict terms (deposit, or net ≤ 7), which is the probation path. Onchain facts are unchanged. The display rule is unchanged.
- 2026-09-25: Proposed P1 addition: **pay by card via Arc App Kit Onramp** (`@circle-fin/app-kit`). The client buys USDC by card or bank; the destination is fixed server-side to the invoice's deposit address, so the watcher and reconciliation handle it like any other payment. Pending John's OK on scope.
