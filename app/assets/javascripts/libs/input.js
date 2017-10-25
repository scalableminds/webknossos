/*
 * input.js
 * @flow
 */
/* globals JQueryInputEventObject:false */
import _ from "lodash";
import $ from "jquery";
import Backbone from "backbone";
import constants from "oxalis/constants";
import Date from "libs/date";
import type { Point2 } from "oxalis/constants";
import KeyboardJS from "./keyboardjs_wrapper";
import Hammer from "./hammerjs_wrapper";

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
type KeyboardHandler = (event: JQueryInputEventObject) => void;
type KeyboardLoopHandler = (number, isOriginalEvent: boolean) => void;
type KeyboardBindingPress = [KeyboardKey, KeyboardHandler, KeyboardHandler];
type KeyboardBindingDownUp = [KeyboardKey, KeyboardHandler, KeyboardHandler];
type BindingMap<T: Function> = { [key: KeyboardKey]: T };
type MouseButtonWhichType = 1 | 3;
type MouseButtonStringType = "left" | "right";
type MouseHandlerType =
  | ((deltaY: number, modifier: ?ModifierKeys) => void)
  | ((position: Point2, id: ?string, event: JQueryInputEventObject) => void)
  | ((delta: Point2, position: Point2, id: ?string, event: JQueryInputEventObject) => void);
type HammerJsEvent = {
  center: Point2,
  scale: number,
  srcEvent: JQueryInputEventObject,
};

