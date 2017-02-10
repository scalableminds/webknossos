/*
 * input.js
 * @flow
 */
/* globals JQueryInputEventObject:false */
import _ from "lodash";
import $ from "jquery";
import Backbone from "backbone";
import constants from "oxalis/constants";
import KeyboardJS from "keyboardjs";
import type { Point2 } from "oxalis/constants";

// This is the main Input implementation.
// Although all keys, buttons and sensor are mapped in
// the controller, this is were the magic happens.
// So far we provide the following input methods:
// * Mouse
// * Keyboard
// * MotionSensor / Gyroscope

// Each input method is contained in its own module. We tried to
// provide similar public interfaces for the input methods.
// In most cases the heavy lifting is done by librarys in the background.


export type ModifierKeys = "alt" | "shift" | "ctrl";
type KeyboardKey = string;
type KeyboardHandler = (event: JQueryInputEventObject) => void;
type KeyboardLoopHandler = (number, isOriginalEvent: boolean) => void;
type KeyboardBinding = [KeyboardKey, KeyboardHandler];
type BindingMap<T: Function> = { [key: KeyboardKey]: T };
type MouseButtonWhichType = 1 | 3;
type MouseButtonStringType = "left" | "right";
type MouseHandler =
  () => void |
  (position: Point2) => void |
  (deltaY: number, modifier: ?ModifierKeys) => void |
  (position: Point2, id: ?string, event: JQueryInputEventObject) => void |
  (delta: Point2, position: Point2, id: ?string, event: JQueryInputEventObject) => void;
// Workaround: KeyboardJS fires event for "C" even if you press
// "Ctrl + C".
function shouldIgnore(event: JQueryInputEventObject, key: KeyboardKey) {
  const bindingHasCtrl = key.toLowerCase().indexOf("ctrl") !== -1;
  const bindingHasShift = key.toLowerCase().indexOf("shift") !== -1;
  const eventHasCtrl = event.ctrlKey || event.metaKey;
  const eventHasShift = event.shiftKey;
  return (eventHasCtrl && !bindingHasCtrl) ||
    (eventHasShift && !bindingHasShift);
}

// This keyboard hook directly passes a keycombo and callback
// to the underlying KeyboadJS library to do its dirty work.
// Pressing a button will only fire an event once.
export class InputKeyboardNoLoop {
  bindings: Array<KeyboardBinding> = [];
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
      (event) => {
        if (!this.isStarted) { return; }
        if ($(":focus").length) { return; }
        if (shouldIgnore(event, key)) { return; }
        callback(event);
      },
    ];
    KeyboardJS.bind(...binding);
    return this.bindings.push(binding);
  }

  destroy() {
    this.isStarted = false;
    for (const binding of this.bindings) { KeyboardJS.unbind(...binding); }
  }
}


// This module is "main" keyboard handler.
// It is able to handle key-presses and will continously
// fire the attached callback.
export class InputKeyboard {

  DELAY: number = 1000 / constants.FPS;
  keyCallbackMap = {};
  keyPressedCount: number = 0;
  bindings: Array<KeyboardBinding> = [];
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
    const binding = [key,
      (event) => {
        // When first pressed, insert the callback into
        // keyCallbackMap and start the buttonLoop.
        // Then, ignore any other events fired from the operating
        // system, because we're using our own loop.
        // When control key is pressed, everything is ignored, because
        // if there is any browser action attached to this (as with Ctrl + S)
        // KeyboardJS does not receive the up event.

        if (!this.isStarted) { return; }
        if (this.keyCallbackMap[key] != null) { return; }
        if ($(":focus").length) { return; }
        if (shouldIgnore(event, key)) { return; }

        callback(1, true);
        // reset lastTime
        callback.lastTime = null;
        callback.delayed = true;
        this.keyCallbackMap[key] = callback;

        this.keyPressedCount++;
        if (this.keyPressedCount === 1) { this.buttonLoop(); }

        if (this.delay >= 0) {
          setTimeout((() => { callback.delayed = false; }), this.delay);
        }
      },

      () => {
        if (!this.isStarted) { return; }
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
    if (!this.isStarted) { return; }
    if (this.keyPressedCount > 0) {
      for (const key of Object.keys(this.keyCallbackMap)) {
        const callback = this.keyCallbackMap[key];
        if (!callback.delayed) {
          const curTime = (new Date()).getTime();
          // If no lastTime, assume that desired FPS is met
          const lastTime = callback.lastTime || (curTime - (1000 / constants.FPS));
          const elapsed = curTime - lastTime;
          callback.lastTime = curTime;

          callback((elapsed / 1000) * constants.FPS, false);
        }
      }

      setTimeout((() => this.buttonLoop()), this.DELAY);
    }
  }


  destroy() {
    this.isStarted = false;
    for (const binding of this.bindings) { KeyboardJS.unbind(...binding); }
  }
}

// The mouse module.
// Events: over, out, leftClick, rightClick, leftDownMove
class InputMouseButton {
  MOVE_DELTA_THRESHOLD = 30;
  mouse: InputMouse;
  name: MouseButtonStringType;
  which: MouseButtonWhichType;
  id: ?string;
  down: boolean = false;
  drag: boolean = false;
  moveDelta: number = 0;

