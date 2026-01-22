import Hammer from "hammerjs";
import { Keyboard } from "keyboardjs";
import { us } from "keyboardjs/locales/us";
import Date from "libs/date";
import window, { document } from "libs/window";
import extend from "lodash/extend";
import noop from "lodash/noop";
import { type Emitter, createNanoEvents } from "nanoevents";
import type { Point2 } from "viewer/constants";
import constants, { isMac } from "viewer/constants";
import { addEventListenerWithDelegation, isNoElementFocused } from "./utils";

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

export type ModifierKeys = "alt" | "shift" | "ctrlOrMeta";
type KeyboardKey = string;
type MouseButton = string;
type KeyboardHandler = (event: KeyboardEvent) => void | Promise<void>;
// Callable Object, see https://www.typescriptlang.org/docs/handbook/2/functions.html#call-signatures
type KeyboardLoopHandler = {
  (arg0: number, isOriginalEvent: boolean, event: KeyboardEvent): void;
  delayed?: boolean;
  lastTime?: number | null | undefined;
  customAdditionalDelayFn?: () => number;
};
type KeyboardBindingPress = [KeyboardKey, KeyboardHandler, KeyboardHandler, boolean];
type KeyboardBindingDownUp = [KeyboardKey, KeyboardHandler, KeyboardHandler, boolean];
type KeyBindingMap = Record<KeyboardKey, KeyboardHandler>;
type KeyBindingLoopMap = Record<KeyboardKey, KeyboardLoopHandler>;
export type MouseBindingMap = Record<MouseButton, MouseHandler>;
type MouseButtonWhich = 1 | 2 | 3;
type MouseButtonString = "left" | "middle" | "right";
export type MouseHandler =
  | ((deltaYorX: number, modifier: ModifierKeys | null | undefined) => void)
  | ((position: Point2, id: string, event: MouseEvent, isTouch: boolean) => void)
  | ((delta: Point2, position: Point2, id: string, event: MouseEvent) => void);

