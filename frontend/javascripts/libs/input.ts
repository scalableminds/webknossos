import {
  type BrowserKeyComboEventProps,
  type BrowserKeyEvent,
  bindKeyCombo,
  browserOnKeyPressedBinder,
  browserOnKeyReleasedBinder,
  type KeyEvent,
  setGlobalKeystrokesOptions,
  unbindKeyCombo,
} from "@rwh/keystrokes";
import Hammer from "hammerjs";
import { Keyboard } from "keyboardjs";
import { us } from "keyboardjs/locales/us";
import Date from "libs/date";
import window, { document } from "libs/window";
import extend from "lodash-es/extend";
import { createNanoEvents, type Emitter } from "nanoevents";
import type { ValueOf } from "types/type_utils";
import type { OrthoView, Point2 } from "viewer/constants";
import constants from "viewer/constants";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { addEventListenerWithDelegation, isNoElementFocused } from "./utils";

// Normalizes digit key events so that modifiers don't change the reported key name.
// e.g. Shift+2 on a US keyboard fires event.key="@", but we always want key="2".
function normalizeDigitKeyEvent(event: BrowserKeyEvent): BrowserKeyEvent {
  const code = event.originalEvent?.code ?? "";
  const match = code.match(/^Digit([0-9])$/);
  if (match) {
    return { ...event, key: match[1] };
  }
  return event;
}

// Must be called in order for keystrokes to detect the spacebar as via "space" and not as " ".
// The custom onKeyPressed/onKeyReleased adapters normalize digit keys so that modifier combinations
// like "shift + 2" work regardless of keyboard layout.
setGlobalKeystrokesOptions({
  keyRemap: { " ": "space" },
  onKeyPressed: (handler) =>
    browserOnKeyPressedBinder((event) => handler(normalizeDigitKeyEvent(event))),
  onKeyReleased: (handler) =>
    browserOnKeyReleasedBinder((event) => handler(normalizeDigitKeyEvent(event))),
});

// This is the main Input implementation.
// Although all keys, buttons and sensor are mapped in
// the controller, this is were the magic happens.
// So far we provide the following input methods:
// * Mouse
// * Keyboard
// * MotionSensor / Gyroscope
// Each input method is contained in its own module. We tried to
// provide similar public interfaces for the input methods.
// In most cases the heavy lifting is done by libraries in the background.

export const KEYBOARD_BUTTON_LOOP_INTERVAL = 1000 / constants.FPS;
const MOUSE_MOVE_DELTA_THRESHOLD = 5;

// Keyboard related types
export type ModifierKeys = "alt" | "shift" | "ctrlOrMeta";

//  ---- Type definitions used to interface with Keyboard classes -----

// The format used by keystrokes to define upon which key pressed to trigger an action / handler:
// e.g.: "a" or "control > y, r".
export type KeystrokesKeyComboStr = string;
export type KeyboardNoLoopHandlerFn = (event: KeyboardEvent) => void | Promise<void>;
export type KeyboardNoLoopHandler = {
  onPressed: KeyboardNoLoopHandlerFn;
  onReleased?: KeyboardNoLoopHandlerFn;
};
export type KeyComboToNoLoopHandlerMap = Record<KeystrokesKeyComboStr, KeyboardNoLoopHandler>;

// KeyboardLoop types
export type KeyboardLoopHandlerFn = {
  // Callable Object, see https://www.typescriptlang.org/docs/handbook/2/functions.html#call-signatures
  (arg0: number, isOriginalEvent: boolean, event: KeyboardEvent): void;
  delayed?: boolean;
  lastTime?: number | null | undefined;
  customAdditionalDelayFn?: () => number;
};
export type KeyboardLoopHandler = {
  onPressedWithRepeat: KeyboardLoopHandlerFn;
  onReleased?: KeyboardLoopHandlerFn;
  // When true the handler uses the user-configured keyboard delay from the store.
  delayed?: boolean;
};
export type KeyComboToLoopHandlerMap = Record<KeystrokesKeyComboStr, KeyboardLoopHandler>;
export type KeyboardHandler = KeyboardLoopHandler | KeyboardNoLoopHandler;

