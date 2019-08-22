// @flow
import { useEffect } from "react";
import _ from "lodash";

import api from "oxalis/api/internal_api";

// This component allows cross origin communication, for example, between a host page
// and an embedded webKnossos iframe.
// Currently, this is only used to set a mapping, but the interface may be extended in the future
// Usage: postMessage({type: "setMapping", args: [mappingObj, options]}, "*")

const onMessage = event => {
  // We could use this to restrict usage of this api to specific domains
  // if (event.origin !== "https://contactome-viewer.org") {
  //   return;
  // }
  if (!_.isObject(event.data)) return;
  const { type, args } = event.data;
  if (type == null || !_.isArray(args)) return;

  switch (type) {
    case "setMapping": {
      api.data.setMapping(api.data.getVolumeTracingLayerName(), ...args);
      break;
    }
    case "resetSkeleton": {
      api.tracing.resetSkeletonTracing();
      break;
    }
    default: {
      console.warn("Unsupported cross origin API command.");
    }
  }
};

const CrossOriginApi = () => {
  useEffect(() => {
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return null;
};

export default CrossOriginApi;
