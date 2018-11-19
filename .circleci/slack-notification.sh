#!/usr/bin/env bash
set -Eeuo pipefail

if [ "${CIRCLE_BRANCH}" == "master" ] || [ "${CIRCLE_BRANCH}" == "circleci-custom-notification" ]; then
    author=${CIRCLE_USERNAME}
    author=${author/fm3/<@florian>}
    author=${author/jstriebel/<@jonathan>}
    author=${author/daniel-wer/<@daniel>}
    author=${author/georgwiese/<@georg>}
    author=${author/hotzenklotz/<@tom>}
    author=${author/jfrohnhofen/<@johannes>}
    author=${author/MichaelBuessemeyer/<@michael>}
    author=${author/normanrz/<@norman>}
    author=${author/philippotto/<@philipp>}
    author=${author/rschwanhold/<@robert>}
    author=${author/tmbo/<@tmbo>}
    author=${author/valentin-pinkau/<@valentin>}
    channel="webknossos-bots"
    commitmsg=$(git log --format=%s -n 1)
    buildlink="<https://circleci.com/gh/scalableminds/webknossos/${CIRCLE_BUILD_NUM}|${CIRCLE_BUILD_NUM}>"
    prlink="<https://github.com/scalableminds/webknossos/pull/${CIRCLE_PR_NUMBER:=0}|#${CIRCLE_PR_NUMBER:=0}>"
    mesg="${author} your ${CIRCLE_BRANCH} build ${buildlink} (${commitmsg} – ${prlink}) is almost finished."
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
        echo "[WARN] Error sending Slack notification: $(echo ${res} | jq -r '.error')."
    fi
    echo "[INFO] Sent Slack notification to ${channel}."
fi
