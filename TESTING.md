# Testing

Every failure mode from SPEC §6 is listed here with the test that covers it. For the on-testnet columns, Phase B requires each row to be exercised on Arc testnet and the result noted here.

| Failure mode | Automated coverage | Arc testnet (Phase B) |
|---|---|---|
| Decimal mix-up (18 vs 6) | `packages/core/test/money.test.ts` | ☐ real native + ERC-20 transfer |
| Duplicate / overpayment | `apps/api/test/e2e.test.ts` › duplicate payment → RECONCILE → refund | ☐ |
| Refund to an exchange wallet | e2e › refund waits for payer-confirmed address | ☐ |
| Prompt injection in client text | e2e › collection step with client text as untrusted data; `policy.test.ts` › injection-shaped outputs | ☐ with `MOCK_AGENT=false` |
| Native transfer without a Transfer log | `reconcile.test.ts`, e2e › native transfer | ☐ |
| Watcher replay / double credit | e2e › re-running the watcher never double credits | ☐ restart worker mid-run |
| Restart mid-refund | refund intent persisted + deterministic Circle key (`circleGateway.ts` `uuidFromKey`) | ☐ kill worker between submit and poll |
| Fabricated evidence refs | `policy.test.ts` › finds fabricated refs; runner rejects the proposal | ☐ |
| LLM unavailable | runner falls back after one retry (source `FALLBACK`) | ☐ bad API key |
| Log tampering | `crypto.test.ts`, e2e › decision log verifies and detects tampering | ☐ anchor on testnet |
| Invented invoices | only EIP-712 acks create record entries (e2e › tampered signature rejected) | ☐ |
| Dispute excluded from scoring | e2e › signed client response disputes the entry | ☐ |
| Display rule | `stats.test.ts`, e2e › network score display rule | ☐ |
| Contract access control, duplicate writes, rotation, anchor ordering | `contracts/test/*.t.sol` (25 tests incl. fuzz) | ☐ deployed |

Run: `pnpm test` (TypeScript) and `pnpm test:contracts` (Foundry).
