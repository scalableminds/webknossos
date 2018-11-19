#!/usr/bin/env bash
set -Eeuo pipefail

if [ "${CIRCLE_BRANCH}" == "master" ] || [ "${CIRCLE_BRANCH}" == "circleci-custom-notification" ]; then
    author=${CIRCLE_USERNAME}
    author=${author/fm3/florian}
    author=${author/jstriebel/jonathan}
    channel="webknossos-bots"
    mesg="@${author} your ${CIRCLE_BRANCH} build ${CIRCLE_BUILD_NUM} is almost finished."
    echo $mesg
    user="circleci-custom"
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
    if [[ "$(echo ${res} | jq '.ok')" == "false" ]]; then
        echo "Error sending Slack notification: $(echo ${res} | jq -r '.error')."
        exit 1
    fi
    echo "Sent Slack notification to ${channel}."
fi