// Mouse related types
type MouseClickEvents =
  | "leftClick"
  | "rightClick"
  | "leftDoubleClick"
  | "middleClick"
  | "leftMouseDown"
  | "rightMouseDown"
  | "leftMouseUp"
  | "rightMouseUp";
type MouseMoveEvents = "mouseMove" | "leftDownMove" | "middleDownMove" | "rightDownMove";
type MouseScrollEvents = "scroll";
type MouseHoverEvents = "over" | "out";
type MouseButtonWhich = 1 | 2 | 3;
type MouseButtonString = "left" | "middle" | "right";
type HammerJSEvents = "pinch";
type MouseMoveEventHandler = (
  delta: Point2,
  position: Point2,
  id: OrthoView,
  event: MouseEvent,
) => void;
type MouseClickEventHandler = (
  position: Point2,
  id: OrthoView,
  event: MouseEvent,
  isTouch: boolean,
) => void;
type MouseScrollEventHandler = (
  deltaYorX: number,
  modifier: ModifierKeys | null | undefined,
) => void;
type MouseHoverEventHandler = () => void;
export type MouseHandler =
  | MouseMoveEventHandler
  | MouseClickEventHandler
  | MouseScrollEventHandler
  | MouseHoverEventHandler;
export type HammerJSHandler = (delta: number, center: Point2) => void;
type FullMouseBindingMap = Record<MouseClickEvents, MouseClickEventHandler> &
  Record<MouseMoveEvents, MouseMoveEventHandler> &
  Record<MouseScrollEvents, MouseScrollEventHandler> &
  Record<MouseHoverEvents, MouseHoverEventHandler> &
  Record<HammerJSEvents, HammerJSHandler>;
export type MouseEventHandler = ValueOf<FullMouseBindingMap>;
export type MouseBindingMap = Partial<FullMouseBindingMap>;

// Workaround: KeyboardJS fires event for "C" even if you press
// "Ctrl + C".
function shouldIgnore(event: KeyboardEvent, key: KeystrokesKeyComboStr) {
  const bindingHasCtrl = key.toLowerCase().indexOf("control") !== -1;
  const bindingHasShift = key.toLowerCase().indexOf("shift") !== -1;
  const bindingHasSuper = key.toLowerCase().indexOf("super") !== -1;
  const bindingHasCommand = key.toLowerCase().indexOf("command") !== -1;
  const eventHasCtrl = event.ctrlKey;
  const eventHasShift = event.shiftKey;
  const eventHasSuper = event.metaKey;
  return (
    (eventHasCtrl && !bindingHasCtrl) ||
    (eventHasShift && !bindingHasShift) ||
    (eventHasSuper && !(bindingHasSuper || bindingHasCommand))
  );
}

// Keyboard class capable of handling both one-call (no-looped) and continuous (looped) shortcuts.
// Dispatch is implicit: handlers with `onPressed` fire once per key press; handlers with
// `onPressedWithRepeat` fire continuously at ~60 fps while the key is held.
// Loop handlers with `delayed: true` apply the user-configured keyboard delay from the store.

const keyboard = new Keyboard(
  window,
  document,
  window.navigator?.platform,
  window.navigator?.userAgent,
);
keyboard.setLocale("us", us);
keyboard.setContext("default"); // do not use global context as that is shared between all keycombos

function findEventInKeystrokeComboEvent(
  keyEvents: KeyEvent<KeyboardEvent, BrowserKeyComboEventProps>[],
  finalKeyEvent: KeyEvent<KeyboardEvent, BrowserKeyComboEventProps>,
): KeyboardEvent | undefined {
  if (finalKeyEvent.originalEvent) {
    return finalKeyEvent.originalEvent;
  }
  return keyEvents.find((event) => event.originalEvent)?.originalEvent;
}

