import app from "app";
import isObject from "lodash-es/isObject";
import isString from "lodash-es/isString";
import { useEffect } from "react";
import { api } from "viewer/singletons";
import { isLayerRegistrationWorker } from "viewer/view/layer_registration/layer_registration_protocol";
import {
  exportLandmarkPairsAsNml,
  importLandmarks,
  setLandmarkPairInfo,
  setLayerRegistrationViewState,
  setOverlayLayerColors,
  useLayerRegistrationShortcutRelay,
} from "viewer/view/layer_registration/layer_registration_worker";

// Some commands only exist for the iframes of the layer registration view. The error is
// caught in onMessage, which logs it and replies with an error.
function assertLayerRegistrationWorker() {
  if (!isLayerRegistrationWorker()) {
    throw new Error("This command is only available in the layer registration view.");
  }
}

// This component allows cross origin communication, for example, between a host page
// and an embedded webKnossos iframe.
// Currently, this is only used for a couple of API functions, but the interface may be extended in the future
// Usage: postMessage({type: "setMapping", args: [mappingObj, options]}, "*")
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'event' implicitly has an 'any' type.
const handleMessage = async (event) => {
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

    // The commands from here to "setAffineLayerTransforms" are used by the layer registration
    // page. Their arguments and return values are declared in IframeCommands
    // (layer_registration_protocol.ts); keep both in line.
    case "importLandmarks": {
      assertLayerRegistrationWorker();
      if (!isString(args[0])) {
        throw new Error("The first argument needs to be the content of the nml as a string.");
      }
      await importLandmarks(args[0]);
      break;
    }

    case "setLandmarkPairInfo": {
      assertLayerRegistrationWorker();
      setLandmarkPairInfo(args[0]);
      break;
    }

    case "setLayerRegistrationViewState": {
      assertLayerRegistrationWorker();
      setLayerRegistrationViewState(args[0]);
      break;
    }

    case "setOverlayLayerColors": {
      assertLayerRegistrationWorker();
      setOverlayLayerColors(args[0]);
      break;
    }

    case "exportLandmarkPairsAsNml": {
      assertLayerRegistrationWorker();
      returnValue = await exportLandmarkPairsAsNml(args[0]);
      break;
    }

    case "setActiveNode": {
      api.tracing.setActiveNode(args[0], args[1], args[2]);
      break;
    }

    case "deleteNode": {
      api.tracing.deleteNode(args[0], args[1]);
      break;
    }

    case "deleteTree": {
      api.tracing.deleteTree(args[0]);
      break;
    }

    case "exportTreesAsNmlString": {
      returnValue = await api.tracing.exportTreesAsNmlString(args[0]);
      break;
    }

    case "replaceTreesInGroup": {
      await api.tracing.replaceTreesInGroup(args[0], args[1]);
      break;
    }

    case "ensureTreeGroupPath": {
      returnValue = api.tracing.ensureTreeGroupPath(args[0]);
      break;
    }

    case "findTreeGroupPath": {
      returnValue = api.tracing.findTreeGroupPath(args[0]);
      break;
    }

    case "setAnnotationName": {
      if (!isString(args[0])) {
        throw new Error("The first argument needs to be the new name as a string.");
      }
      api.tracing.setAnnotationName(args[0]);
      break;
    }

    case "setAnnotationDescription": {
      if (!isString(args[0])) {
        throw new Error("The first argument needs to be the new description as a string.");
      }
      await api.tracing.setAnnotationDescription(args[0]);
      break;
    }

    case "save": {
      await api.tracing.save();
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

    case "setAffineLayerTransforms": {
      api.data._setAffineLayerTransforms(args[0], args[1]);
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

// The window that sent a message, which gets the reply.
type MessageSender = { postMessage: (message: unknown, targetOrigin: string) => void };

// Runs the command of a message and replies with "ack" and the return value, or with "err".
// If a command throws, this logs the error and replies with an error, so that the sender
// doesn't wait for a reply forever.
export async function handleCrossOriginApiMessage(event: {
  data: any;
  source: MessageSender | null;
}) {
  try {
    await handleMessage(event);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = `The cross origin API command "${event.data.type}" failed: ${reason}`;
    console.error(message, error);
    event.source?.postMessage(
      {
        type: "err",
        messageId: event.data.messageId,
        message,
      },
      "*",
    );
  }
}

// The messages of this API come from the windows that embed this page, so their source is a
// window.
const onMessage = (event: MessageEvent) =>
  handleCrossOriginApiMessage({ data: event.data, source: event.source as Window | null });

function CrossOriginApi() {
  useEffect(() => {
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
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
    // Assigning window.webknossos doesn't trigger a re-render, so listen for the event
    // that is emitted right after the assignment. Embedding pages rely on "init".
    if (window.webknossos) {
      sendInit();
      return;
    }
    return app.vent.on("webknossos:initialized", sendInit);
  }, []);
  useLayerRegistrationShortcutRelay();
  return null;
}

export default CrossOriginApi;
