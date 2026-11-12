import Deferred from "libs/async/deferred";
import isObject from "lodash-es/isObject";
import type { Side } from "../helpers/layer_registration_helpers";
import {
  type IframeCommand,
  type IframeCommandMessage,
  type IframeCommands,
  type IframeRole,
  LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE,
  LAYER_REGISTRATION_STORE_SAVED_STATE_MESSAGE_TYPE,
  type LayerRegistrationCommand,
  type SaveState,
  type StoreSaveStateMessage,
  type WorkerCommandMessage,
} from "../layer_registration_protocol";

const IFRAME_ROLES: IframeRole[] = ["fixed", "moving", "store"];
// How long a command waits for the "init" of its iframe, and then for its reply.
// - An iframe that can't load the dataset or the annotation (e.g. no access, or a redirect to
//   the login page) never sends "init".
// - A command that throws sends an "err" reply, but a reply can still get lost, e.g. if the
//   iframe reloads.
// Generous, because loading the iframe and "save" wait for the server.
const TIMEOUT_MS = 30_000;

// Settles like the promise, but rejects with the error message if the promise doesn't settle
// in time.
async function rejectOnTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// The messages that the iframes send to this page (see layer_registration_protocol.ts). They come
// from other windows without a type check, so every field may be missing.
type IncomingMessage = {
  type?: string;
  command?: WorkerCommandMessage["command"];
  saveState?: StoreSaveStateMessage["saveState"];
  // Set for replies to sendMessage.
  messageId?: string;
  returnValue?: unknown;
  message?: string;
};

// The part of an iframe's window that the bridge needs.
export type IframeWindow = { postMessage: (message: unknown, targetOrigin: string) => void };

// Sends a command of IframeCommands to an iframe and resolves with its return value.
export type SendMessage = <C extends IframeCommand>(
  role: IframeRole,
  command: C,
  ...args: IframeCommands[C]["args"]
) => Promise<IframeCommands[C]["returns"]>;

// What the page does with the messages that are not replies.
export type IncomingMessageHandlers = {
  onWorkerCommand: (side: Side, command: LayerRegistrationCommand) => void;
  onStoreSaveState: (saveState: SaveState) => void;
};

/** The page side of the protocol between the layer registration page and its iframes (see
 * layer_registration_protocol.ts).
 * This lives in the layer registration page. The workers use layer_registration_worker.
 * - sendMessage calls a command of the cross-origin API of an iframe and resolves with its
 *   return value. It waits until the API of that iframe sent "init". It rejects if "init" or
 *   the reply don't arrive in time, or if the command fails.
 * - handleMessage must get every message that the page receives. It resolves the replies and
 *   passes worker commands and save states of the store iframe on. It ignores messages that
 *   don't come from one of the iframes or not from the origin of the iframes.
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
    private readonly timeoutMs: number = TIMEOUT_MS,
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
    { source, origin, data }: { source: unknown; origin: string; data: IncomingMessage },
    { onWorkerCommand, onStoreSaveState }: IncomingMessageHandlers,
  ) {
    // An iframe keeps its window when it navigates to a page of another origin, e.g. a login
    // page. That page must not be able to send replies or commands in the name of the iframe.
    if (origin !== this.targetOrigin) {
      return;
    }
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

  sendMessage: SendMessage = async (role, command, ...args) => {
    // An iframe drops messages that arrive before its API is ready.
    await rejectOnTimeout(
      this.readyDeferreds[role].promise(),
      this.timeoutMs,
      `The "${role}" iframe did not finish loading in time.`,
    );
    const iframeWindow = this.getIframeWindow(role);
    if (iframeWindow == null) {
      throw new Error(`The "${role}" iframe is not mounted.`);
    }
    const messageId = String(++this.messageCounter);
    const deferred = new Deferred<unknown, Error>();
    this.pendingReplies.set(messageId, deferred);
    const message: IframeCommandMessage<typeof command> = { type: command, args, messageId };
    iframeWindow.postMessage(message, this.targetOrigin);
    try {
      const returnValue = await rejectOnTimeout(
        deferred.promise(),
        this.timeoutMs,
        `The "${role}" iframe did not reply to "${command}" in time.`,
      );
      // The reply comes from another window, so its type can't be checked. The iframe runs
      // the same code as this page, so it returns what IframeCommands declares.
      return returnValue as IframeCommands[typeof command]["returns"];
    } finally {
      // After a timeout, a late reply is ignored.
      this.pendingReplies.delete(messageId);
    }
  };
}
