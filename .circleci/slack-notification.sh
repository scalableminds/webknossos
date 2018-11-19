#!/bin/bash

channel="webknossos-bots"
mesg="Let’s test sending custom circleci notifications to slack. This is build ${CIRCLE_BUILD_NUM}"
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
