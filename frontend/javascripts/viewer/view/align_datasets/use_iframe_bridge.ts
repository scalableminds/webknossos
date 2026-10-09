import Deferred from "libs/async/deferred";
import isObject from "lodash-es/isObject";
import type React from "react";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Side } from "./alignment_helpers";
import { BIG_WARP_COMMAND_MESSAGE_TYPE, type BigWarpCommand } from "./bigwarp_protocol";

// The alignment page embeds three annotation views of this app as iframes: the two
// visible workers ("A" and "B") and a hidden one that holds the persisted landmark
// annotation ("store"). The page talks to them through their cross-origin API
// (cross_origin_api.ts).
export type IframeRole = Side | "store";
const IFRAME_ROLES: IframeRole[] = ["A", "B", "store"];

// The messages that the iframes send to this page.
type IncomingMessage = {
  type?: string;
  // Set for BIG_WARP_COMMAND_MESSAGE_TYPE.
  command?: BigWarpCommand;
  // Set for replies to sendMessage. The type of a reply is "ack" or "err".
  messageId?: string;
  returnValue?: unknown;
  message?: string;
};

type IframeRefs = React.RefObject<Record<IframeRole, HTMLIFrameElement | null>>;

function getRoleOfSender(iframesRef: IframeRefs, event: MessageEvent): IframeRole | undefined {
  return event.source == null
    ? undefined
    : IFRAME_ROLES.find((role) => iframesRef.current[role]?.contentWindow === event.source);
}

/** Lets the page call cross-origin API commands in its iframes and wait for their replies. */
export function useIframeBridge() {
  const iframesRef = useRef<Record<IframeRole, HTMLIFrameElement | null>>({
    A: null,
    B: null,
    store: null,
  });
  // Resolved once the API of the respective iframe is ready.
  const [readyDeferreds] = useState(() => ({
    A: new Deferred<void, unknown>(),
    B: new Deferred<void, unknown>(),
    store: new Deferred<void, unknown>(),
  }));
  const pendingRepliesRef = useRef(new Map<string, Deferred<unknown, Error>>());
  const messageCounterRef = useRef(0);

  useEffect(() => {
    const handleReply = (messageId: string, reply: IncomingMessage) => {
      const deferred = pendingRepliesRef.current.get(messageId);
      if (deferred == null) {
        return;
      }
      pendingRepliesRef.current.delete(messageId);
      if (reply.type === "err") {
        deferred.reject(new Error(reply.message));
      } else {
        deferred.resolve(reply.returnValue);
      }
    };

    const onMessage = (event: MessageEvent<IncomingMessage>) => {
      const role = getRoleOfSender(iframesRef, event);
      const { data } = event;
      if (role == null || !isObject(data)) {
        return;
      }
      if (data.type === "init") {
        readyDeferreds[role].resolve();
      } else if (data.messageId != null) {
        handleReply(data.messageId, data);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [readyDeferreds]);

  const whenReady = useCallback(
    (role: IframeRole) => readyDeferreds[role].promise(),
    [readyDeferreds],
  );

  // Calls a command of the cross-origin API of the given iframe and resolves with its
  // return value.
  const sendMessage = useCallback(
    <T = unknown>(role: IframeRole, type: string, args: unknown[] = []): Promise<T> => {
      const iframeWindow = iframesRef.current[role]?.contentWindow;
      if (iframeWindow == null) {
        return Promise.reject(new Error(`The "${role}" iframe is not mounted.`));
      }
      const messageId = String(++messageCounterRef.current);
      const deferred = new Deferred<unknown, Error>();
      pendingRepliesRef.current.set(messageId, deferred);
      iframeWindow.postMessage({ type, args, messageId }, window.location.origin);
      return deferred.promise() as Promise<T>;
    },
    [],
  );

  return { iframesRef, whenReady, sendMessage };
}

/**  Calls onCommand for each command that a worker sends (see bigwarp_protocol.ts). */
export function useWorkerCommands(
  iframesRef: IframeRefs,
  onCommand: (side: Side, command: BigWarpCommand) => void,
) {
  const handleCommand = useEffectEvent(onCommand);
  useEffect(() => {
    const onMessage = (event: MessageEvent<IncomingMessage>) => {
      const role = getRoleOfSender(iframesRef, event);
      const { data } = event;
      if (
        role != null &&
        role !== "store" &&
        isObject(data) &&
        data.type === BIG_WARP_COMMAND_MESSAGE_TYPE &&
        data.command != null
      ) {
        handleCommand(role, data.command);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [iframesRef]);
}