// Internal types for interfacing with the keystrokes library.
type KeystrokesHandlerArgs = {
  keyCombo: string;
  keyEvents: KeyEvent<KeyboardEvent, BrowserKeyComboEventProps>[];
  finalKeyEvent: KeyEvent<KeyboardEvent, BrowserKeyComboEventProps>;
};
type KeystrokesHandler = (event: KeystrokesHandlerArgs) => void;
type NoLoopKeystrokesBinding = {
  onPressed?: KeystrokesHandler;
  onReleased?: KeystrokesHandler;
  preventRepeatByDefault: boolean;
};
type LoopKeystrokesBinding = {
  onPressedWithRepeat: KeystrokesHandler;
  onReleased?: KeystrokesHandler;
};

export class InputKeyboard {
  keyCallbackMap: KeyComboToLoopHandlerMap = {};
  keyPressedCount: number = 0;
  bindings: Record<KeystrokesKeyComboStr, NoLoopKeystrokesBinding | LoopKeystrokesBinding> = {};
  isStarted: boolean = true;
  delay: number = 0;
  unsubscribeDelay: (() => void) | null = null;
  supportInputElements: boolean = false;
  isPreventBrowserSearchbarShortcutActive: boolean = false;

  constructor(
    initialBindings: Record<KeystrokesKeyComboStr, KeyboardHandler>,
    options?: {
      supportInputElements?: boolean;
    },
  ) {
    if (options) {
      this.supportInputElements = options.supportInputElements || this.supportInputElements;
    }

    const hasDelayedHandler = Object.values(initialBindings).some(
      (h) => "delayed" in h && h.delayed,
    );
    if (hasDelayedHandler) {
      this.unsubscribeDelay = listenToStoreProperty(
        (state) => state.userConfiguration.keyboardDelay,
        (delay) => {
          this.delay = delay;
        },
        true,
      );
    }

    // Auto focuses the browsers search bar in some browser & os setups.
    // control + k is used by the default tool switching commands and
    // thus focusing the search bar in the browser is explicitly prevented here.
    const usesShortcutToFastFocusBrowserSearchbar = Object.keys(initialBindings).some(
      (keyCombo) => {
        const normalizedKeyCombo = keyCombo.toLowerCase();
        return (
          normalizedKeyCombo.includes("control + k") || normalizedKeyCombo.includes("meta + k")
        );
      },
    );
    if (usesShortcutToFastFocusBrowserSearchbar) {
      document.addEventListener("keydown", this.preventBrowserSearchbarShortcut);
      this.isPreventBrowserSearchbarShortcutActive = true;
    }

    for (const [keyCombo, handler] of Object.entries(initialBindings)) {
      this._attach(keyCombo, handler);
    }
  }

  preventBrowserSearchbarShortcut = (evt: KeyboardEvent) => {
    if ((evt.ctrlKey || evt.metaKey) && evt.key === "k") {
      evt.preventDefault();
      evt.stopPropagation();
    }
  };

  private _attach(
    keyCombo: KeystrokesKeyComboStr,
    handler: KeyboardNoLoopHandler | KeyboardLoopHandler,
  ) {
    if ("onPressed" in handler) {
      this._attachNoLoop(keyCombo, handler);
    } else {
      this._attachLoop(keyCombo, handler);
    }
  }

