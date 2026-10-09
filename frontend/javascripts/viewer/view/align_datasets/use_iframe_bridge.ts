import Deferred from "libs/async/deferred";
import isObject from "lodash-es/isObject";
import type React from "react";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Side } from "./alignment_helpers";
import {
  BIG_WARP_COMMAND_MESSAGE_TYPE,
  BIG_WARP_STORE_SAVED_STATE_MESSAGE_TYPE,
  type BigWarpCommand,
} from "./bigwarp_protocol";

// The alignment page embeds three annotation views of this app as iframes: the two
// visible workers ("A" and "B") and a hidden one that holds the persisted landmark
// annotation ("store"). The page talks to them through their cross-origin API
// (cross_origin_api.ts).
export type IframeRole = Side | "store";
const IFRAME_ROLES: IframeRole[] = ["A", "B", "store"];
// A command that throws sends an "err" reply, but a reply can still get lost, e.g. if the
// iframe reloads. Generous, because "save" waits for the server.
const REPLY_TIMEOUT_MS = 30_000;

// The messages that the iframes send to this page.
type IncomingMessage = {
  type?: string;
  // Set for BIG_WARP_COMMAND_MESSAGE_TYPE.
  command?: BigWarpCommand;
  // Set for BIG_WARP_STORE_SAVED_STATE_MESSAGE_TYPE.
  isSaved?: boolean;
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

export type SendMessage = <T = unknown>(
  role: IframeRole,
  type: string,
  args?: unknown[],
) => Promise<T>;

/** Connects the alignment page with its iframes. The returned iframesRef must be attached to
 * the three iframes.
 * - sendMessage calls a command of the cross-origin API of an iframe and resolves with its
 *   return value. It waits until the API of that iframe is ready, and rejects if the
 *   command fails or no reply arrives in time.
 * - onWorkerCommand is called for each command that a worker sends (see bigwarp_protocol.ts).
 * - isStoreSaved tells whether the alignment annotation in the store iframe is saved.
 */
export function useIframeBridge(onWorkerCommand: (side: Side, command: BigWarpCommand) => void) {
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
  const [isStoreSaved, setIsStoreSaved] = useState(true);
  const handleWorkerCommand = useEffectEvent(onWorkerCommand);

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
      } else if (
        data.type === BIG_WARP_COMMAND_MESSAGE_TYPE &&
        role !== "store" &&
        data.command != null
      ) {
        handleWorkerCommand(role, data.command);
      } else if (
        data.type === BIG_WARP_STORE_SAVED_STATE_MESSAGE_TYPE &&
        role === "store" &&
        data.isSaved != null
      ) {
        setIsStoreSaved(data.isSaved);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [readyDeferreds]);

  const sendMessage: SendMessage = useCallback(
    async <T = unknown>(role: IframeRole, type: string, args: unknown[] = []): Promise<T> => {
      // An iframe drops messages that arrive before its API is ready.
      await readyDeferreds[role].promise();
      const iframeWindow = iframesRef.current[role]?.contentWindow;
      if (iframeWindow == null) {
        throw new Error(`The "${role}" iframe is not mounted.`);
      }
      const messageId = String(++messageCounterRef.current);
      const deferred = new Deferred<unknown, Error>();
      pendingRepliesRef.current.set(messageId, deferred);
      const timeoutId = setTimeout(() => {
        if (pendingRepliesRef.current.delete(messageId)) {
          deferred.reject(new Error(`The "${role}" iframe did not reply to "${type}" in time.`));
        }
      }, REPLY_TIMEOUT_MS);
      iframeWindow.postMessage({ type, args, messageId }, window.location.origin);
      try {
        return (await deferred.promise()) as T;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    [readyDeferreds],
  );

  return { iframesRef, sendMessage, isStoreSaved };
}
