#!/usr/bin/env bash

set -Eeuo pipefail

commitmsg=$(git log --format=%s -n 1)

author=${GITHUB_ACTOR}
# Merge queue bot merged the PR: notify whoever added the automerge label instead
if [[ "$author" == "mergecow[bot]" && "$commitmsg" =~ \(#([0-9]+)\)$ ]]; then
    labeler=$(curl -s \
        -H "Authorization: Bearer ${GITHUB_TOKEN:-}" \
        "${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/issues/${BASH_REMATCH[1]}/events?per_page=100" \
        | jq -r '[.[] | select(.event == "labeled" and .label.name == "automerge")] | last | .actor.login // empty' \
    ) || true
    author=${labeler:-$author}
fi
author=${author/fm3/<@U5F5GG0N9>}
author=${author/daniel-wer/<@U02A8PAF9>}
author=${author/hotzenklotz/<@U02A9H73G>}
author=${author/MichaelBuessemeyer/<@UAQKLJBJM>}
author=${author/normanrz/<@U02A9E68E>}
author=${author/philippotto/<@U02A8PAJK>}
author=${author/valentin-pinkau/<@U19635SLU>}
channel="webknossos-bots"
pullregex="(.*)#([0-9]+)(.*)"

while [[ "$commitmsg" =~ $pullregex ]]; do
    commitmsg="${BASH_REMATCH[1]}#<https://github.com/scalableminds/webknossos/issues/${BASH_REMATCH[2]}|${BASH_REMATCH[2]}>${BASH_REMATCH[3]}"
done

buildlink="<${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}|ready>"
mesg="${author} WEBKNOSSOS docker image \`${DOCKER_TAG}\` for “${commitmsg}” is ${buildlink}."
user="ci-notify"
token="${SLACK_NOTIFY_TOKEN:-}"
res=$(curl -s \
    -X POST \
    -d "token=${token}" \
    -d "channel=${channel}" \
    -d "text=${mesg}" \
    -d "username=${user}" \
    -d "icon_url=https://a.slack-edge.com/41b0a/img/plugins/circleci/service_48.png" \
    https://slack.com/api/chat.postMessage
)
if [[ "$(echo "${res}" | jq '.ok')" == "false" ]]; then
    echo "[WARN] Error sending Slack notification: $(echo "${res}" | jq -r '.error')."
fi
echo "[INFO] Sent Slack notification to ${channel}."
