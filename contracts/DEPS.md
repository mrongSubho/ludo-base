# CHIPS contracts deps

```bash
# Foundry / base-forge must be on PATH (see README.md).
# Unit tests need forge-std:
forge install foundry-rs/forge-std --no-commit

# B20 CreateChips.s.sol needs Base Standard Library (v1.0.0+):
# follow https://docs.base.org — install base-std into lib/base-std
# then uncomment the real CreateChips contract in script/CreateChips.s.sol
```

Do not commit keys or RPC API keys. Use `cast wallet import` + env refs in `foundry.toml`.
