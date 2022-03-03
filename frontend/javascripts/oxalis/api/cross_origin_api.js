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

  let returnValue = null;

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
        event.source.postMessage({ type: "err", messageId, message: errorMessage }, "*");
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
        event.source.postMessage({ type: "err", messageId, message: errorMessage }, "*");
        return;
      }
      break;
    }
    case "loadPrecomputedMesh": {
      const segmentId = args[0];
      const seedPosition = args[1];
      api.data.loadPrecomputedMesh(segmentId, seedPosition);
      break;
    }
    case "setMeshVisibility": {
      const segmentId = args[0];
      const isVisible = args[1];
      api.data.setMeshVisibility(segmentId, isVisible);
      break;
    }
    case "removeMesh": {
      const segmentId = args[0];
      api.data.removeMesh(segmentId);
      break;
    }
    case "getAvailableMeshFiles": {
      returnValue = await api.data.getAvailableMeshFiles();
      break;
    }
    case "getActiveMeshFile": {
      returnValue = await api.data.getActiveMeshFile();
      break;
    }
    case "setActiveMeshFile": {
      await api.data.setActiveMeshFile(args[0]);
      break;
    }
    case "resetMeshes": {
      api.data.resetMeshes();
      break;
    }
    default: {
      const errorMessage = `Unsupported cross origin API command: ${type}`;
      console.warn(errorMessage);
      event.source.postMessage({ type: "err", messageId, message: errorMessage }, "*");
      return;
    }
  }
  event.source.postMessage({ type: "ack", messageId, returnValue }, "*");
};

const CrossOriginApi = () => {
  useEffect(() => {
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    if (window.webknossos && window.parent) {
      window.webknossos.apiReady().then(() => {
        window.parent.postMessage({ type: "init" }, "*");
      });
    }
  }, [window.webknossos]);

  return null;
};

export default CrossOriginApi;
