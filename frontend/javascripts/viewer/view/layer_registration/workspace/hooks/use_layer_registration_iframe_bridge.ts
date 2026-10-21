import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Side } from "../../helpers/layer_registration_helpers";
import type {
  IframeRole,
  LayerRegistrationCommand,
  SaveState,
} from "../../layer_registration_protocol";
import { IframeBridge } from "../layer_registration_iframe_bridge";

// The iframe elements of the page. The ref callbacks of the iframes set them.
export type IframeElements = {
  get: (role: IframeRole) => HTMLIFrameElement | null;
  set: (role: IframeRole, iframe: HTMLIFrameElement | null) => void;
};

// The iframe elements are kept in a plain object and not in a ref, because the bridge reads
// them and React doesn't allow passing a ref to a function during render.
function createBridgeWithIframes(): { bridge: IframeBridge; iframes: IframeElements } {
  const elements: Record<IframeRole, HTMLIFrameElement | null> = {
    fixed: null,
    moving: null,
    store: null,
  };
  return {
    bridge: new IframeBridge((role) => elements[role]?.contentWindow, window.location.origin),
    iframes: {
      get: (role) => elements[role],
      set: (role, iframe) => {
        elements[role] = iframe;
      },
    },
  };
}

// Some browsers fire a load event for the initial empty document of an iframe, too. The
// location of a document from another origin can't be read, so that counts as a new page.
function isEmptyDocument(iframe: HTMLIFrameElement): boolean {
  try {
    return iframe.contentWindow?.location.href === "about:blank";
  } catch {
    return false;
  }
}

/** Connects the layer registration page with its iframes (see IframeBridge). The ref callbacks
 * of the three iframes must call iframes.set, and their onLoad events handleIframeLoad.
 * - onWorkerCommand is called for each command that a worker sends (see
 *   layer_registration_protocol.ts).
 * - onIframeReloaded is called when an iframe loads a second page, e.g. because it was
 *   reloaded or navigated away. The iframe then no longer shows the state the page expects.
 * - storeSaveState tells whether the layer registration annotation in the store iframe is saved.
 */
export function useIframeBridge(
  onWorkerCommand: (side: Side, command: LayerRegistrationCommand) => void,
  onIframeReloaded: (role: IframeRole) => void,
) {
  const [{ bridge, iframes }] = useState(createBridgeWithIframes);
  const [storeSaveState, setStoreSaveState] = useState<SaveState>("saved");
  const loadCountsRef = useRef<Record<IframeRole, number>>({ fixed: 0, moving: 0, store: 0 });
  const handleWorkerCommand = useEffectEvent(onWorkerCommand);

  useEffect(() => {
    const onMessage = (event: MessageEvent) =>
      bridge.handleMessage(event, {
        onWorkerCommand: handleWorkerCommand,
        onStoreSaveState: setStoreSaveState,
      });
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bridge]);

  const handleIframeLoad = (role: IframeRole) => {
    const iframe = iframes.get(role);
    if (iframe == null || isEmptyDocument(iframe)) {
      return;
    }
    loadCountsRef.current[role] += 1;
    if (loadCountsRef.current[role] > 1) {
      onIframeReloaded(role);
    }
  };

  return { iframes, sendMessage: bridge.sendMessage, handleIframeLoad, storeSaveState };
}