// Workaround: KeyboardJS fires event for "C" even if you press
// "Ctrl + C".
function shouldIgnore(event: KeyboardEvent, key: KeyboardKey) {
  const bindingHasCtrl = key.toLowerCase().indexOf("ctrl") !== -1;
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

// This keyboard hook directly passes a keycombo and callback
// to the underlying KeyboadJS library to do its dirty work.
// Pressing a button will only fire an event once.
const EXTENDED_COMMAND_KEYS = isMac ? "command + k" : "ctrl + k";
const EXTENDED_COMMAND_DURATION = 3000;

const keyboard = new Keyboard(
  window,
  document,
  window.navigator?.platform,
  window.navigator?.userAgent,
);
keyboard.setLocale("us", us);
keyboard.setContext("default"); // do not use global context as that is shared between all keycombos

export class InputKeyboardNoLoop {
  bindings: KeyboardBindingPress[] = [];
  isStarted: boolean = true;
  supportInputElements: boolean = false;
  hasExtendedBindings: boolean = false;
  cancelExtendedModeTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    initialBindings: KeyBindingMap,
    options?: {
      supportInputElements?: boolean;
    },
    extendedCommands?: KeyBindingMap,
    keyUpBindings?: KeyBindingMap,
  ) {
    if (options) {
      this.supportInputElements = options.supportInputElements || this.supportInputElements;
    }

    if (extendedCommands != null && initialBindings[EXTENDED_COMMAND_KEYS] != null) {
      console.warn(
        `Extended commands are enabled, but the keybinding for it is already in use. Please change the keybinding for '${EXTENDED_COMMAND_KEYS}'.`,
      );
    }

    if (extendedCommands) {
      this.hasExtendedBindings = true;
      document.addEventListener("keydown", this.preventBrowserSearchbarShortcut);
      this.attach(EXTENDED_COMMAND_KEYS, this.toggleExtendedMode);
      // Add empty callback in extended mode to deactivate the extended mode via the same EXTENDED_COMMAND_KEYS.
      this.attach(EXTENDED_COMMAND_KEYS, noop, noop, true);
      for (const key of Object.keys(extendedCommands)) {
        const callback = extendedCommands[key];
        this.attach(key, callback, noop, true);
      }
    }

    for (const key of Object.keys(initialBindings)) {
      const callback = initialBindings[key];
      const keyUpCallback = keyUpBindings != null ? keyUpBindings[key] : noop;
      this.attach(key, callback, keyUpCallback);
    }
  }

  toggleExtendedMode = (evt: KeyboardEvent) => {
    evt.preventDefault();
    const isInExtendedMode = keyboard.getContext() === "extended";
    if (isInExtendedMode) {
      this.cancelExtendedModeTimeout();
      keyboard.setContext("default");
      return;
    }
    keyboard.setContext("extended");
    this.cancelExtendedModeTimeoutId = setTimeout(() => {
      keyboard.setContext("default");
    }, EXTENDED_COMMAND_DURATION);
  };

  preventBrowserSearchbarShortcut = (evt: KeyboardEvent) => {
    if ((evt.ctrlKey || evt.metaKey) && evt.key === "k") {
      evt.preventDefault();
      evt.stopPropagation();
    }
  };

  cancelExtendedModeTimeout() {
    if (this.cancelExtendedModeTimeoutId != null) {
      clearTimeout(this.cancelExtendedModeTimeoutId);
      this.cancelExtendedModeTimeoutId = null;
    }
  }

  attach(
    key: KeyboardKey,
    keyDownCallback: KeyboardHandler,
    keyUpCallback: KeyboardHandler = noop,
    isExtendedCommand: boolean = false,
  ) {
    const binding: KeyboardBindingPress = [
      key,
      (event: KeyboardEvent) => {
        if (!this.isStarted) {
          return;
        }

        if (!this.supportInputElements && !isNoElementFocused()) {
          return;
        }

        if (shouldIgnore(event, key)) {
          return;
        }
        const isInExtendedMode = keyboard.getContext() === "extended";

        if (isInExtendedMode) {
          this.cancelExtendedModeTimeout();
          keyboard.setContext("default");
        }

        if (!event.repeat) {
          keyDownCallback(event);
        } else {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      (event: KeyboardEvent) => {
        keyUpCallback(event);
      },
      false,
    ];

    if (isExtendedCommand) {
      keyboard.withContext("extended", () => {
        keyboard.bind(...binding);
      });
    } else {
      keyboard.withContext("default", () => {
        keyboard.bind(...binding);
      });
    }
    return this.bindings.push(binding);
  }

  destroy() {
    this.isStarted = false;

    for (const binding of this.bindings) {
      const [keyCombo, pressHandler, releaseHandler] = binding;
      keyboard.unbind(keyCombo, pressHandler, releaseHandler);
    }
    if (this.hasExtendedBindings) {
      document.removeEventListener("keydown", this.preventBrowserSearchbarShortcut);
    }
  }
}
// This module is "main" keyboard handler.
// It is able to handle key-presses and will continuously
// fire the attached callback.
export class InputKeyboard {
  keyCallbackMap: KeyBindingLoopMap = {};
  keyPressedCount: number = 0;
  bindings: KeyboardBindingDownUp[] = [];
  isStarted: boolean = true;
  delay: number = 0;
  supportInputElements: boolean = false;

  constructor(
    initialBindings: KeyBindingLoopMap,
    options?: {
      delay?: number;
      supportInputElements?: boolean;
    },
  ) {
    if (options) {
      this.delay = options.delay != null ? options.delay : this.delay;
      this.supportInputElements = options.supportInputElements || this.supportInputElements;
    }

    for (const key of Object.keys(initialBindings)) {
      const callback = initialBindings[key];
      this.attach(key, callback);
    }
  }

  attach(key: KeyboardKey, callback: KeyboardLoopHandler) {
    let delayTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const binding: KeyboardBindingDownUp = [
      key,
      (event: KeyboardEvent) => {
        // When first pressed, insert the callback into
        // keyCallbackMap and start the buttonLoop.
        // Then, ignore any other events fired from the operating
        // system, because we're using our own loop.
        // When control key is pressed, everything is ignored, because
        // if there is any browser action attached to this (as with Ctrl + S)
        // KeyboardJS does not receive the up event.
        if (!this.isStarted) {
          return;
        }

        if (this.keyCallbackMap[key] != null) {
          return;
        }

        if (!this.supportInputElements && !isNoElementFocused()) {
          return;
        }

        if (shouldIgnore(event, key)) {
          return;
        }

        callback(1, true, event);
        // reset lastTime
        callback.lastTime = null;
        callback.delayed = true;
        this.keyCallbackMap[key] = callback;
        this.keyPressedCount++;

        if (this.keyPressedCount === 1) {
          this.buttonLoop(event);
        }

        const totalDelay =
          this.delay +
          (callback.customAdditionalDelayFn != null ? callback.customAdditionalDelayFn() : 0);

        if (totalDelay >= 0) {
          delayTimeoutId = setTimeout(() => {
            callback.delayed = false;
            callback.lastTime = new Date().getTime();
          }, totalDelay);
        }
      },
      () => {
        if (!this.isStarted) {
          return;
        }

        if (this.keyCallbackMap[key] != null) {
          this.keyPressedCount--;
          delete this.keyCallbackMap[key];
        }

        if (delayTimeoutId != null) {
          clearTimeout(delayTimeoutId);
          delayTimeoutId = null;
        }
      },
      false, // preventRepeatByDefault
    ];
    keyboard.withContext("default", () => {
      keyboard.bind(...binding);
    });
    this.bindings.push(binding);
  }

  // In order to continuously fire callbacks we have to loop
  // through all the buttons that a marked as "pressed".
  buttonLoop(originalEvent: KeyboardEvent) {
    if (!this.isStarted) {
      return;
    }

    if (this.keyPressedCount > 0) {
      for (const key of Object.keys(this.keyCallbackMap)) {
        const callback = this.keyCallbackMap[key];

        if (!callback.delayed) {
          const curTime = new Date().getTime();
          // If no lastTime, assume that desired FPS is met
          const lastTime = callback.lastTime || curTime - 1000 / constants.FPS;
          const elapsed = curTime - lastTime;
          callback.lastTime = curTime;
          callback((elapsed / 1000) * constants.FPS, false, originalEvent);
        }
      }

      setTimeout(() => this.buttonLoop(originalEvent), KEYBOARD_BUTTON_LOOP_INTERVAL);
    }
  }

  destroy() {
    this.isStarted = false;

    for (const binding of this.bindings) {
      const [keyCombo, pressHandler, releaseHandler] = binding;
      keyboard.unbind(keyCombo, pressHandler, releaseHandler);
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
    // @ts-ignore The `id` property exists on DOM elements
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
