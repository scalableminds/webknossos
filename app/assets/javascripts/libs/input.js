import Backbone from "backbone";
import constants from "oxalis/constants";
import KeyboardJS from "keyboardjs";


const Input = {};
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


// Workaround: KeyboardJS fires event for "C" even if you press
// "Ctrl + C".
const shouldIgnore = function(event, key) {
  const bindingHasCtrl  = key.toLowerCase().indexOf("ctrl") !== -1;
  const bindingHasShift = key.toLowerCase().indexOf("shift") !== -1;
  const eventHasCtrl  = event.ctrlKey || event.metaKey;
  const eventHasShift = event.shiftKey;
  return (eventHasCtrl && !bindingHasCtrl) ||
    (eventHasShift && !bindingHasShift);
};


// This keyboard hook directly passes a keycombo and callback
// to the underlying KeyboadJS library to do its dirty work.
// Pressing a button will only fire an event once.
Input.KeyboardNoLoop = class KeyboardNoLoop {

  constructor(initialBindings) {

    this.bindings = [];
    this.isStarted = true;

    for (let key of Object.keys(initialBindings)) {
      const callback = initialBindings[key];
      this.attach(key, callback);
    }
  }


  attach(key, callback) {

    const binding = [key,
      event => {
        if (!this.isStarted) { return; }
        if ($(":focus").length) { return; }
        if (shouldIgnore(event, key)) { return; }
        callback(event);
      }
    ];

    KeyboardJS.bind(...binding);

    return this.bindings.push(binding);
  }


  destroy() {

    this.isStarted = false;
    for (let binding of this.bindings) { KeyboardJS.unbind(...binding); }
  }
};


// This module is "main" keyboard handler.
// It is able to handle key-presses and will continously
// fire the attached callback.
Input.Keyboard = class Keyboard {
  static initClass() {

    this.prototype.DELAY  = 1000 / constants.FPS;
  }

  constructor(initialBindings, delay) {

    if (delay == null) { delay = 0; }
    this.delay = delay;
    this.keyCallbackMap = {};
    this.keyPressedCount = 0;
    this.bindings = [];
    this.isStarted = true;

    for (let key of Object.keys(initialBindings)) {
      const callback = initialBindings[key];
      this.attach(key, callback);
    }
  }


  attach(key, callback) {

    const binding = [key,
      event => {
        // When first pressed, insert the callback into
        // keyCallbackMap and start the buttonLoop.
        // Then, ignore any other events fired from the operating
        // system, because we're using our own loop.
        // When control key is pressed, everything is ignored, because
        // if there is any browser action attached to this (as with Ctrl + S)
        // KeyboardJS does not receive the up event.

        const returnValue = undefined;

        if (!this.isStarted) { return; }
        if (this.keyCallbackMap[key] != null) { return; }
        if ($(":focus").length) { return; }
        if (shouldIgnore(event, key)) { return; }

        callback(1, true);
        // reset lastTime
        callback._lastTime   = null;
        callback._delayed    = true;
        this.keyCallbackMap[key] = callback;

        this.keyPressedCount++;
        if (this.keyPressedCount === 1) { this.buttonLoop(); }

        if (this.delay >= 0) {
          setTimeout( (() => {
            return callback._delayed = false;
          }
            ), this.delay );
        }

        return returnValue;
      },

      () => {

        if (!this.isStarted) { return; }
        if (this.keyCallbackMap[key] != null) {
          this.keyPressedCount--;
          delete this.keyCallbackMap[key];
        }

      }
    ];

    KeyboardJS.bind(...binding);

    return this.bindings.push(binding);
  }


  // In order to continously fire callbacks we have to loop
  // through all the buttons that a marked as "pressed".
  buttonLoop() {

    if (!this.isStarted) { return; }
    if (this.keyPressedCount > 0) {
      for (let key of Object.keys(this.keyCallbackMap)) {
        const callback = this.keyCallbackMap[key];
        if (!callback._delayed) {

          const curTime  = (new Date()).getTime();
          // If no lastTime, assume that desired FPS is met
          const lastTime = callback._lastTime || (curTime - (1000 / constants.FPS));
          const elapsed  = curTime - lastTime;
          callback._lastTime = curTime;

          callback((elapsed / 1000) * constants.FPS, false);
        }
      }

      return setTimeout( (() => this.buttonLoop()), this.DELAY );
    }
  }


  destroy() {

    this.isStarted = false;
    for (let binding of this.bindings) { KeyboardJS.unbind(...binding); }
  }
};
Input.Keyboard.initClass();


