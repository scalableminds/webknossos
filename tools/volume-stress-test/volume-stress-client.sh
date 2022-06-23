#!/bin/bash

authtoken=secretSampleUserToken
host=http://localhost:9000
datastorehost=http://localhost:9000
dataset=sample_organization/e2006-x4y1z1

volumeid0=$(curl -s $host'/api/datasets/'$dataset'/createExplorational' -H 'X-Auth-Token: '$authtoken -H 'Accept: application/json' -H 'content-type: application/json' -H 'Connection: keep-alive' --data '{"typ":"volume","withFallback":false}' | jq -r '.tracing.volume')
volumeid1=$(curl -s $host'/api/datasets/'$dataset'/createExplorational' -H 'X-Auth-Token: '$authtoken -H 'Accept: application/json' -H 'content-type: application/json' -H 'Connection: keep-alive' --data '{"typ":"volume","withFallback":false}' | jq -r '.tracing.volume')
volumeid2=$(curl -s $host'/api/datasets/'$dataset'/createExplorational' -H 'X-Auth-Token: '$authtoken -H 'Accept: application/json' -H 'content-type: application/json' -H 'Connection: keep-alive' --data '{"typ":"volume","withFallback":false}' | jq -r '.tracing.volume')
volumeid3=$(curl -s $host'/api/datasets/'$dataset'/createExplorational' -H 'X-Auth-Token: '$authtoken -H 'Accept: application/json' -H 'content-type: application/json' -H 'Connection: keep-alive' --data '{"typ":"volume","withFallback":false}' | jq -r '.tracing.volume')
volumeid4=$(curl -s $host'/api/datasets/'$dataset'/createExplorational' -H 'X-Auth-Token: '$authtoken -H 'Accept: application/json' -H 'content-type: application/json' -H 'Connection: keep-alive' --data '{"typ":"volume","withFallback":false}' | jq -r '.tracing.volume')
volumeid5=$(curl -s $host'/api/datasets/'$dataset'/createExplorational' -H 'X-Auth-Token: '$authtoken -H 'Accept: application/json' -H 'content-type: application/json' -H 'Connection: keep-alive' --data '{"typ":"volume","withFallback":false}' | jq -r '.tracing.volume')
volumeid6=$(curl -s $host'/api/datasets/'$dataset'/createExplorational' -H 'X-Auth-Token: '$authtoken -H 'Accept: application/json' -H 'content-type: application/json' -H 'Connection: keep-alive' --data '{"typ":"volume","withFallback":false}' | jq -r '.tracing.volume')
volumeid7=$(curl -s $host'/api/datasets/'$dataset'/createExplorational' -H 'X-Auth-Token: '$authtoken -H 'Accept: application/json' -H 'content-type: application/json' -H 'Connection: keep-alive' --data '{"typ":"volume","withFallback":false}' | jq -r '.tracing.volume')
volumeid8=$(curl -s $host'/api/datasets/'$dataset'/createExplorational' -H 'X-Auth-Token: '$authtoken -H 'Accept: application/json' -H 'content-type: application/json' -H 'Connection: keep-alive' --data '{"typ":"volume","withFallback":false}' | jq -r '.tracing.volume')
volumeid9=$(curl -s $host'/api/datasets/'$dataset'/createExplorational' -H 'X-Auth-Token: '$authtoken -H 'Accept: application/json' -H 'content-type: application/json' -H 'Connection: keep-alive' --data '{"typ":"volume","withFallback":false}' | jq -r '.tracing.volume')

echo "volumes initialized. sleeping 5s to let things settle..."
sleep 5
echo "sending volume updates..."

(trap 'kill 0' SIGINT; \
./send-updates.sh $datastorehost $authtoken $volumeid0 & \
./send-updates.sh $datastorehost $authtoken $volumeid1 & \
./send-updates.sh $datastorehost $authtoken $volumeid2 & \
./send-updates.sh $datastorehost $authtoken $volumeid3 & \
./send-updates.sh $datastorehost $authtoken $volumeid4 & \
./send-updates.sh $datastorehost $authtoken $volumeid5 & \
./send-updates.sh $datastorehost $authtoken $volumeid6 & \
./send-updates.sh $datastorehost $authtoken $volumeid7 & \
./send-updates.sh $datastorehost $authtoken $volumeid8 & \
./send-updates.sh $datastorehost $authtoken $volumeid9)
