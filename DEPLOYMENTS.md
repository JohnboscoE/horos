# Deployments

## Arc Testnet (chain 5042002)

Deployed 2026-09-25 from commit `5ea70a7`. Explorer: https://testnet.arcscan.app

| Contract | Address | Deploy tx |
|---|---|---|
| `PaymentRecord` | [`0xa33C16fA35ab4b652A1BB7d3443d2b032D64e46b`](https://testnet.arcscan.app/address/0xa33C16fA35ab4b652A1BB7d3443d2b032D64e46b) | see `contracts/broadcast/Deploy.s.sol/5042002/run-latest.json` |
| `DecisionAnchor` | [`0x1EdEab0f4A433BB20dcA044319e602c262D4cC2c`](https://testnet.arcscan.app/address/0x1EdEab0f4A433BB20dcA044319e602c262D4cC2c) | [`0x7009d77f…12f86`](https://testnet.arcscan.app/tx/0x7009d77f5750a4236141798573502d77fd68c495bbf147131fb1a5f5ae912f86) |

| Role | Address |
|---|---|
| Owner (can rotate attesters; cannot write records) | `0x33556a8bE53b292054a51CEb24a5DD4eEF3983cD` |
| Attester (backend: writes records, anchors the log, signs decision-log entries) | `0x8c26BB15f278ffE1924be7d30B691D479E4cD701` |

### Verified against the live network
- Chain ID `5042002` on all four RPCs (`rpc.testnet.arc.network`, drpc, quicknode, blockdaemon).
- USDC ERC-20 at `0x3600…0000`: symbol `USDC`, **6 decimals**. The same balance reads `20000000` via ERC-20 and `20000000000000000000` via `eth_getBalance` (18 decimals), confirming SPEC §7.
- Gas price ~25–48 gwei. Deploying both contracts cost ~0.046 USDC; an attester write costs ~0.002 USDC.

### Smoke test (live, from the attester)
1. `recordAcknowledged` ✅ [`0xa2ee…87da`](https://testnet.arcscan.app/tx/0xa2eea09be34993b0674239071a43079ceb32835ee79cabee52a6a3bd2dce87da)
2. `recordSettled` ✅ [`0xde44…ffb7`](https://testnet.arcscan.app/tx/0xde44db0378d5c339b3a986290b0bef21295847de99c04842328479b968c3ffb7)
3. Duplicate `recordAcknowledged` → reverted ✅
4. Write from the owner (not an attester) → reverted ✅
5. `anchor` ✅ (on an earlier `DecisionAnchor`, `0x4767…F601`, retired so the live one's anchor history only holds real log heads)

The smoke-test `PaymentRecord` entry uses invoice hash `keccak("horos-smoke-test-…")`, which no real invoice can have.

### Notes
- The decision log is anchored with a strictly increasing entry count. If a database's log is reset, deploy a fresh `DecisionAnchor` for it (the attester now refuses to silently skip a mismatched anchor).
- Keys are testnet-only and live only in the local `.env` (gitignored). Mainnet requires separate keys, database and a fresh deployment from a tagged commit (SPEC §10).
