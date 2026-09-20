# AGENT_README — Builder Code attribution (Base, ERC-8021)

## What the builder code is

The `builder_code` value issued by the Base API (`base.dev` → Settings → Builder Codes,
e.g. `bc_a1b2c3d4`), stored as `BUILDER_CODE` in `lib/builderCode.ts`
(sourced from `NEXT_PUBLIC_BUILDER_CODE`). It is embedded in every transaction as an
ERC-8021 data suffix — this is how Base tracks which builder originated on-chain activity
(pool joins, claims, marketplace buys, season claims).

## How attribution is attached in this project

- **wagmi client-level** (`app/Providers.tsx`): `createConfig({ dataSuffix: DATA_SUFFIX })`
  covers `useSendTransaction`, `useWriteContract`, and `useSendCalls` automatically.
- **EIP-5792 smart-wallet calls**: pass via `capabilities.dataSuffix` (see Base skill
  `build-on-base/references/builder-codes/wagmi.md`).
- `DATA_SUFFIX` is built with `ox/erc8021` `Attribution.toDataSuffix({ codes: [BUILDER_CODE] })`.
- `POST /api/chips/pool/prepare` must return calldata **plus** the suffix for any hand-built flow.

## Warning

**Never send a transaction without the builder code attribution.** There is no error or
warning when attribution is missing — just silent, permanent invisibility on base.dev
(Onchain → Total Transactions) and lost referral fees. Every transaction path in this
codebase must include the data suffix. Verify via explorer input-data tail
(`8021` repeating, last 16 bytes) or `builder-code-checker.vercel.app`.
