#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -ne 1 ]
then
  echo "Usage: $0 <branch-shorthand>"
  exit 1
fi

DEPLOYMENT="webknossos-dev-$1"
NAMESPACE="webknossos-dev"

echo "[sudo] password:"
POD=$(
  ssh -t kube.scm.io "
    stty -echo;
    sudo -S -p '' kubectl get pods --namespace=$NAMESPACE -o jsonpath='{range .items[*]}{@.metadata.name}{\"\n\"}{end}'
  " | egrep "^$DEPLOYMENT-[0-9]+-.*" | tail -n1 | tr -d '[:space:]'
)
echo "Going to run 'refresh_schema.sh' in pod $POD"

ssh -t kube.scm.io "
  sudo kubectl exec $POD -n $NAMESPACE -- /webknossos/tools/postgres/refresh_schema.sh
"
