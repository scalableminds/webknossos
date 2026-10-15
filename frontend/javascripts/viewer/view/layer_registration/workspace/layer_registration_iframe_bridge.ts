import Deferred from "libs/async/deferred";
import isObject from "lodash-es/isObject";
import type { Side } from "../helpers/layer_registration_helpers";
import {
  LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE,
  LAYER_REGISTRATION_STORE_SAVED_STATE_MESSAGE_TYPE,
  type LayerRegistrationCommand,
  type SaveState,
} from "../layer_registration_protocol";

// The layer registration page embeds three annotation views of this app as iframes: the two
// visible workers ("fixed" and "moving") and a hidden one that holds the persisted landmark
// annotation ("store"). The page talks to them through their cross-origin API
// (cross_origin_api.ts).
export type IframeRole = Side | "store";
const IFRAME_ROLES: IframeRole[] = ["fixed", "moving", "store"];
// A command that throws sends an "err" reply, but a reply can still get lost, e.g. if the
// iframe reloads. Generous, because "save" waits for the server.
const REPLY_TIMEOUT_MS = 30_000;

// The messages that the iframes send to this page.
type IncomingMessage = {
  type?: string;
  // Set for LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE.
  command?: LayerRegistrationCommand;
  // Set for LAYER_REGISTRATION_STORE_SAVED_STATE_MESSAGE_TYPE.
  saveState?: SaveState;
  // Set for replies to sendMessage. The type of a reply is "ack" or "err".
  messageId?: string;
  returnValue?: unknown;
  message?: string;
};

// The part of an iframe's window that the bridge needs.
export type IframeWindow = { postMessage: (message: unknown, targetOrigin: string) => void };

export type SendMessage = <T = unknown>(
  role: IframeRole,
  type: string,
  args?: unknown[],
) => Promise<T>;

// What the page does with the messages that are not replies.
export type IncomingMessageHandlers = {
  onWorkerCommand: (side: Side, command: LayerRegistrationCommand) => void;
  onStoreSaveState: (saveState: SaveState) => void;
};

/** The protocol between the layer registration page and its iframes.
 * - sendMessage calls a command of the cross-origin API of an iframe and resolves with its
 *   return value. It waits until the API of that iframe sent "init", and rejects if the
 *   command fails or no reply arrives in time.
 * - handleMessage must get every message that the page receives. It resolves the replies and
 *   passes worker commands and save states of the store iframe on.
 */
export class IframeBridge {
  // Resolved once the API of the respective iframe is ready.
  private readonly readyDeferreds: Record<IframeRole, Deferred<void, unknown>> = {
    fixed: new Deferred(),
    moving: new Deferred(),
    store: new Deferred(),
  };
  private readonly pendingReplies = new Map<string, Deferred<unknown, Error>>();
  private messageCounter = 0;

  constructor(
    // Null while the iframe of the role is not mounted.
    private readonly getIframeWindow: (role: IframeRole) => IframeWindow | null | undefined,
    // The origin of the iframes, which is the origin of the page.
    private readonly targetOrigin: string,
    private readonly replyTimeoutMs: number = REPLY_TIMEOUT_MS,
  ) {}

  private getRoleOfSender(source: unknown): IframeRole | undefined {
    return source == null
      ? undefined
      : IFRAME_ROLES.find((role) => this.getIframeWindow(role) === source);
  }

  private handleReply(messageId: string, reply: IncomingMessage) {
    const deferred = this.pendingReplies.get(messageId);
    if (deferred == null) {
      return;
    }
    this.pendingReplies.delete(messageId);
    if (reply.type === "err") {
      deferred.reject(new Error(reply.message));
    } else {
      deferred.resolve(reply.returnValue);
    }
  }

  handleMessage(
    { source, data }: { source: unknown; data: IncomingMessage },
    { onWorkerCommand, onStoreSaveState }: IncomingMessageHandlers,
  ) {
    const role = this.getRoleOfSender(source);
    if (role == null || !isObject(data)) {
      return;
    }
    if (data.type === "init") {
      this.readyDeferreds[role].resolve();
    } else if (data.messageId != null) {
      this.handleReply(data.messageId, data);
    } else if (
      data.type === LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE &&
      role !== "store" &&
      data.command != null
    ) {
      onWorkerCommand(role, data.command);
    } else if (
      data.type === LAYER_REGISTRATION_STORE_SAVED_STATE_MESSAGE_TYPE &&
      role === "store" &&
      data.saveState != null
    ) {
      onStoreSaveState(data.saveState);
    }
  }

  sendMessage: SendMessage = async <T = unknown>(
    role: IframeRole,
    type: string,
    args: unknown[] = [],
  ): Promise<T> => {
    // An iframe drops messages that arrive before its API is ready.
    await this.readyDeferreds[role].promise();
    const iframeWindow = this.getIframeWindow(role);
    if (iframeWindow == null) {
      throw new Error(`The "${role}" iframe is not mounted.`);
    }
    const messageId = String(++this.messageCounter);
    const deferred = new Deferred<unknown, Error>();
    this.pendingReplies.set(messageId, deferred);
    const timeoutId = setTimeout(() => {
      if (this.pendingReplies.delete(messageId)) {
        deferred.reject(new Error(`The "${role}" iframe did not reply to "${type}" in time.`));
      }
    }, this.replyTimeoutMs);
    iframeWindow.postMessage({ type, args, messageId }, this.targetOrigin);
    try {
      return (await deferred.promise()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
