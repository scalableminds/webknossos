import { Button } from "antd";
import Deferred from "libs/async/deferred";
import { estimateAffineMatrix4x4 } from "libs/estimate_affine";
import { useEffect, useRef } from "react";

const deferredsByMessageId: Record<string, typeof Deferred> = {};

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
  return deferred;
}

function AlignDatasetsView() {
  const iframe1 = useRef<HTMLIFrameElement | null>(null);
  // const iframe2 = useRef<HTMLIFrameElement | null>(null);

  const onClick = async () => {
    if (iframe1.current) {
      const trees = await sendMessage(iframe1.current, {
        type: "getAllTrees",
        args: [],
      });
      console.log("trees", trees);

      const layerName = "color";
      const transformMatrix = [1, 0, 0, 10, 0, 1, 0, 5, 0, 0, 1, 3, 0, 0, 0, 1]; // Matrix4x4 (vector16)

      await sendMessage(iframe1.current, {
        type: "setAffineLayerTransforms",
        args: [layerName, transformMatrix],
      });
    }
  };

  useEffect(() => {
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="adv-parent">
      <div className="adv-left-side section">
        Left Sidebar
        <Button onClick={onClick}>Click</Button>
      </div>
      <div className="adv-middle section coral">
        <iframe
          ref={iframe1}
          style={{ width: "100%", height: "100%", border: 0 }}
          src="http://localhost:9000/annotations/69149e51310100853f836799"
          title="Second Column Iframe"
        />
      </div>
      <div className="adv-right-side section">
        {/*<iframe
          ref={iframe2}
          style={{ width: "100%", height: "100%", border: 0 }}
          src="http://localhost:9000/"
          title="Second Column Iframe"
        />*/}
      </div>
    </div>
  );
}

export default AlignDatasetsView;
