#!/usr/bin/env bash
# eslint-disable burn-down sweep (PENDING_TASKS E1).
# Removes each file-level `/* eslint-disable ... */` comment ONLY if the file
# still lints clean without it; restores from backup otherwise. Never a gate —
# a safe, mechanical burn-down. (bash 3.2 compatible: no mapfile/readarray.
# No sed and no `--format compact`: the sandbox's sed misparses -E scripts and
# the compact formatter is not part of ESLint 9 core — grep -v + the default
# formatter are the portable primitives here.)
set -u
cd "$(dirname "$0")/.."
LOG=/tmp/eslint-sweep.log
: > "$LOG"
removed=0
kept=0
while IFS= read -r f; do
    [ -n "$f" ] || continue
    bak="/tmp/eslint-sweep-bak-$(echo "$f" | tr / _)"
    cp "$f" "$bak"
    grep -v '^/\* eslint-disable .*\*/$' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    if ./node_modules/.bin/eslint "$f" >/dev/null 2>&1; then
        echo "REMOVED $f" >> "$LOG"
        removed=$((removed + 1))
    else
        cp "$bak" "$f"
        echo "kept (still needed) $f" >> "$LOG"
        kept=$((kept + 1))
    fi
done < <(grep -rlE '^/\* eslint-disable .*\*/$' app hooks lib scripts --include='*.ts' --include='*.tsx' 2>/dev/null)
echo "sweep done: removed=$removed kept=$kept" >> "$LOG"
echo "sweep done: removed=$removed kept=$kept"
