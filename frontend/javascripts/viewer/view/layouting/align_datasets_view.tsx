import _ from "lodash";
import { Button } from "antd";
import Deferred from "libs/async/deferred";
import { estimateAffineMatrix4x4 } from "libs/estimate_affine";
import { useEffect, useRef, useState } from "react";
import type { Tree } from "viewer/model/types/tree_types";
import { Identity4x4, type Vector3, IdentityTransform } from "viewer/constants";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import { M4x4 } from "libs/mjs";
import { useInterval } from "libs/react_helpers";
import { PushpinOutlined } from "@ant-design/icons";
import {
  createAffineTransform,
  invertTransform,
  Transform,
  transformPointUnscaled,
} from "viewer/model/helpers/transformation_helpers";
import { Matrix4x4 } from "mjs";

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

async function getCorrespondences(iframe1: HTMLIFrameElement, iframe2: HTMLIFrameElement) {
  const nmlString1 = (await sendMessage(iframe1, {
    type: "exportTreesAsNmlString",
    args: [false],
  })) as string;
  const treeCollection1 = (await parseNml(nmlString1)).trees;

  const nmlString2 = (await sendMessage(iframe2, {
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

  return [correspondencePoints1, correspondencePoints2];
}

function AlignDatasetsView() {
  const iframe1 = useRef<HTMLIFrameElement | null>(null);
  const iframe2 = useRef<HTMLIFrameElement | null>(null);

  const [correspondences1, setCorrespondences1] = useState<Vector3[]>([]);
  const [correspondences2, setCorrespondences2] = useState<Vector3[]>([]);

  const [transformMatrix1to2, setTransformMatrix1to2] = useState<Transform>(IdentityTransform);

  const [showBoth, setShowBoth] = useState(false);

  const toggleShowBoth = () => {
    if (iframe1.current == null || iframe2.current == null) {
      return;
    }
    const newShowBoth = !showBoth;
    setShowBoth(newShowBoth);
    if (newShowBoth) {
      for (const layerName of [layerName1, layerName2]) {
        for (const iframe of [iframe1.current, iframe2.current]) {
          sendMessage(iframe, {
            type: "setLayerVisibility",
            args: [layerName, true],
          });
        }
      }
    } else {
      sendMessage(iframe1.current, {
        type: "setLayerVisibility",
        args: [layerName2, false],
      });
      sendMessage(iframe2.current, {
        type: "setLayerVisibility",
        args: [layerName1, false],
      });
    }
  };

  useInterval(async () => {
    if (iframe1.current == null || iframe2.current == null) {
      return;
    }
    const [correspondencePoints1, correspondencePoints2] = await getCorrespondences(
      iframe1.current,
      iframe2.current,
    );

    setCorrespondences1(correspondencePoints1);
    setCorrespondences2(correspondencePoints2);
  }, 500);

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
    const [correspondencePoints1, correspondencePoints2] = await getCorrespondences(
      iframe1.current,
      iframe2.current,
    );

    /* Estimates an affine matrix that transforms from diamond to versaCT. */

    const transforms1to2 = createAffineTransform(correspondencePoints1, correspondencePoints2);
    const transformMatrix = transforms1to2.affineMatrix;
    const transformMatrixInv = transforms1to2.affineMatrixInv;

    setTransformMatrix1to2(transforms1to2);

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

  const onFocusCorrespondence = (p1: Vector3, p2: Vector3) => {
    if (iframe1.current == null || iframe2.current == null) {
      return;
    }

    sendMessage(iframe1.current, {
      type: "centerPositionAnimated",
      args: [p1],
    });
    sendMessage(iframe2.current, {
      type: "centerPositionAnimated",
      args: [p2],
    });
  };

  const onLeftToRight = async () => {
    if (iframe1.current == null || iframe2.current == null) {
      return;
    }
    const pos = (await sendMessage(iframe1.current, {
      type: "getCameraPosition",
      args: [],
    })) as Vector3;
    const transforms2 = (await sendMessage(iframe1.current, {
      type: "getTransformsForLayer",
      args: [layerName2],
    })) as Transform;

    const transformedPos = transformPointUnscaled(invertTransform(transforms2))(pos);

    sendMessage(iframe2.current, {
      type: "centerPositionAnimated",
      args: [transformedPos],
    });
  };
  const onRightToLeft = async () => {
    if (iframe1.current == null || iframe2.current == null) {
      return;
    }
    const pos = (await sendMessage(iframe2.current, {
      type: "getCameraPosition",
      args: [],
    })) as Vector3;
    const transforms1 = (await sendMessage(iframe2.current, {
      type: "getTransformsForLayer",
      args: [layerName1],
    })) as Transform;

    const transformedPos = transformPointUnscaled(invertTransform(transforms1))(pos);

    sendMessage(iframe1.current, {
      type: "centerPositionAnimated",
      args: [transformedPos],
    });
  };

  useEffect(() => {
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="adv-parent">
      <div className="adv-left-side section flex-column" style={{ padding: 5 }}>
        <div className="centered-items">
          <Button onClick={onReset} style={{ marginBottom: 4 }}>
            Reset
          </Button>
        </div>
        <div className="centered-items">
          <Button onClick={onAlign}>Align</Button>
        </div>
        <div className="centered-items">
          <Button onClick={onLeftToRight}>→</Button>
          <Button onClick={onRightToLeft}>←</Button>
        </div>
        <div className="centered-items">
          <Button onClick={toggleShowBoth}> {showBoth ? "Hide Other" : "Show Both"} </Button>
        </div>
        <table>
          {_.zip(correspondences1, correspondences2).map(
            ([p1, p2], index) =>
              p1 &&
              p2 && (
                <tr key={index}>
                  <td>
                    <PushpinOutlined onClick={() => onFocusCorrespondence(p1, p2)} />
                  </td>
                  <td>[{p1.join(", ")}]</td>
                  <td>[{p2.join(", ")}]</td>
                  <td>
                    [
                    {[transformPointUnscaled(transformMatrix1to2)(p1)]
                      .map(([x, y, z]) => [
                        Math.ceil(Math.abs(x - p2[0])),
                        Math.ceil(Math.abs(y - p2[1])),
                        Math.ceil(Math.abs(z - p2[2])),
                      ])
                      .join(", ")}
                    ]
                  </td>
                </tr>
              ),
          )}
        </table>
      </div>
      <div className="adv-middle section">
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
