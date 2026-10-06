#!/usr/bin/env bash
# Shared loader for contracts/.env, used by scripts/foundry-deploy.sh and
# scripts/verify-contracts.sh. Source it, do not execute it.
#
# Why not `source ./.env`
# ------------------------
# A plain `source` overwrites anything already in the environment, so
# `FOO=bar ./script.sh` silently loses to whatever the file says. That has
# bitten twice here:
#
#   1. verify-contracts.sh read MATCH_POOL_ADDRESS from a stale .env and
#      verified the PREVIOUS deployment while reporting success — Sourcify
#      answers "already verified" for the old pair, so the exit code stayed 0.
#   2. foundry-deploy.sh silently ignored inline DEPLOYER_ADDRESS overrides.
#
# A caller passing a variable inline must always win, or the overrides are a
# trap. Trailing "# ..." comments are also stripped, because
# `ETHERSCAN_API_KEY=abc # note` otherwise yields the literal "abc # note".
ENV_FILE="${LUDO_ENV_FILE:-$ROOT/contracts/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  # Bootstrap on first run so the required keys are visible.
  cp "${ENV_FILE%.env}.env.example" "$ENV_FILE" 2>/dev/null || true
  echo "created ${ENV_FILE#$ROOT/} — set CHIPS_ADDRESS, EDGE_SIGNER, GAME_OWNER, DEPLOYER_ADDRESS"
fi

if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r __line || [[ -n "$__line" ]]; do
    [[ "$__line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$__line" != *=* ]] && continue
    __k="${__line%%=*}"
    __v="${__line#*=}"
    __k="${__k//[[:space:]]/}"
    __v="${__v%%#*}"
    __v="${__v#"${__v%%[![:space:]]*}"}"
    __v="${__v%"${__v##*[![:space:]]}"}"
    [[ -n "$__k" ]] || continue
    [[ -n "${!__k+x}" ]] || export "$__k=$__v"
  done < "$ENV_FILE"
fi

unset __line __k __v ENV_FILE