// The mouse module.
// Events: over, out, leftClick, rightClick, leftDownMove
let MouseButton = undefined;
Input.Mouse = class Mouse {
  static initClass() {

    MouseButton = class MouseButton {
      static initClass() {

        this.prototype.MOVE_DELTA_THRESHOLD  = 30;
      }

      constructor(name, which, mouse, id) {
        this.name = name;
        this.which = which;
        this.mouse = mouse;
        this.id = id;
        this.down  = false;
        this.drag  = false;
        this.moveDelta = 0;
      }


      handleMouseDown(event) {

        if (event.which === this.which) {
          $(":focus").blur(); // see OX-159

          this.down = true;
          this.moveDelta = 0;
          return this.mouse.trigger(this.name + "MouseDown", this.mouse.lastPosition, this.id, event);
        }
      }


      handleMouseUp(event) {

        if (event.which === this.which && this.down) {
          this.mouse.trigger(this.name + "MouseUp", event);
          if (this.moveDelta <= this.MOVE_DELTA_THRESHOLD) {
            this.mouse.trigger(this.name + "Click", this.mouse.lastPosition, this.id, event);
          }
          return this.down = false;
        }
      }


      handleMouseMove(event, delta) {

        if (this.down) {
          this.moveDelta += Math.abs( delta.x ) + Math.abs( delta.y );
          return this.mouse.trigger(this.name + "DownMove", delta, this.mouse.position, this.id, event);
        }
      }
    };
    MouseButton.initClass();
  }


  constructor($target, initialBindings, id) {

    this.mouseDown = this.mouseDown.bind(this);
    this.mouseUp = this.mouseUp.bind(this);
    this.mouseMove = this.mouseMove.bind(this);
    this.mouseEnter = this.mouseEnter.bind(this);
    this.mouseLeave = this.mouseLeave.bind(this);
    this.mouseWheel = this.mouseWheel.bind(this);
    this.$target = $target;
    this.id = id;
    _.extend(this, Backbone.Events);

    this.leftMouseButton  = new MouseButton( "left",  1, this, this.id );
    this.rightMouseButton = new MouseButton( "right", 3, this, this.id );
    this.isMouseOver = false;
    this.lastPosition = null;

    $(document).on({
      "mousemove" : this.mouseMove,
      "mouseup"   : this.mouseUp
    });

    this.$target.on({
      "mousedown" : this.mouseDown,
      "mouseenter" : this.mouseEnter,
      "mouseleave" : this.mouseLeave,
      "wheel" : this.mouseWheel
    });

    this.on(initialBindings);
    this.attach = this.on;
  }


  destroy() {

    $(document).off({
      "mousemove" : this.mouseMove,
      "mouseup" : this.mouseUp
    });

    return this.$target.off({
      "mousedown" : this.mouseDown,
      "mouseenter" : this.mouseEnter,
      "mouseleave" : this.mouseLeave,
      "wheel" : this.mouseWheel
    });
  }


  isHit(event) {

    const { pageX, pageY } = event;
    const { left, top } = this.$target.offset();

    return left <= pageX && pageX <= left + this.$target.width() &&
    top <= pageY && pageY <= top + this.$target.height();
  }

  handle(eventName, ...args) {

    return [ this.leftMouseButton, this.rightMouseButton ].map((button) =>
      button[`handle${eventName}`].apply( button, args ));
  }

  mouseDown(event) {

    event.preventDefault();

    this.lastPosition = {
      x : event.pageX - this.$target.offset().left,
      y : event.pageY - this.$target.offset().top
    };

    return this.handle("MouseDown", event);
  }


  mouseUp(event) {

    if (this.isMouseOver) {
      if (!this.isHit(event)) { this.mouseLeave({which : 0}); }
    } else {
      if (this.isHit(event)) { this.mouseEnter({which : 0}); }
    }

    return this.handle("MouseUp", event);
  }


  mouseMove(event) {

    let delta;
    this.position = {
      x : event.pageX - this.$target.offset().left,
      y : event.pageY - this.$target.offset().top
    };

    if (this.lastPosition != null) {

      delta = {
        x : (this.position.x - this.lastPosition.x),
        y : (this.position.y - this.lastPosition.y)
      };
    }

    if (__guard__(delta, x => x.x) !== 0 || __guard__(delta, x1 => x1.y) !== 0) {

      this.handle( "MouseMove", event, delta );

      this.lastPosition = this.position;
    }

  }


  mouseEnter(event) {

    if (!this.isButtonPressed(event)) {
      this.isMouseOver = true;
      this.trigger("over");
    }
  }


  mouseLeave(event) {

    if (!this.isButtonPressed(event)) {
      this.isMouseOver = false;
      this.trigger("out");
    }
  }


  isButtonPressed(event) {

    // Workaround for Firefox: event.which is not set properly

    let b;
    if ((b = __guard__(event.originalEvent, x => x.buttons)) != null) {
      return b !== 0;
    }
    return event.which !== 0;
  }


  mouseWheel(event) {

    event.preventDefault();
    const delta = -event.originalEvent.deltaY;
    if (event.shiftKey) {
      this.trigger("scroll", delta, "shift");
    } else if (event.altKey) {
      this.trigger("scroll", delta, "alt");
    } else if (event.ctrlKey) {
      this.trigger("scroll", delta, "ctrl");
    } else {
      this.trigger("scroll", delta, null);
    }

  }
};
Input.Mouse.initClass();


export default Input;

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
