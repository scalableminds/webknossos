/*
 * input.js
 * @flow
 */
import BackboneEvents from "backbone-events-standalone";
import _ from "lodash";

import Date from "libs/date";
import Hammer from "libs/hammerjs_wrapper";
import KeyboardJS from "libs/keyboard";
import * as Utils from "libs/utils";
import constants, { type Point2 } from "oxalis/constants";
import window, { document } from "libs/window";

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
const KEYBOARD_BUTTON_LOOP_INTERVAL = 1000 / constants.FPS;
const MOUSE_MOVE_DELTA_THRESHOLD = 30;

export type ModifierKeys = "alt" | "shift" | "ctrl";
type KeyboardKey = string;
type KeyboardHandler = (event: KeyboardEvent) => void | Promise<void>;
// Callable Object, see https://flow.org/en/docs/types/functions/#toc-callable-objects
type KeyboardLoopHandler = {
  (number, isOriginalEvent: boolean): void,
  delayed: boolean,
  lastTime: ?number,
};
type KeyboardBindingPress = [KeyboardKey, KeyboardHandler, KeyboardHandler];
type KeyboardBindingDownUp = [KeyboardKey, KeyboardHandler, KeyboardHandler];
type BindingMap<T: Function> = { [key: KeyboardKey]: T };
type MouseButtonWhich = 1 | 3;
type MouseButtonString = "left" | "right";
type MouseHandler =
  | ((deltaY: number, modifier: ?ModifierKeys) => void)
  | ((position: Point2, id: ?string, event: MouseEvent) => void)
  | ((delta: Point2, position: Point2, id: ?string, event: MouseEvent) => void);
type HammerJsEvent = {
  center: Point2,
  pointers: Array<Object>,
  scale: number,
  srcEvent: MouseEvent,
};

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
export class InputKeyboardNoLoop {
  bindings: Array<KeyboardBindingPress> = [];
  isStarted: boolean = true;
  supportInputElements: boolean = false;

  constructor(
    initialBindings: BindingMap<KeyboardHandler>,
    options?: { supportInputElements?: boolean },
  ) {
    if (options) {
      this.supportInputElements = options.supportInputElements || this.supportInputElements;
    }
    for (const key of Object.keys(initialBindings)) {
      const callback = initialBindings[key];
      this.attach(key, callback);
    }
  }

  attach(key: KeyboardKey, callback: KeyboardHandler) {
    const binding = [
      key,
      event => {
        if (!this.isStarted) {
          return;
        }
        if (!this.supportInputElements && !Utils.isNoElementFocussed()) {
          return;
        }
        if (shouldIgnore(event, key)) {
          return;
        }
        if (!event.repeat) {
          callback(event);
        } else {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      _.noop,
    ];
    KeyboardJS.bind(...binding);
    return this.bindings.push(binding);
  }

  destroy() {
    this.isStarted = false;
    for (const binding of this.bindings) {
      KeyboardJS.unbind(...binding);
    }
  }
}

// This module is "main" keyboard handler.
// It is able to handle key-presses and will continously
// fire the attached callback.
export class InputKeyboard {
  keyCallbackMap = {};
  keyPressedCount: number = 0;
  bindings: Array<KeyboardBindingDownUp> = [];
  isStarted: boolean = true;
  delay: number = 0;
  supportInputElements: boolean = false;

  constructor(
    initialBindings: BindingMap<KeyboardLoopHandler>,
    options?: { delay?: number, supportInputElements?: boolean },
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
    const binding = [
      key,
      event => {
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
        if (!Utils.isNoElementFocussed()) {
          return;
        }
        if (shouldIgnore(event, key)) {
          return;
        }

        callback(1, true);
        // reset lastTime
        callback.lastTime = null;
        callback.delayed = true;
        this.keyCallbackMap[key] = callback;

        this.keyPressedCount++;
        if (this.keyPressedCount === 1) {
          this.buttonLoop();
        }

        if (this.delay >= 0) {
          setTimeout(() => {
            callback.delayed = false;
          }, this.delay);
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
      },
    ];

    KeyboardJS.bind(...binding);

    this.bindings.push(binding);
  }

  // In order to continously fire callbacks we have to loop
  // through all the buttons that a marked as "pressed".
  buttonLoop() {
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

          callback((elapsed / 1000) * constants.FPS, false);
        }
      }

      setTimeout(() => this.buttonLoop(), KEYBOARD_BUTTON_LOOP_INTERVAL);
    }
  }

  destroy() {
    this.isStarted = false;
    for (const binding of this.bindings) {
      KeyboardJS.unbind(...binding);
    }
  }
}

