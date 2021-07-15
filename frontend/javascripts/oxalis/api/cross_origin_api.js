// @flow
import { useEffect } from "react";
import _ from "lodash";

import api from "oxalis/api/internal_api";

// This component allows cross origin communication, for example, between a host page
// and an embedded webKnossos iframe.
// Currently, this is only used for a couple of API functions, but the interface may be extended in the future
// Usage: postMessage({type: "setMapping", args: [mappingObj, options]}, "*")

const onMessage = async event => {
  // We could use this to restrict usage of this api to specific domains
  // if (event.origin !== "https://connectome-viewer.org") {
  //   return;
  // }
  if (!_.isObject(event.data)) return;
  const { type, args, messageId } = event.data;
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
    case "setActiveTreeByName": {
      const treeName = args[0];
      if (_.isString(treeName)) {
        api.tracing.setActiveTreeByName(treeName);
      } else {
        const errorMessage = "The first argument needs to be the name of the tree.";
        console.warn(errorMessage);
        event.source.postMessage({ type: "err", messageId, error: errorMessage }, "*");
        return;
      }
      break;
    }
    case "importNml": {
      const nmlAsString = args[0];
      if (_.isString(nmlAsString)) {
        await api.tracing.importNmlAsString(nmlAsString);
      } else {
        const errorMessage = "The first argument needs to be the content of the nml as a string.";
        console.warn(errorMessage);
        event.source.postMessage({ type: "err", messageId, error: errorMessage }, "*");
        return;
      }
      break;
    }
    default: {
      const errorMessage = `Unsupported cross origin API command: ${type}`;
      console.warn(errorMessage);
      event.source.postMessage({ type: "err", messageId, error: errorMessage }, "*");
      return;
    }
  }
  event.source.postMessage({ type: "ack", messageId }, "*");
};

const CrossOriginApi = () => {
  useEffect(() => {
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    if (window.webknossos && window.parent) {
      window.webknossos.apiReady().then(() => {
        window.parent.postMessage({ message: "api ready" }, "*");
      });
    }
  }, [window.webknossos]);

  return null;
};

export default CrossOriginApi;
