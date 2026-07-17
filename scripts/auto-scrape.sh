#!/bin/bash
#
# Automated monthly visa-bulletin scrape → PR → auto-merge, meant to be run by
# launchd on this Mac during the publish window (10th–20th). See README ("Automation").
#
# Flow:
#   1. sync main
#   2. `npm run scrape:local` (real Chrome, passes Cloudflare)
#   3. if data/ changed → branch, commit, push, `gh pr create`, `gh pr merge`
#   4. on failure → Slack notification (distinguishes Cloudflare failures)
#
# Most days during the window the bulletin isn't published yet → scrape exits 0
# with no changes → this script exits quietly. Once a month's data is saved,
# re-runs skip before any network request.

set -uo pipefail

REPO="/Users/yan/Work/git/VisaBulletin"
# launchd gives a minimal PATH; add Homebrew + system paths so node/npm/gh/git resolve.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$REPO" || exit 1

LOG="$REPO/local/auto-scrape.log"
mkdir -p "$REPO/local"
exec >>"$LOG" 2>&1
echo ""
echo "=================================================================="
echo "=== auto-scrape start: $(date) ==="

# --- Slack notification helper --------------------------------------------
# Reads the Incoming Webhook URL from local/slack-webhook.txt (gitignored) or
# the SLACK_WEBHOOK_URL env var. No-op if neither is set.
slack_notify() {
  local text="$1"
  local url="${SLACK_WEBHOOK_URL:-}"
  if [ -z "$url" ] && [ -f "$REPO/local/slack-webhook.txt" ]; then
    url="$(tr -d '[:space:]' <"$REPO/local/slack-webhook.txt")"
  fi
  if [ -z "$url" ]; then
    echo "WARN: no Slack webhook configured; skipping notification: $text"
    return
  fi
  # Escape double quotes and newlines for JSON.
  local escaped
  escaped="$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
  curl -s -X POST -H 'Content-Type: application/json' \
    --data "{\"text\": $escaped}" "$url" >/dev/null \
    && echo "Slack notified." || echo "WARN: Slack notification failed."
}

fail() {
  echo "ERROR: $1"
  slack_notify "❌ Visa Bulletin 自动抓取失败: $1"
  exit 1
}

# --- 1. sync main ----------------------------------------------------------
git checkout main || fail "git checkout main 失败"
git pull --ff-only origin main || fail "git pull main 失败"

# --- 2. scrape -------------------------------------------------------------
echo "--- running scrape:local ---"
SCRAPE_OUT="$(npm run scrape:local 2>&1)"
SCRAPE_RC=$?
echo "$SCRAPE_OUT"

# --- 3. handle result ------------------------------------------------------
if ! git diff --quiet -- data/ || ! git diff --cached --quiet -- data/; then
  # New/changed bulletin data → PR + merge.
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BRANCH="auto/bulletin-$STAMP"
  DATE_UTC="$(date -u +%Y-%m-%d)"

  git checkout -b "$BRANCH"          || fail "创建分支失败"
  git add data/                      || fail "git add 失败"
  git commit -m "Update visa bulletin data $DATE_UTC" || fail "git commit 失败"
  git push -u origin "$BRANCH"       || fail "git push 失败"

  PR_URL="$(gh pr create --base main --head "$BRANCH" \
    --title "Update visa bulletin data $DATE_UTC" \
    --body "Automated visa bulletin update (scraped locally via real browser).")" \
    || fail "gh pr create 失败(gh 是否已登录?)"
  echo "PR created: $PR_URL"

  gh pr merge "$BRANCH" --merge --delete-branch || fail "gh pr merge 失败: $PR_URL"
  echo "Merged: $PR_URL"

  git checkout main
  git pull --ff-only origin main

  slack_notify "✅ Visa Bulletin 已更新并自动合并: $PR_URL"
  echo "=== done (updated) ==="
  exit 0
fi

# No data change. Was it a real failure or just "not yet published"?
if [ $SCRAPE_RC -ne 0 ]; then
  if printf '%s' "$SCRAPE_OUT" | grep -qiE 'cloudflare|challenge not cleared|timed out waiting'; then
    slack_notify "⚠️ Visa Bulletin 抓取被 Cloudflare 拦住(挑战未自动通过)。可能是通行 cookie 过期——请手动跑一次 \`npm run scrape:local\` 并点一下 \"Verify you are human\" 勾选框重新种 cookie。"
  else
    TAIL="$(printf '%s' "$SCRAPE_OUT" | tail -5)"
    slack_notify "❌ Visa Bulletin 抓取失败(非 Cloudflare):$TAIL"
  fi
  echo "=== done (scrape failed, notified) ==="
  # 确保 launchd 记录为异常,方便排查
  git checkout main 2>/dev/null
  exit 1
fi

# Clean, expected case: bulletin not published yet.
git checkout main 2>/dev/null
echo "=== done (no changes; nothing to do) ==="
exit 0