// The mouse module.
// Events: over, out, leftClick, rightClick, leftDownMove
class InputMouseButton {
  // Remove once https://github.com/babel/babel-eslint/pull/584 is merged
  // eslint-disable-next-line no-use-before-define
  mouse: InputMouse;
  name: MouseButtonString;
  which: MouseButtonWhich;
  id: ?string;
  down: boolean = false;
  drag: boolean = false;
  moveDelta: number = 0;

  constructor(name: MouseButtonString, which: MouseButtonWhich, mouse: InputMouse, id: ?string) {
    this.name = name;
    this.which = which;
    this.mouse = mouse;
    this.id = id;
  }

  handleMouseDown(event: MouseEvent): void {
    // event.which is 0 on touch devices as there are no mouse buttons, interpret that as the left mouse button
    // $FlowFixMe Safari doesn't support evt.buttons, but only evt.which is non-standardized
    const eventWhich = event.which !== 0 ? event.which : 1;
    if (eventWhich === this.which) {
      document.activeElement.blur();

      this.down = true;
      this.moveDelta = 0;
      this.mouse.trigger(`${this.name}MouseDown`, this.mouse.lastPosition, this.id, event);
    }
  }

  handleMouseUp(event: MouseEvent, triggeredByTouch: boolean): void {
    // event.which is 0 on touch devices as there are no mouse buttons, interpret that as the left mouse button
    // $FlowFixMe Safari doesn't support evt.buttons, but only evt.which is non-standardized
    const eventWhich = event.which !== 0 ? event.which : 1;
    if (eventWhich === this.which && this.down) {
      this.mouse.trigger(`${this.name}MouseUp`, event);
      if (this.moveDelta <= MOUSE_MOVE_DELTA_THRESHOLD) {
        this.mouse.trigger(
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

  handleMouseMove(event: MouseEvent, delta: Point2): void {
    if (this.down) {
      this.moveDelta += Math.abs(delta.x) + Math.abs(delta.y);
      this.mouse.trigger(`${this.name}DownMove`, delta, this.mouse.position, this.id, event);
    }
  }
}

let isDragging = false;

export class InputMouse {
  targetId: string;
  hammerManager: typeof Hammer;
  id: ?string;

  leftMouseButton: InputMouseButton;
  rightMouseButton: InputMouseButton;
  isMouseOver: boolean = false;
  lastPosition: ?Point2 = null;
  lastScale: ?number;
  position: ?Point2 = null;
  triggeredByTouch: boolean = false;
  delegatedEvents: { string?: Function };
  ignoreScrollingWhileDragging: boolean;

  // Copied from backbone events (TODO: handle this better)
  on: (bindings: BindingMap<MouseHandler>) => void;
  off: Function;
  trigger: Function;

  constructor(
    targetId: string,
    initialBindings: BindingMap<MouseHandler> = {},
    id: ?string = null,
    ignoreScrollingWhileDragging: boolean = false,
  ) {
    _.extend(this, BackboneEvents);
    this.targetId = targetId;
    const targetSelector = `#${targetId}`;
    const domElement = document.getElementById(targetId);
    if (!domElement) {
      throw new Error(`Input couldn't be attached to the following id ${targetId}`);
    }
    this.id = id;

    this.leftMouseButton = new InputMouseButton("left", 1, this, this.id);
    this.rightMouseButton = new InputMouseButton("right", 3, this, this.id);
    this.lastPosition = null;
    this.delegatedEvents = {};
    this.ignoreScrollingWhileDragging = ignoreScrollingWhileDragging;

    document.addEventListener("mousemove", this.mouseMove);
    document.addEventListener("mouseup", this.mouseUp);
    document.addEventListener("touchend", this.touchEnd);

    _.extend(
      this.delegatedEvents,
      Utils.addEventListenerWithDelegation(document, "mousedown", targetSelector, this.mouseDown),
    );
    _.extend(
      this.delegatedEvents,
      Utils.addEventListenerWithDelegation(document, "mouseover", targetSelector, this.mouseOver),
    );
    _.extend(
      this.delegatedEvents,
      Utils.addEventListenerWithDelegation(document, "mouseout", targetSelector, this.mouseOut),
    );
    _.extend(
      this.delegatedEvents,
      Utils.addEventListenerWithDelegation(document, "touchstart", targetSelector, this.mouseOver),
    );
    _.extend(
      this.delegatedEvents,
      Utils.addEventListenerWithDelegation(document, "touchend", targetSelector, this.mouseOut),
    );
    _.extend(
      this.delegatedEvents,
      Utils.addEventListenerWithDelegation(document, "wheel", targetSelector, this.mouseWheel, {
        passive: false,
      }),
    );

    this.hammerManager = new Hammer(domElement, {
      inputClass: Hammer.TouchInput,
    });
    this.hammerManager.get("pan").set({ direction: Hammer.DIRECTION_ALL });
    this.hammerManager.get("pinch").set({ enable: true });
    this.hammerManager.on("panstart", (evt: HammerJsEvent) => this.mouseDown(evt.srcEvent));
    this.hammerManager.on("panmove", (evt: HammerJsEvent) => this.mouseMove(evt.srcEvent));
    this.hammerManager.on("panend", (evt: HammerJsEvent) => this.mouseUp(evt.srcEvent));
    this.hammerManager.on("pinchstart", (evt: HammerJsEvent) => this.pinchStart(evt));
    this.hammerManager.on("pinch", (evt: HammerJsEvent) => this.pinch(evt));
    this.hammerManager.on("pinchend", () => this.pinchEnd());

    this.on(initialBindings);
  }

  destroy() {
    document.removeEventListener("mousemove", this.mouseMove);
    document.removeEventListener("mouseup", this.mouseUp);
    document.removeEventListener("touchend", this.touchEnd);

    for (const [eventName, eventHandler] of Object.entries(this.delegatedEvents)) {
      document.removeEventListener(eventName, eventHandler);
    }

    this.off();

    // Unbinds all events and input events
    this.hammerManager.destroy();
  }

  isHit(event: MouseEvent) {
    const { pageX, pageY } = event;
    const { left, top, width, height } = this.getElementOffset();

    return left <= pageX && pageX <= left + width && top <= pageY && pageY <= top + height;
  }

  mouseDown = (event: MouseEvent): void => {
    isDragging = true;
    this.lastPosition = this.getRelativeMousePosition(event);

    this.leftMouseButton.handleMouseDown(event);
    this.rightMouseButton.handleMouseDown(event);
  };

  mouseUp = (event: MouseEvent): void => {
    isDragging = false;
    this.leftMouseButton.handleMouseUp(event, this.triggeredByTouch);
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
      this.rightMouseButton.handleMouseMove(event, delta);
      if (this.isHit(event)) {
        this.trigger("mouseMove", delta, this.position, this.id, event);
      }
    }

    this.lastPosition = this.position;
  };

  mouseOver = (evt?: MouseEvent): void => {
    if (evt == null || !this.isButtonPressed(evt)) {
      this.isMouseOver = true;
      this.trigger("over");
    }
  };

  mouseOut = (evt?: MouseEvent): void => {
    if (evt == null || !this.isButtonPressed(evt)) {
      this.isMouseOver = false;
      this.trigger("out");
    }
  };

  isButtonPressed(evt: MouseEvent): boolean {
    if (evt.buttons != null) {
      return evt.buttons !== 0;
      // $FlowFixMe Safari doesn't support evt.buttons, but only evt.which is non-standardized
    } else if (evt.which) {
      return evt.which !== 0;
    }

    return false;
  }

  pinchStart = (evt: HammerJsEvent) => {
    this.lastScale = evt.scale;
    // Save position so we can zoom to the pinch start position
    // Calculate gesture center ourself as there is a bug in the HammerJS calculation
    this.position = this.getRelativeMousePosition({
      pageX: (evt.pointers[0].pageX + evt.pointers[1].pageX) / 2,
      pageY: (evt.pointers[0].pageY + evt.pointers[1].pageY) / 2,
    });
  };

  pinch = (evt: HammerJsEvent): void => {
    // Abort pinch gesture if another finger is added to the gesture
    if (evt.pointers.length > 2) this.pinchEnd();
    if (this.lastScale != null) {
      const delta = evt.scale - this.lastScale;
      this.lastScale = evt.scale;
      this.trigger("pinch", 10 * delta);
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
    let delta = 0;
    if (event.deltaY != null) {
      delta = -Number(event.deltaY);
    }
    let modifier: ?ModifierKeys = null;
    if (event.shiftKey) {
      modifier = "shift";
    } else if (event.altKey) {
      modifier = "alt";
    } else if (event.ctrlKey) {
      modifier = "ctrl";
    }
    this.trigger("scroll", delta, modifier);
  };

  getRelativeMousePosition = (pagePosition: {
    pageX: number,
    pageY: number,
    touches?: Array<{ pageX: number, pageY: number }>,
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
    const boundingRect = document.getElementById(this.targetId).getBoundingClientRect();
    return _.extend({}, boundingRect, {
      left: boundingRect.left + window.scrollX,
      top: boundingRect.top + window.scrollY,
    });
  }
}