// Workaround: KeyboardJS fires event for "C" even if you press
// "Ctrl + C".
function shouldIgnore(event: JQueryInputEventObject, key: KeyboardKey) {
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

  constructor(initialBindings: BindingMap<KeyboardHandler>) {
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
        if ($(":focus").length) {
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

  constructor(initialBindings: BindingMap<KeyboardLoopHandler>, delay: number = 0) {
    this.delay = delay;

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
        if ($(":focus").length) {
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

          callback(elapsed / 1000 * constants.FPS, false);
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
  mouse: InputMouse;
  name: MouseButtonStringType;
  which: MouseButtonWhichType;
  id: ?string;
  down: boolean = false;
  drag: boolean = false;
  moveDelta: number = 0;

  constructor(
    name: MouseButtonStringType,
    which: MouseButtonWhichType,
    mouse: InputMouse,
    id: ?string,
  ) {
    this.name = name;
    this.which = which;
    this.mouse = mouse;
    this.id = id;
  }

  handleMouseDown(event: JQueryInputEventObject): void {
    // event.which is 0 on touch devices as there are no mouse buttons, interpret that as the left mouse button
    const eventWhich = event.which !== 0 ? event.which : 1;
    if (eventWhich === this.which) {
      $(":focus").blur(); // see OX-159

      this.down = true;
      this.moveDelta = 0;
      this.mouse.trigger(`${this.name}MouseDown`, this.mouse.lastPosition, this.id, event);
    }
  }

  handleMouseUp(event: JQueryInputEventObject): void {
    // event.which is 0 on touch devices as there are no mouse buttons, interpret that as the left mouse button
    const eventWhich = event.which !== 0 ? event.which : 1;
    if (eventWhich === this.which && this.down) {
      this.mouse.trigger(`${this.name}MouseUp`, event);
      if (this.moveDelta <= MOUSE_MOVE_DELTA_THRESHOLD) {
        this.mouse.trigger(`${this.name}Click`, this.mouse.lastPosition, this.id, event);
      }
      this.down = false;
    }
  }

  handleMouseMove(event: JQueryInputEventObject, delta: Point2): void {
    if (this.down) {
      this.moveDelta += Math.abs(delta.x) + Math.abs(delta.y);
      this.mouse.trigger(`${this.name}DownMove`, delta, this.mouse.position, this.id, event);
    }
  }
}

export class InputMouse {
  $targetSelector: string;
  id: ?string;

  leftMouseButton: InputMouseButton;
  rightMouseButton: InputMouseButton;
  isMouseOver: boolean = false;
  lastPosition: ?Point2 = null;
  lastScale: number = 1;
  position: ?Point2 = null;

  // Copied from backbone events (TODO: handle this better)
  on: (bindings: BindingMap<MouseHandlerType>) => void;
  attach: (bindings: BindingMap<MouseHandlerType>) => void;
  trigger: Function;

  constructor(
    $targetSelector: string,
    initialBindings: BindingMap<MouseHandlerType> = {},
    id: ?string = null,
  ) {
    _.extend(this, Backbone.Events);
    this.$targetSelector = $targetSelector;
    this.id = id;

    this.leftMouseButton = new InputMouseButton("left", 1, this, this.id);
    this.rightMouseButton = new InputMouseButton("right", 3, this, this.id);
    this.lastPosition = null;

    $(document).on({
      mousemove: this.mouseMove,
      mouseup: this.mouseUp,
    });

    $(document).on(
      {
        mousedown: this.mouseDown,
        mouseenter: this.mouseEnter,
        mouseleave: this.mouseLeave,
        touchstart: this.mouseEnter,
        touchend: this.mouseLeave,
        wheel: this.mouseWheel,
      },
      this.$targetSelector,
    );

    const hammerTarget = new Hammer(document.querySelector(this.$targetSelector));
    hammerTarget.get("pan").set({ direction: Hammer.DIRECTION_ALL });
    hammerTarget.get("pinch").set({ enable: true });
    hammerTarget.on("panstart", (evt: HammerJsEvent) => this.mouseDown(evt.srcEvent));
    hammerTarget.on("panmove", (evt: HammerJsEvent) => this.mouseMove(evt.srcEvent));
    hammerTarget.on("panend", (evt: HammerJsEvent) => this.mouseUp(evt.srcEvent));
    hammerTarget.on("pinchstart", (evt: HammerJsEvent) => this.pinchStart(evt));
    hammerTarget.on("pinch", (evt: HammerJsEvent) => this.pinch(evt));

    this.on(initialBindings);
    this.attach = this.on;
  }

  destroy() {
    $(document).off({
      mousemove: this.mouseMove,
      mouseup: this.mouseUp,
    });

    $(document).off(
      {
        mousedown: this.mouseDown,
        mouseenter: this.mouseEnter,
        mouseleave: this.mouseLeave,
        touchstart: this.mouseEnter,
        touchend: this.mouseLeave,
        wheel: this.mouseWheel,
      },
      this.$targetSelector,
    );
  }

  isHit(event: JQueryInputEventObject) {
    const { pageX, pageY } = event;
    const $target = $(this.$targetSelector);
    const { left, top } = $target.offset();

    return (
      left <= pageX &&
      pageX <= left + $target.width() &&
      top <= pageY &&
      pageY <= top + $target.height()
    );
  }

  mouseDown = (event: JQueryInputEventObject): void => {
    event.preventDefault();
    const $target = $(this.$targetSelector);

    this.lastPosition = {
      x: event.pageX - $target.offset().left,
      y: event.pageY - $target.offset().top,
    };

    this.leftMouseButton.handleMouseDown(event);
    this.rightMouseButton.handleMouseDown(event);
  };

  mouseUp = (event: JQueryInputEventObject): void => {
    this.leftMouseButton.handleMouseUp(event);
    this.rightMouseButton.handleMouseUp(event);

    if (this.isMouseOver) {
      if (!this.isHit(event)) {
        this.mouseLeave();
      }
    }
    if (this.isHit(event)) {
      this.mouseEnter();
    }
  };

  mouseMove = (event: JQueryInputEventObject): void => {
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

  mouseEnter = (evt?: JQueryInputEventObject): void => {
    if (evt == null || !this.isButtonPressed(evt)) {
      this.isMouseOver = true;
      this.trigger("over");
    }
  };

  mouseLeave = (evt?: JQueryInputEventObject): void => {
    if (evt == null || !this.isButtonPressed(evt)) {
      this.isMouseOver = false;
      this.trigger("out");
    }
  };

  isButtonPressed(evt: JQueryInputEventObject) {
    if (evt.buttons != null) {
      return evt.buttons !== 0;
    } else {
      // Safari doesn't support evt.buttons
      return evt.which !== 0;
    }
  }

  pinchStart = (evt: HammerJsEvent) => {
    this.lastScale = 1;

    // Save position so we can zoom to the pinch start position
    this.position = this.getRelativeMousePosition({ pageX: evt.center.x, pageY: evt.center.y });
  };

  pinch = (evt: HammerJsEvent): void => {
    const delta = evt.scale - this.lastScale;
    this.lastScale = evt.scale;
    this.trigger("pinch", 10 * delta);
  };

  mouseWheel = (event: JQueryInputEventObject): void => {
    event.preventDefault();
    let delta = 0;
    if (event.originalEvent.deltaY != null) {
      delta = -Number(event.originalEvent.deltaY);
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

  getRelativeMousePosition = (pagePosition: { pageX: number, pageY: number }) => {
    const $target = $(this.$targetSelector);
    return {
      x: pagePosition.pageX - $target.offset().left,
      y: pagePosition.pageY - $target.offset().top,
    };
  };
}
