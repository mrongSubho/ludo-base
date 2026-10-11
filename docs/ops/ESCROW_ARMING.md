# Escrow arming runbook — `chips_escrow_*` (SEC-05a)

`chips_escrow_config.enabled` is `false` until a human arms it. Arming makes
the service a custodian of real CHIPS between deposit and withdrawal; do not
arm from a script without reading this file.

## 1. Prerequisites (all four, no exceptions)

1. **Treasury wallet.** An address you control, with a `players` row
   (`chips_escrow_accounts` FKs `players(wallet_address)` — arming with a
   wallet that has no row breaks every treasury credit at runtime):
   `insert into players(wallet_address) values ('<treasury>') on conflict do nothing;`
2. **Non-zero rake.** `rake_bps` in 1..5000 (e.g. `500` = 5%). The arming
   CHECK refuses `enabled=true` with `rake_bps = 0` or a null treasury, and a
   later migration folded `allow_self_bets` into the same CHECK, so arming
   cannot re-enable self-bets either.
3. **Deposit reconciliation.** `chips_escrow_deposit` trusts its caller; only
   the indexer / an ops path may call it, and every call must reconcile
   against `chips_events` (indexed on-chain CHIPS transfers) by `ref` before
   crediting. An unreconciled deposit mints spendable escrow balance from
   nothing.
4. **Solvency baseline.** `select chips_escrow_solvency();` must return
   `solvent: true, delta: 0` before and after arming.

## 2. Arm (SQL Editor or Management API)

```sql
insert into players(wallet_address) values ('<treasury>') on conflict do nothing;
update chips_escrow_config
   set enabled = true, treasury_wallet = '<treasury>', rake_bps = <bps>,
       allow_self_bets = false
 where id;
select chips_escrow_solvency();
```

Expected: one row updated, solvency `solvent: true`.

## 3. Verify (anon key, production)

- `chips_escrow_place_bet` / `settle` / `deposit` / `withdraw` /
  `spend_purchase` / `solvency` refuse for `anon` (they are service-role-only;
  `npm run check:schema` DB mode asserts this in CI).
- Disabled-path probe is gone: calls now execute. Place a dust bet and a dust
  purchase on Sepolia first; confirm buyer debit + treasury credit + proof row
  (`spectator_bets` / `chips_marketplace_purchases`) and `solvency.delta = 0`.
- Marketplace purchases additionally need the app server (signed intent);
  a direct RPC call bypasses the intent but not the debit — that is by design
  (the RPC is service-role-only; only the app server reaches it).

## 4. Disarm / rollback

```sql
update chips_escrow_config set enabled = false where id;
```

Disarming refuses new placements/purchases/settles immediately. In-flight
open bets stay `open` until re-armed and settled; escrow balances are
untouched (withdrawals also refuse while disarmed — re-arm to release, or
settle on-chain directly from the treasury).

## 5. Purchase rail notes

- Prices: `lib/marketplacePrices.ts` (whole CHIPS), shared by route + panel.
- Intent TTL 10 min (`isFreshIssuedAt`); `requestId` makes retries idempotent
  (`chips_marketplace_purchases` unique + RPC replay path).
- Purchases are NOT raked; the full price credits the treasury as `sale`
  revenue. Bet payouts keep the rake path in `chips_escrow_settle_bets`.