  _attachNoLoop(
    combo: KeystrokesKeyComboStr,
    { onPressed, onReleased: onRelease }: KeyboardNoLoopHandler,
  ) {
    const onPressedGuarded = ({ keyEvents, finalKeyEvent }: KeystrokesHandlerArgs) => {
      if (!this.isStarted || (!this.supportInputElements && !isNoElementFocused())) {
        return;
      }
      const event = findEventInKeystrokeComboEvent(keyEvents, finalKeyEvent);
      if (!event || shouldIgnore(event, combo)) {
        return;
      }

      if (!event.repeat) {
        onPressed(event);
      } else {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onReleasedInterfaceAdjusted = onRelease
      ? ({ keyEvents, finalKeyEvent }: KeystrokesHandlerArgs) => {
          const event = findEventInKeystrokeComboEvent(keyEvents, finalKeyEvent);
          if (!event) {
            return;
          }
          onRelease(event);
        }
      : () => {};

    const binding: NoLoopKeystrokesBinding = {
      onPressed: onPressedGuarded,
      onReleased: onReleasedInterfaceAdjusted,
      preventRepeatByDefault: false,
    };
    bindKeyCombo(combo, binding);
    this.bindings[combo] = binding;
  }

  _attachLoop(keyCombo: KeystrokesKeyComboStr, handler: KeyboardLoopHandler) {
    let delayTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const { onPressedWithRepeat, onReleased, delayed } = handler;

    const onPressedWithRepeatGuarded = ({ keyEvents, finalKeyEvent }: KeystrokesHandlerArgs) => {
      const event = findEventInKeystrokeComboEvent(keyEvents, finalKeyEvent);
      if (!event) {
        return;
      }
      // When first pressed, insert the callback into keyCallbackMap and start the
      // buttonLoop. Ignore any subsequent OS-level repeat events since we drive our own loop.
      // When control key is pressed, everything is ignored, because if there is any browser
      // action attached to this (as with Ctrl + S) KeyboardJS does not receive the up event.
      if (
        !this.isStarted ||
        this.keyCallbackMap[keyCombo] != null ||
        (!this.supportInputElements && !isNoElementFocused()) ||
        shouldIgnore(event, keyCombo)
      ) {
        return;
      }

      onPressedWithRepeat(1, true, event);
      onPressedWithRepeat.lastTime = null;
      onPressedWithRepeat.delayed = true;
      this.keyCallbackMap[keyCombo] = handler;
      this.keyPressedCount++;

      if (this.keyPressedCount === 1) {
        this.buttonLoop(event);
      }

      const baseDelay = delayed ? this.delay : 0;
      const totalDelay =
        baseDelay +
        (onPressedWithRepeat.customAdditionalDelayFn != null
          ? onPressedWithRepeat.customAdditionalDelayFn()
          : 0);

      if (totalDelay >= 0) {
        delayTimeoutId = setTimeout(() => {
          onPressedWithRepeat.delayed = false;
          onPressedWithRepeat.lastTime = Date.now();
        }, totalDelay);
      }
    };

    const onReleaseGuarded = ({ keyEvents, finalKeyEvent }: KeystrokesHandlerArgs) => {
      if (!this.isStarted) {
        return;
      }

      if (this.keyCallbackMap[keyCombo] != null) {
        this.keyPressedCount--;
        delete this.keyCallbackMap[keyCombo];
      }

      if (delayTimeoutId != null) {
        clearTimeout(delayTimeoutId);
        delayTimeoutId = null;
      }
      const event = findEventInKeystrokeComboEvent(keyEvents, finalKeyEvent);
      if (onReleased != null && event != null) {
        onReleased(1, true, event);
      }
    };

    const binding: LoopKeystrokesBinding = {
      onPressedWithRepeat: onPressedWithRepeatGuarded,
      onReleased: onReleaseGuarded,
    };
    bindKeyCombo(keyCombo, binding);
    this.bindings[keyCombo] = binding;
  }

  // Continuously fires callbacks for all currently held loop keys.
  buttonLoop(originalEvent: KeyboardEvent) {
    if (!this.isStarted) {
      return;
    }

    if (this.keyPressedCount > 0) {
      for (const key of Object.keys(this.keyCallbackMap)) {
        const { onPressedWithRepeat } = this.keyCallbackMap[key];

        if (!onPressedWithRepeat.delayed) {
          const curTime = Date.now();
          // If no lastTime, assume that desired FPS is met
          const lastTime = onPressedWithRepeat.lastTime || curTime - 1000 / constants.FPS;
          const elapsed = curTime - lastTime;
          onPressedWithRepeat.lastTime = curTime;
          onPressedWithRepeat((elapsed / 1000) * constants.FPS, false, originalEvent);
        }
      }

      setTimeout(() => this.buttonLoop(originalEvent), KEYBOARD_BUTTON_LOOP_INTERVAL);
    }
  }

  destroy() {
    this.isStarted = false;

    for (const [keyCombo, binding] of Object.entries(this.bindings)) {
      unbindKeyCombo(keyCombo, binding);
    }
    this.unsubscribeDelay?.();
    if (this.isPreventBrowserSearchbarShortcutActive) {
      document.removeEventListener("keydown", this.preventBrowserSearchbarShortcut);
    }
  }
}

// The mouse module.
// Events: over, out, {left,right}Click, {left,right}DownMove, leftDoubleClick
class InputMouseButton {
  mouse: InputMouse;
  name: MouseButtonString;
  which: MouseButtonWhich;
  id: string;
  down: boolean = false;
  drag: boolean = false;
  moveDelta: number = 0;

  constructor(name: MouseButtonString, which: MouseButtonWhich, mouse: InputMouse, id: string) {
    this.name = name;
    this.which = which;
    this.mouse = mouse;
    this.id = id;
  }

  handleMouseDown(event: MouseEvent): void {
    // event.which is 0 on touch devices as there are no mouse buttons, interpret that as the left mouse button
    // Safari doesn't support evt.buttons, but only evt.which is non-standardized
    const eventWhich = event.which !== 0 ? event.which : 1;

    if (eventWhich === this.which) {
      // @ts-expect-error ts-migrate(2533) FIXME: Object is possibly 'null' or 'undefined'.
      document.activeElement.blur();
      this.down = true;
      this.moveDelta = 0;
      this.mouse.emitter.emit(`${this.name}MouseDown`, this.mouse.lastPosition, this.id, event);
    }
  }

  handleMouseUp(event: MouseEvent, triggeredByTouch: boolean): void {
    // event.which is 0 on touch devices as there are no mouse buttons, interpret that as the left mouse button
    // Safari doesn't support evt.buttons, but only evt.which is non-standardized
    const eventWhich = event.which !== 0 ? event.which : 1;

    if (eventWhich === this.which && this.down) {
      this.mouse.emitter.emit(`${this.name}MouseUp`, event);

      if (this.moveDelta <= MOUSE_MOVE_DELTA_THRESHOLD) {
        this.mouse.emitter.emit(
          `${this.name}Click`,
          this.mouse.lastPosition,
          this.id,
          event,
          triggeredByTouch,
        );
      }

      this.down = false;
    }
  }

  handleDoubleClick(event: MouseEvent, triggeredByTouch: boolean): void {
    // DoubleClick is only supported for the left mouse button
    if (this.name === "left" && this.moveDelta <= MOUSE_MOVE_DELTA_THRESHOLD) {
      this.mouse.emitter.emit(
        "leftDoubleClick",
        this.mouse.lastPosition,
        this.id,
        event,
        triggeredByTouch,
      );
    }
  }

  handleMouseMove(event: MouseEvent, delta: Point2): void {
    if (this.down) {
      this.moveDelta += Math.abs(delta.x) + Math.abs(delta.y);
      this.mouse.emitter.emit(`${this.name}DownMove`, delta, this.mouse.position, this.id, event);
    }
  }
}

let isDragging = false;
export class InputMouse {
  emitter: Emitter;
  targetId: string;
  hammerManager: HammerManager;
  id: string;
  leftMouseButton: InputMouseButton;
  middleMouseButton: InputMouseButton;
  rightMouseButton: InputMouseButton;
  isMouseOver: boolean = false;
  lastPosition: Point2 | null | undefined = null;
  lastScale: number | null | undefined;
  position: Point2 | null | undefined = null;
  triggeredByTouch: boolean = false;
  delegatedEvents: {
    string?: (...args: any[]) => any;
  };

  ignoreScrollingWhileDragging: boolean;

  constructor(
    targetId: string,
    initialBindings: MouseBindingMap,
    id: string,
    ignoreScrollingWhileDragging: boolean = false,
  ) {
    this.emitter = createNanoEvents();

    this.targetId = targetId;
    const targetSelector = `#${targetId}`;
    const domElement = document.getElementById(targetId);

    if (!domElement) {
      throw new Error(`Input couldn't be attached to the following id ${targetId}`);
    }

    this.id = id;
    this.leftMouseButton = new InputMouseButton("left", 1, this, this.id);
    this.middleMouseButton = new InputMouseButton("middle", 2, this, this.id);
    this.rightMouseButton = new InputMouseButton("right", 3, this, this.id);
    this.lastPosition = null;
    this.ignoreScrollingWhileDragging = ignoreScrollingWhileDragging;
    document.addEventListener("mousemove", this.mouseMove);
    document.addEventListener("mouseup", this.mouseUp);
    document.addEventListener("touchend", this.touchEnd);
    document.addEventListener("dblclick", this.doubleClick);

    this.delegatedEvents = {
      ...addEventListenerWithDelegation(document, "mousedown", targetSelector, this.mouseDown),
      ...addEventListenerWithDelegation(document, "mouseover", targetSelector, this.mouseOver),
      ...addEventListenerWithDelegation(document, "mouseout", targetSelector, this.mouseOut),
      ...addEventListenerWithDelegation(document, "touchstart", targetSelector, this.mouseOver),
      ...addEventListenerWithDelegation(document, "touchend", targetSelector, this.mouseOut),
      ...addEventListenerWithDelegation(document, "wheel", targetSelector, this.mouseWheel, {
        passive: false,
      }),
    };

    this.hammerManager = new Hammer(domElement, {
      inputClass: Hammer.TouchInput,
    });
    this.hammerManager.get("pan").set({
      direction: Hammer.DIRECTION_ALL,
    });
    this.hammerManager.get("pinch").set({
      enable: true,
    });
    this.hammerManager.on("panstart", (evt) => this.mouseDown(evt.srcEvent as MouseEvent));
    this.hammerManager.on("panmove", (evt) => this.mouseMove(evt.srcEvent as MouseEvent));
    this.hammerManager.on("panend", (evt) => this.mouseUp(evt.srcEvent as MouseEvent));
    this.hammerManager.on("pinchstart", (evt) => this.pinchStart(evt));
    this.hammerManager.on("pinch", (evt) => this.pinch(evt));
    this.hammerManager.on("pinchend", () => this.pinchEnd());

    for (const [eventName, eventHandler] of Object.entries(initialBindings)) {
      this.emitter.on(eventName, eventHandler);
    }
  }

  destroy() {
    document.removeEventListener("mousemove", this.mouseMove);
    document.removeEventListener("mouseup", this.mouseUp);
    document.removeEventListener("touchend", this.touchEnd);
    document.removeEventListener("dblclick", this.doubleClick);

    for (const [eventName, eventHandler] of Object.entries(this.delegatedEvents)) {
      document.removeEventListener(eventName, eventHandler);
    }

    // Remove all event handlers (see https://github.com/ai/nanoevents#remove-all-listeners)
    this.emitter.events = {};
    // Unbinds all events and input events
    this.hammerManager.destroy();
  }

  isHit(event: MouseEvent) {
    const { pageX, pageY } = event;
    // Check that the mouse event acts on the specified
    // target (as an example, this avoids that mouse events
    // for input catchers are dispatched when a modal is above
    // the input catchers).
    // @ts-expect-error The `id` property exists on DOM elements
    if (event?.target?.id !== this.targetId) {
      return false;
    }
    // Check that the mouse event is in the bounding box of the
    // target element.
    const { left, top, width, height } = this.getElementOffset();
    return left <= pageX && pageX <= left + width && top <= pageY && pageY <= top + height;
  }

  mouseDown = (event: MouseEvent): void => {
    isDragging = true;
    this.lastPosition = this.getRelativeMousePosition(event);
    this.leftMouseButton.handleMouseDown(event);
    this.middleMouseButton.handleMouseDown(event);
    this.rightMouseButton.handleMouseDown(event);
  };

  mouseUp = (event: MouseEvent): void => {
    isDragging = false;
    this.leftMouseButton.handleMouseUp(event, this.triggeredByTouch);
    this.middleMouseButton.handleMouseUp(event, this.triggeredByTouch);
    this.rightMouseButton.handleMouseUp(event, this.triggeredByTouch);
    this.triggeredByTouch = false;

    if (this.isMouseOver) {
      if (!this.isHit(event)) {
        this.mouseOut();
      }
    }

    if (this.isHit(event)) {
      this.mouseOver();
    }
  };

  doubleClick = (event: MouseEvent): void => {
    if (this.isHit(event)) {
      this.leftMouseButton.handleDoubleClick(event, false);
    }
  };

  touchEnd = (): void => {
    // The order of events during a click on a touch enabled device is:
    // touch events -> mouse events -> click
    // so on touchend we set the triggeredByTouch flag, so we can read
    // and forward it during the mouseup event handling
    this.triggeredByTouch = true;
  };

  mouseMove = (event: MouseEvent): void => {
    let delta = null;
    this.position = this.getRelativeMousePosition(event);

    if (this.lastPosition != null) {
      delta = {
        x: this.position.x - this.lastPosition.x,
        y: this.position.y - this.lastPosition.y,
      };
    }

    if (delta != null && (delta.x !== 0 || delta.y !== 0)) {
      this.leftMouseButton.handleMouseMove(event, delta);
      this.middleMouseButton.handleMouseMove(event, delta);
      this.rightMouseButton.handleMouseMove(event, delta);

      if (this.isHit(event)) {
        this.emitter.emit("mouseMove", delta, this.position, this.id, event);
      }
    }

    this.lastPosition = this.position;
  };

  mouseOver = (evt?: MouseEvent): void => {
    if (evt == null || !this.isButtonPressed(evt)) {
      this.isMouseOver = true;
      this.emitter.emit("over");
    }
  };

  mouseOut = (evt?: MouseEvent): void => {
    if (evt == null || !this.isButtonPressed(evt)) {
      this.isMouseOver = false;
      this.emitter.emit("out");
    }
  };

  isButtonPressed(evt: MouseEvent): boolean {
    if (evt.buttons != null) {
      return evt.buttons !== 0;
    } else if (evt.which) {
      return evt.which !== 0;
    }

    return false;
  }

  pinchStart = (evt: HammerInput) => {
    this.lastScale = evt.scale;
    // Save position so we can zoom to the pinch start position
    // Calculate gesture center ourself as there is a bug in the HammerJS calculation
    this.position = this.getRelativeMousePosition({
      pageX: (evt.pointers[0].pageX + evt.pointers[1].pageX) / 2,
      pageY: (evt.pointers[0].pageY + evt.pointers[1].pageY) / 2,
    });
  };

  pinch = (evt: HammerInput): void => {
    // Abort pinch gesture if another finger is added to the gesture
    if (evt.pointers.length > 2) this.pinchEnd();

    if (this.lastScale != null) {
      const delta = evt.scale - this.lastScale;
      this.lastScale = evt.scale;
      this.emitter.emit("pinch", 10 * delta, this.position);
    }
  };

  pinchEnd = () => {
    this.lastScale = null;
  };

  mouseWheel = (event: WheelEvent): void => {
    event.preventDefault();

    if (isDragging && this.ignoreScrollingWhileDragging) {
      return;
    }

    // For some mouses on MacOS, `shift + wheel` will scroll horizontally instead of vertically
    const delta = -(Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY);
    let modifier: ModifierKeys | null | undefined = null;

    if (event.shiftKey) {
      modifier = "shift";
    } else if (event.altKey) {
      modifier = "alt";
    } else if (event.ctrlKey || event.metaKey) {
      modifier = "ctrlOrMeta";
    }

    this.emitter.emit("scroll", delta, modifier);
  };

  getRelativeMousePosition = (pagePosition: {
    pageX: number;
    pageY: number;
    touches?: Array<{
      pageX: number;
      pageY: number;
    }>;
  }) => {
    const offset = this.getElementOffset();

    if (pagePosition.pageX == null && pagePosition.touches != null) {
      pagePosition.pageX = pagePosition.touches[0].pageX;
      pagePosition.pageY = pagePosition.touches[0].pageY;
    }

    return {
      x: pagePosition.pageX - offset.left,
      y: pagePosition.pageY - offset.top,
    };
  };

  getElementOffset() {
    // Return the bounding rectangle relative to the top-left corner of the document
    const boundingRect = document.getElementById(this.targetId)?.getBoundingClientRect() || {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };
    // Don't use {...boundingRect, }, because boundingRect is a DOMRect
    // which isn't compatible with the spreading, apparently.
    return extend({}, boundingRect, {
      left: boundingRect.left + window.scrollX,
      top: boundingRect.top + window.scrollY,
    });
  }
}
