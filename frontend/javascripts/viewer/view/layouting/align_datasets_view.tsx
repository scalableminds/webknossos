import _ from "lodash";
import { Button } from "antd";
import Deferred from "libs/async/deferred";
import { estimateAffineMatrix4x4 } from "libs/estimate_affine";
import { useEffect, useRef } from "react";
import type { Tree } from "viewer/model/types/tree_types";
import { Identity4x4, type Vector3 } from "viewer/constants";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import { M4x4 } from "libs/mjs";

const deferredsByMessageId: Record<string, Deferred<unknown, unknown>> = {};

function onMessage(message: any) {
  if (message.data.messageId && (message.data.messageId as string).startsWith("adv-")) {
    deferredsByMessageId[message.data.messageId].resolve(message.data.returnValue);

    delete deferredsByMessageId[message.data.messageId];
  }
}

let messageCounter = 0;

function sendMessage(iframe: HTMLIFrameElement, message: Object): Promise<unknown> {
  const deferred = new Deferred();
  const messageId = `adv-${++messageCounter}`;
  deferredsByMessageId[messageId] = deferred;
  iframe.contentWindow?.postMessage({ ...message, messageId }, "*");
  return deferred.promise();
}

const layerName1 = "C555_DIAMOND_2f";
const layerName2 = "C555_versaCT";

function AlignDatasetsView() {
  const iframe1 = useRef<HTMLIFrameElement | null>(null);
  const iframe2 = useRef<HTMLIFrameElement | null>(null);

  const onReset = async () => {
    if (iframe1.current == null || iframe2.current == null) {
      return;
    }
    for (const layerName of [layerName1, layerName2]) {
      await sendMessage(iframe1.current, {
        type: "setAffineLayerTransforms",
        args: [layerName, Identity4x4],
      });
      await sendMessage(iframe2.current, {
        type: "setAffineLayerTransforms",
        args: [layerName, Identity4x4],
      });
    }
  };
  const onAlign = async () => {
    if (iframe1.current == null || iframe2.current == null) {
      return;
    }
    const nmlString1 = (await sendMessage(iframe1.current, {
      type: "exportTreesAsNmlString",
      args: [false],
    })) as string;
    const treeCollection1 = (await parseNml(nmlString1)).trees;

    const nmlString2 = (await sendMessage(iframe2.current, {
      type: "exportTreesAsNmlString",
      args: [false],
    })) as string;

    console.log("nmlString1", nmlString1);
    console.log("nmlString2", nmlString2);

    const treeCollection2 = (await parseNml(nmlString2)).trees;

    const trees1 = Array.from(treeCollection1.values()).toSorted((a, b) => a.treeId - b.treeId);
    const trees2 = Array.from(treeCollection2.values()).toSorted((a, b) => a.treeId - b.treeId);

    const correspondencePoints1 = [];
    const correspondencePoints2 = [];

    for (const [tree1, tree2] of _.zip(trees1, trees2)) {
      if (tree1 == null || tree2 == null) {
        continue;
      }
      const nodes1 = Array.from(tree1.nodes.values()).toSorted((a, b) => a.id - b.id);
      const nodes2 = Array.from(tree2.nodes.values()).toSorted((a, b) => a.id - b.id);

      for (const [node1, node2] of _.zip(nodes1, nodes2)) {
        if (node1 == null || node2 == null) {
          continue;
        }
        correspondencePoints1.push(node1.untransformedPosition);
        correspondencePoints2.push(node2.untransformedPosition);
      }
    }

    /* Estimates an affine matrix that transforms from diamond to versaCT. */

    const transformMatrix = estimateAffineMatrix4x4(correspondencePoints1, correspondencePoints2);
    const transformMatrixInv = M4x4.inverse(transformMatrix);

    console.log("correspondencePoints1", correspondencePoints1);
    console.log("correspondencePoints2", correspondencePoints2);

    await sendMessage(iframe1.current, {
      type: "setAffineLayerTransforms",
      args: [layerName2, transformMatrixInv],
    });
    await sendMessage(iframe2.current, {
      type: "setAffineLayerTransforms",
      args: [layerName1, transformMatrix],
    });
  };

  useEffect(() => {
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="adv-parent">
      <div className="adv-left-side section">
        Left Sidebar
        <Button onClick={onReset}>Reset</Button>
        <Button onClick={onAlign}>Align</Button>
      </div>
      <div className="adv-middle section coral">
        <iframe
          ref={iframe1}
          style={{ width: "100%", height: "100%", border: 0 }}
          src="http://localhost:9000/annotations/691c6b9d2f0100e91ab3d51d#1280,2113,3836,0,9.166"
          title="Second Column Iframe"
        />
      </div>
      <div className="adv-right-side section">
        <iframe
          ref={iframe2}
          style={{ width: "100%", height: "100%", border: 0 }}
          src="http://localhost:9000/annotations/691b6d002f01005f03b3d418#450,555,321,0,0.909"
          title="Second Column Iframe"
        />
      </div>
    </div>
  );
}

export default AlignDatasetsView;
