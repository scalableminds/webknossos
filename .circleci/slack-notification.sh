#!/usr/bin/env bash
set -Eeuo pipefail

if [ "${CIRCLE_BRANCH}" == "master" ] ; then
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
    author=${author/youri-k/<@youri>}
    author=${author/grittaweisheit/<@Gritta>}
    author=${author/Dagobert42/<@Arthur Hilbert>}
    channel="webknossos-bots"
    commitmsg="$(git log --format=%s -n 1)"
    pullregex="(.*)#([0-9]+)(.*)"
    while [[ "$commitmsg" =~ $pullregex ]]
    do
        commitmsg="${BASH_REMATCH[1]}#<https://github.com/scalableminds/webknossos/issues/${BASH_REMATCH[2]}|${BASH_REMATCH[2]}>${BASH_REMATCH[3]}"
    done
    buildlink="<https://circleci.com/gh/scalableminds/webknossos/${CIRCLE_BUILD_NUM}|${CIRCLE_BUILD_NUM}>"
    mesg="${author} your ${CIRCLE_BRANCH} build ${buildlink} “${commitmsg}” is almost finished."
    user="circleci-notify"
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
