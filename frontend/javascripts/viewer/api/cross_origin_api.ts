import app from "app";
import { hasUrlParam, isNoEditableElementFocused } from "libs/utils";
import isObject from "lodash-es/isObject";
import isString from "lodash-es/isString";
import { useEffect } from "react";
import { api } from "viewer/singletons";

// The keys the BigWarp-style dataset alignment coordinator listens for (see
// viewer/view/layouting/align_datasets_view.tsx and BIGWARP_ALIGNMENT_PLAN.md §5.5).
const BIG_WARP_WORKER_SHORTCUT_KEYS = new Set(["t", "f", "q"]);

// This component allows cross origin communication, for example, between a host page
// and an embedded webKnossos iframe.
// Currently, this is only used for a couple of API functions, but the interface may be extended in the future
// Usage: postMessage({type: "setMapping", args: [mappingObj, options]}, "*")
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'event' implicitly has an 'any' type.
const onMessage = async (event) => {
  // We could use this to restrict usage of this api to specific domains
  // if (event.origin !== "https://connectome-viewer.org") {
  //   return;
  // }
  if (!isObject(event.data)) return;
  const { type, args, messageId } = event.data;
  if (type == null || !Array.isArray(args)) return;
  let returnValue = null;

  switch (type) {
    case "setMapping": {
      // @ts-expect-error ts-migrate(2556) FIXME: Expected 2-3 arguments, but got 1 or more.
      api.data.setMapping(api.data.getVolumeTracingLayerName(), ...args);
      break;
    }

    case "resetSkeleton": {
      api.tracing.resetSkeletonTracing();
      break;
    }

    case "setActiveTreeByName": {
      const treeName = args[0];

      if (isString(treeName)) {
        api.tracing.setActiveTreeByName(treeName);
      } else {
        const errorMessage = "The first argument needs to be the name of the tree.";
        console.warn(errorMessage);
        event.source.postMessage(
          {
            type: "err",
            messageId,
            message: errorMessage,
          },
          "*",
        );
        return;
      }

      break;
    }

    case "exportTreesAsNmlString": {
      returnValue = await api.tracing.exportTreesAsNmlString(args[0] ?? false);
      break;
    }

    case "getCameraPosition": {
      returnValue = api.tracing.getCameraPosition();
      break;
    }

    case "centerPositionAnimated": {
      api.tracing.centerPositionAnimated(args[0], false);
      break;
    }

    case "setLayerVisibility": {
      api.data.setLayerVisibility(args[0], args[1]);
      break;
    }

    case "getTransformsForLayer": {
      returnValue = api.data.getTransformsForLayer(args[0]);
      break;
    }

    case "setAffineLayerTransforms": {
      const [layerName, transforms] = args;
      api.data._setAffineLayerTransforms(layerName, transforms);
      break;
    }

    case "importNml": {
      const nmlAsString = args[0];

      if (isString(nmlAsString)) {
        await api.tracing.importNmlAsString(nmlAsString);
      } else {
        const errorMessage = "The first argument needs to be the content of the nml as a string.";
        console.warn(errorMessage);
        event.source.postMessage(
          {
            type: "err",
            messageId,
            message: errorMessage,
          },
          "*",
        );
        return;
      }

      break;
    }

    // The following two commands back the BigWarp-style dataset alignment feature's
    // coordinator/worker sync (see BIGWARP_ALIGNMENT_PLAN.md §3/§5.4): the coordinator
    // uses them on its hidden, persisted "landmark annotation" iframe to merge newly
    // placed landmarks from a worker into the correct per-side tree group.
    case "ensureLandmarkGroups": {
      const [pairGroupName, sideAGroupName, sideBGroupName] = args;
      returnValue = api.tracing.ensureLandmarkGroups(pairGroupName, sideAGroupName, sideBGroupName);
      break;
    }

    case "importNmlIntoGroup": {
      const [nmlAsString, targetGroupId] = args;
      returnValue = await api.tracing.importNmlAsStringIntoGroup(nmlAsString, targetGroupId);
      break;
    }

    case "exportTreesInGroupAsNmlString": {
      const [groupId, applyTransform] = args;
      returnValue = await api.tracing.exportTreesInGroupAsNmlString(
        groupId,
        applyTransform ?? false,
      );
      break;
    }

    case "exportTreesByIdsAsNmlString": {
      const [treeIds, applyTransform] = args;
      returnValue = await api.tracing.exportTreesByIdsAsNmlString(treeIds, applyTransform ?? false);
      break;
    }

    // Used by the BigWarp-style dataset alignment coordinator's "Force Save" button
    // (align_datasets_view.tsx) to flush the persisted "landmark annotation" (the
    // hidden "store" iframe) to the backend on demand, rather than waiting for the
    // normal debounced auto-save - relevant because a full page reload of the
    // coordinator tears down all three iframes essentially at once, which may not
    // leave the store's own beforeunload-triggered save enough time to complete.
    case "save": {
      await api.tracing.save();
      break;
    }

    case "loadPrecomputedMesh": {
      const segmentId = args[0];
      const seedPosition = args[1];
      // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
      returnValue = api.data.getAvailableMeshFiles();
      break;
    }

    case "getActiveMeshFile": {
      returnValue = api.data.getActiveMeshFile();
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
      event.source.postMessage(
        {
          type: "err",
          messageId,
          message: errorMessage,
        },
        "*",
      );
      return;
    }
  }

  event.source.postMessage(
    {
      type: "ack",
      messageId,
      returnValue,
    },
    "*",
  );
};

function CrossOriginApi() {
  useEffect(() => {
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    // A BigWarp worker's own keydown listener has to live inside the worker's iframe
    // (key events don't bubble out to the parent frame), so it relays the keys the
    // coordinator cares about up via postMessage instead of handling them itself.
    if (!hasUrlParam("bigwarpWorker")) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        !BIG_WARP_WORKER_SHORTCUT_KEYS.has(key) ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        !isNoEditableElementFocused()
      ) {
        return;
      }
      event.preventDefault();
      window.parent.postMessage({ type: "bigwarpShortcut", key }, "*");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    const sendInit = () => {
      window.webknossos?.apiReady().then(() => {
        window.parent.postMessage(
          {
            type: "init",
          },
          "*",
        );
      });
    };
    // window.webknossos is assigned in Controller.modelFetchDone(), a plain global
    // mutation that by itself never triggers a React re-render - so depending on it
    // via a useEffect dependency array (as this used to) only fires when some
    // *unrelated* state update happens to cause CrossOriginApi to re-render at just
    // the right moment. That's true today (TracingLayoutView's setControllerStatus
    // does trigger such a re-render right after), but it's an implicit, easy-to-break
    // coincidence rather than an actual guarantee - and it's the kind of thing the
    // BigWarp-style dataset alignment coordinator's postMessage handshake depends on
    // being reliable (see BIGWARP_ALIGNMENT_PLAN.md §0.10). Listening for the
    // "webknossos:initialized" event directly (the same event ApiLoader's own
    // readyPromise is built on, emitted once by modelFetchDone right after
    // window.webknossos is assigned) is unconditionally correct instead.
    if (window.webknossos) {
      // Already initialized before this component's effects ran (e.g. fast refresh).
      sendInit();
      return;
    }
    return app.vent.on("webknossos:initialized", sendInit);
  }, []);
  return null;
}

export default CrossOriginApi;