  constructor(name: MouseButtonStringType, which: MouseButtonWhichType, mouse: InputMouse, id: ?string) {
    this.name = name;
    this.which = which;
    this.mouse = mouse;
    this.id = id;
  }


  handleMouseDown(event: JQueryInputEventObject): void {
    if (event.which === this.which) {
      $(":focus").blur(); // see OX-159

      this.down = true;
      this.moveDelta = 0;
      this.mouse.trigger(`${this.name}MouseDown`, this.mouse.lastPosition, this.id, event);
    }
  }


  handleMouseUp(event: JQueryInputEventObject): void {
    if (event.which === this.which && this.down) {
      this.mouse.trigger(`${this.name}MouseUp`, event);
      if (this.moveDelta <= this.MOVE_DELTA_THRESHOLD) {
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
  $target: JQuery;
  id: ?string;

  leftMouseButton: InputMouseButton;
  rightMouseButton: InputMouseButton;
  isMouseOver: boolean = false;
  lastPosition: ?Point2 = null;
  position: ?Point2 = null;

  // Copied from backbone events (TODO: handle this better)
  on: (bindings: BindingMap<MouseHandler>) => void;
  attach: (bindings: BindingMap<MouseHandler>) => void;
  trigger: Function;

  constructor($target: JQuery, initialBindings: BindingMap<MouseHandler> = {}, id: ?string = null) {
    _.extend(this, Backbone.Events);
    this.$target = $target;
    this.id = id;

    this.leftMouseButton = new InputMouseButton("left", 1, this, this.id);
    this.rightMouseButton = new InputMouseButton("right", 3, this, this.id);
    this.lastPosition = null;

    $(document).on({
      mousemove: this.mouseMove,
      mouseup: this.mouseUp,
    });

    this.$target.on({
      mousedown: this.mouseDown,
      mouseenter: this.mouseEnter,
      mouseleave: this.mouseLeave,
      wheel: this.mouseWheel,
    });

    this.on(initialBindings);
    this.attach = this.on;
  }


  destroy() {
    $(document).off({
      mousemove: this.mouseMove,
      mouseup: this.mouseUp,
    });

    this.$target.off({
      mousedown: this.mouseDown,
      mouseenter: this.mouseEnter,
      mouseleave: this.mouseLeave,
      wheel: this.mouseWheel,
    });
  }


  isHit(event: JQueryInputEventObject) {
    const { pageX, pageY } = event;
    const { left, top } = this.$target.offset();

    return left <= pageX && pageX <= left + this.$target.width() &&
    top <= pageY && pageY <= top + this.$target.height();
  }

  mouseDown = (event: JQueryInputEventObject): void => {
    event.preventDefault();

    this.lastPosition = {
      x: event.pageX - this.$target.offset().left,
      y: event.pageY - this.$target.offset().top,
    };

    this.leftMouseButton.handleMouseDown(event);
    this.rightMouseButton.handleMouseDown(event);
  }


  mouseUp = (event: JQueryInputEventObject): void => {
    if (this.isMouseOver) {
      if (!this.isHit(event)) {
        const eventCopy = _.clone(event);
        eventCopy.which = 0;
        this.mouseLeave(eventCopy);
      }
    } else if (this.isHit(event)) {
      const eventCopy = _.clone(event);
      eventCopy.which = 0;
      this.mouseEnter(eventCopy);
    }

    this.leftMouseButton.handleMouseUp(event);
    this.rightMouseButton.handleMouseUp(event);
  }


  mouseMove = (event: JQueryInputEventObject): void => {
    let delta = null;
    this.position = {
      x: event.pageX - this.$target.offset().left,
      y: event.pageY - this.$target.offset().top,
    };

    if (this.lastPosition != null) {
      delta = {
        x: (this.position.x - this.lastPosition.x),
        y: (this.position.y - this.lastPosition.y),
      };
    }

    if (delta != null && (delta.x !== 0 || delta.y !== 0)) {
      this.leftMouseButton.handleMouseMove(event, delta);
      this.rightMouseButton.handleMouseMove(event, delta);

      this.lastPosition = this.position;
    }
  }


  mouseEnter = (event: JQueryInputEventObject): void => {
    if (!this.isButtonPressed(event)) {
      this.isMouseOver = true;
      this.trigger("over");
    }
  }


  mouseLeave = (event: JQueryInputEventObject): void => {
    if (!this.isButtonPressed(event)) {
      this.isMouseOver = false;
      this.trigger("out");
    }
  }


  isButtonPressed(event: JQueryInputEventObject) {
    // Workaround for Firefox: event.which is not set properly
    if (event.originalEvent.buttons != null) {
      return event.originalEvent.buttons !== 0;
    }
    return event.which !== 0;
  }


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
  }
}
