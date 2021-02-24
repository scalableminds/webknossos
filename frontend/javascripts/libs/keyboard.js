// @noflow
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
(function(global, factory) {
  typeof exports === "object" && typeof module !== "undefined"
    ? (module.exports = factory())
    : typeof define === "function" && define.amd
    ? define(factory)
    : ((global = global || self), (global.keyboardJS = factory()));
})(this, function() {
  "use strict";

  function _typeof(obj) {
    "@babel/helpers - typeof";

    if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
      _typeof = function(obj) {
        return typeof obj;
      };
    } else {
      _typeof = function(obj) {
        return obj &&
          typeof Symbol === "function" &&
          obj.constructor === Symbol &&
          obj !== Symbol.prototype
          ? "symbol"
          : typeof obj;
      };
    }

    return _typeof(obj);
  }

  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }

  function _defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, descriptor.key, descriptor);
    }
  }

  function _createClass(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps);
    if (staticProps) _defineProperties(Constructor, staticProps);
    return Constructor;
  }

  function _toConsumableArray(arr) {
    return (
      _arrayWithoutHoles(arr) ||
      _iterableToArray(arr) ||
      _unsupportedIterableToArray(arr) ||
      _nonIterableSpread()
    );
  }

  function _arrayWithoutHoles(arr) {
    if (Array.isArray(arr)) return _arrayLikeToArray(arr);
  }

  function _iterableToArray(iter) {
    if (typeof Symbol !== "undefined" && Symbol.iterator in Object(iter)) return Array.from(iter);
  }

  function _unsupportedIterableToArray(o, minLen) {
    if (!o) return;
    if (typeof o === "string") return _arrayLikeToArray(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor) n = o.constructor.name;
    if (n === "Map" || n === "Set") return Array.from(o);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n))
      return _arrayLikeToArray(o, minLen);
  }

  function _arrayLikeToArray(arr, len) {
    if (len == null || len > arr.length) len = arr.length;

    for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];

    return arr2;
  }

  function _nonIterableSpread() {
    throw new TypeError(
      "Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.",
    );
  }

  var KeyCombo = /*#__PURE__*/ (function() {
    function KeyCombo(keyComboStr) {
      _classCallCheck(this, KeyCombo);

      this.sourceStr = keyComboStr;
      this.subCombos = KeyCombo.parseComboStr(keyComboStr);
      this.keyNames = this.subCombos.reduce(function(memo, nextSubCombo) {
        return memo.concat(nextSubCombo);
      }, []);
    }

    _createClass(KeyCombo, [
      {
        key: "check",
        value: function check(pressedKeyNames) {
          var startingKeyNameIndex = 0;

          for (var i = 0; i < this.subCombos.length; i += 1) {
            startingKeyNameIndex = this._checkSubCombo(
              this.subCombos[i],
              startingKeyNameIndex,
              pressedKeyNames,
            );

            if (startingKeyNameIndex === -1) {
              return false;
            }
          }

          return true;
        },
      },
      {
        key: "isEqual",
        value: function isEqual(otherKeyCombo) {
          if (
            !otherKeyCombo ||
            (typeof otherKeyCombo !== "string" && _typeof(otherKeyCombo) !== "object")
          ) {
            return false;
          }

          if (typeof otherKeyCombo === "string") {
            otherKeyCombo = new KeyCombo(otherKeyCombo);
          }

          if (this.subCombos.length !== otherKeyCombo.subCombos.length) {
            return false;
          }

          for (var i = 0; i < this.subCombos.length; i += 1) {
            if (this.subCombos[i].length !== otherKeyCombo.subCombos[i].length) {
              return false;
            }
          }

          for (var _i = 0; _i < this.subCombos.length; _i += 1) {
            var subCombo = this.subCombos[_i];

            var otherSubCombo = otherKeyCombo.subCombos[_i].slice(0);

            for (var j = 0; j < subCombo.length; j += 1) {
              var keyName = subCombo[j];
              var index = otherSubCombo.indexOf(keyName);

              if (index > -1) {
                otherSubCombo.splice(index, 1);
              }
            }

            if (otherSubCombo.length !== 0) {
              return false;
            }
          }

          return true;
        },
      },
      {
        key: "_checkSubCombo",
        value: function _checkSubCombo(subCombo, startingKeyNameIndex, pressedKeyNames) {
          subCombo = subCombo.slice(0);
          pressedKeyNames = pressedKeyNames.slice(startingKeyNameIndex);
          var endIndex = startingKeyNameIndex;

          for (var i = 0; i < subCombo.length; i += 1) {
            var keyName = subCombo[i];

            if (keyName[0] === "\\") {
              var escapedKeyName = keyName.slice(1);

              if (
                escapedKeyName === KeyCombo.comboDeliminator ||
                escapedKeyName === KeyCombo.keyDeliminator
              ) {
                keyName = escapedKeyName;
              }
            }

            var index = pressedKeyNames.indexOf(keyName);

            if (index > -1) {
              subCombo.splice(i, 1);
              i -= 1;

              if (index > endIndex) {
                endIndex = index;
              }

              if (subCombo.length === 0) {
                return endIndex;
              }
            }
          }

          return -1;
        },
      },
    ]);

    return KeyCombo;
  })();
  KeyCombo.comboDeliminator = ">";
  KeyCombo.keyDeliminator = "+";

  KeyCombo.parseComboStr = function(keyComboStr) {
    var subComboStrs = KeyCombo._splitStr(keyComboStr, KeyCombo.comboDeliminator);

    var combo = [];

    for (var i = 0; i < subComboStrs.length; i += 1) {
      combo.push(KeyCombo._splitStr(subComboStrs[i], KeyCombo.keyDeliminator));
    }

    return combo;
  };

  KeyCombo._splitStr = function(str, deliminator) {
    var s = str;
    var d = deliminator;
    var c = "";
    var ca = [];

    for (var ci = 0; ci < s.length; ci += 1) {
      if (ci > 0 && s[ci] === d && s[ci - 1] !== "\\") {
        ca.push(c.trim());
        c = "";
        ci += 1;
      }

      c += s[ci];
    }

    if (c) {
      ca.push(c.trim());
    }

    return ca;
  };

  var Locale = /*#__PURE__*/ (function() {
    function Locale(name) {
      _classCallCheck(this, Locale);

      this.localeName = name;
      this.activeTargetKeys = [];
      this.pressedKeys = [];
      this._appliedMacros = [];
      this._keyMap = {};
      this._killKeyCodes = [];
      this._macros = [];
    }

    _createClass(Locale, [
      {
        key: "bindKeyCode",
        value: function bindKeyCode(keyCode, keyNames) {
          if (typeof keyNames === "string") {
            keyNames = [keyNames];
          }

          this._keyMap[keyCode] = keyNames;
        },
      },
      {
        key: "bindMacro",
        value: function bindMacro(keyComboStr, keyNames) {
          if (typeof keyNames === "string") {
            keyNames = [keyNames];
          }

          var handler = null;

          if (typeof keyNames === "function") {
            handler = keyNames;
            keyNames = null;
          }

          var macro = {
            keyCombo: new KeyCombo(keyComboStr),
            keyNames: keyNames,
            handler: handler,
          };

          this._macros.push(macro);
        },
      },
      {
        key: "getKeyCodes",
        value: function getKeyCodes(keyName) {
          var keyCodes = [];

          for (var keyCode in this._keyMap) {
            var index = this._keyMap[keyCode].indexOf(keyName);

            if (index > -1) {
              keyCodes.push(keyCode | 0);
            }
          }

          return keyCodes;
        },
      },
      {
        key: "getKeyNames",
        value: function getKeyNames(keyCode) {
          return this._keyMap[keyCode] || [];
        },
      },
      {
        key: "setKillKey",
        value: function setKillKey(keyCode) {
          if (typeof keyCode === "string") {
            var keyCodes = this.getKeyCodes(keyCode);

            for (var i = 0; i < keyCodes.length; i += 1) {
              this.setKillKey(keyCodes[i]);
            }

            return;
          }

          this._killKeyCodes.push(keyCode);
        },
      },
      {
        key: "pressKey",
        value: function pressKey(keyCode) {
          if (typeof keyCode === "string") {
            var keyCodes = this.getKeyCodes(keyCode);

            for (var i = 0; i < keyCodes.length; i += 1) {
              this.pressKey(keyCodes[i]);
            }

            return;
          }

          this.activeTargetKeys.length = 0;
          var keyNames = this.getKeyNames(keyCode);

          for (var _i = 0; _i < keyNames.length; _i += 1) {
            this.activeTargetKeys.push(keyNames[_i]);

            if (this.pressedKeys.indexOf(keyNames[_i]) === -1) {
              this.pressedKeys.push(keyNames[_i]);
            }
          }

          this._applyMacros();
        },
      },
      {
        key: "releaseKey",
        value: function releaseKey(keyCode) {
          if (typeof keyCode === "string") {
            var keyCodes = this.getKeyCodes(keyCode);

            for (var i = 0; i < keyCodes.length; i += 1) {
              this.releaseKey(keyCodes[i]);
            }
          } else {
            var keyNames = this.getKeyNames(keyCode);

            var killKeyCodeIndex = this._killKeyCodes.indexOf(keyCode);

            if (killKeyCodeIndex !== -1) {
              this.pressedKeys.length = 0;
            } else {
              for (var _i2 = 0; _i2 < keyNames.length; _i2 += 1) {
                var index = this.pressedKeys.indexOf(keyNames[_i2]);

                if (index > -1) {
                  this.pressedKeys.splice(index, 1);
                }
              }
            }

            this.activeTargetKeys.length = 0;

            this._clearMacros();
          }
        },
      },
      {
        key: "_applyMacros",
        value: function _applyMacros() {
          var macros = this._macros.slice(0);

          for (var i = 0; i < macros.length; i += 1) {
            var macro = macros[i];

            if (macro.keyCombo.check(this.pressedKeys)) {
              if (macro.handler) {
                macro.keyNames = macro.handler(this.pressedKeys);
              }

              for (var j = 0; j < macro.keyNames.length; j += 1) {
                if (this.pressedKeys.indexOf(macro.keyNames[j]) === -1) {
                  this.pressedKeys.push(macro.keyNames[j]);
                }
              }

              this._appliedMacros.push(macro);
            }
          }
        },
      },
      {
        key: "_clearMacros",
        value: function _clearMacros() {
          for (var i = 0; i < this._appliedMacros.length; i += 1) {
            var macro = this._appliedMacros[i];

            if (!macro.keyCombo.check(this.pressedKeys)) {
              for (var j = 0; j < macro.keyNames.length; j += 1) {
                var index = this.pressedKeys.indexOf(macro.keyNames[j]);

                if (index > -1) {
                  this.pressedKeys.splice(index, 1);
                }
              }

              if (macro.handler) {
                macro.keyNames = null;
              }

              this._appliedMacros.splice(i, 1);

              i -= 1;
            }
          }
        },
      },
    ]);

    return Locale;
  })();

  var Keyboard = /*#__PURE__*/ (function() {
    function Keyboard(targetWindow, targetElement, targetPlatform, targetUserAgent) {
      _classCallCheck(this, Keyboard);

      this._locale = null;
      this._currentContext = "";
      this._contexts = {};
      this._listeners = [];
      this._appliedListeners = [];
      this._locales = {};
      this._targetElement = null;
      this._targetWindow = null;
      this._targetPlatform = "";
      this._targetUserAgent = "";
      this._isModernBrowser = false;
      this._targetKeyDownBinding = null;
      this._targetKeyUpBinding = null;
      this._targetResetBinding = null;
      this._paused = false;
      this._contexts.global = {
        listeners: this._listeners,
        targetWindow: targetWindow,
        targetElement: targetElement,
        targetPlatform: targetPlatform,
        targetUserAgent: targetUserAgent,
      };
      this.setContext("global");
    }

    _createClass(Keyboard, [
      {
        key: "setLocale",
        value: function setLocale(localeName, localeBuilder) {
          var locale = null;

          if (typeof localeName === "string") {
            if (localeBuilder) {
              locale = new Locale(localeName);
              localeBuilder(locale, this._targetPlatform, this._targetUserAgent);
            } else {
              locale = this._locales[localeName] || null;
            }
          } else {
            locale = localeName;
            localeName = locale._localeName;
          }

          this._locale = locale;
          this._locales[localeName] = locale;

          if (locale) {
            this._locale.pressedKeys = locale.pressedKeys;
          }

          return this;
        },
      },
      {
        key: "getLocale",
        value: function getLocale(localName) {
          localName || (localName = this._locale.localeName);
          return this._locales[localName] || null;
        },
      },
      {
        key: "bind",
        value: function bind(keyComboStr, pressHandler, releaseHandler, preventRepeatByDefault) {
          if (keyComboStr === null || typeof keyComboStr === "function") {
            preventRepeatByDefault = releaseHandler;
            releaseHandler = pressHandler;
            pressHandler = keyComboStr;
            keyComboStr = null;
          }

          if (
            keyComboStr &&
            _typeof(keyComboStr) === "object" &&
            typeof keyComboStr.length === "number"
          ) {
            for (var i = 0; i < keyComboStr.length; i += 1) {
              this.bind(keyComboStr[i], pressHandler, releaseHandler);
            }

            return this;
          }

          this._listeners.push({
            keyCombo: keyComboStr ? new KeyCombo(keyComboStr) : null,
            pressHandler: pressHandler || null,
            releaseHandler: releaseHandler || null,
            preventRepeat: preventRepeatByDefault || false,
            preventRepeatByDefault: preventRepeatByDefault || false,
            executingHandler: false,
          });

          return this;
        },
      },
      {
        key: "addListener",
        value: function addListener(
          keyComboStr,
          pressHandler,
          releaseHandler,
          preventRepeatByDefault,
        ) {
          return this.bind(keyComboStr, pressHandler, releaseHandler, preventRepeatByDefault);
        },
      },
      {
        key: "on",
        value: function on(keyComboStr, pressHandler, releaseHandler, preventRepeatByDefault) {
          return this.bind(keyComboStr, pressHandler, releaseHandler, preventRepeatByDefault);
        },
      },
      {
        key: "bindPress",
        value: function bindPress(keyComboStr, pressHandler, preventRepeatByDefault) {
          return this.bind(keyComboStr, pressHandler, null, preventRepeatByDefault);
        },
      },
      {
        key: "bindRelease",
        value: function bindRelease(keyComboStr, releaseHandler) {
          return this.bind(keyComboStr, null, releaseHandler, preventRepeatByDefault);
        },
      },
      {
        key: "unbind",
        value: function unbind(keyComboStr, pressHandler, releaseHandler) {
          if (keyComboStr === null || typeof keyComboStr === "function") {
            releaseHandler = pressHandler;
            pressHandler = keyComboStr;
            keyComboStr = null;
          }

          if (
            keyComboStr &&
            _typeof(keyComboStr) === "object" &&
            typeof keyComboStr.length === "number"
          ) {
            for (var i = 0; i < keyComboStr.length; i += 1) {
              this.unbind(keyComboStr[i], pressHandler, releaseHandler);
            }

            return this;
          }

          for (var _i = 0; _i < this._listeners.length; _i += 1) {
            var listener = this._listeners[_i];
            var comboMatches =
              (!keyComboStr && !listener.keyCombo) ||
              (listener.keyCombo && listener.keyCombo.isEqual(keyComboStr));
            var pressHandlerMatches =
              (!pressHandler && !releaseHandler) ||
              (!pressHandler && !listener.pressHandler) ||
              pressHandler === listener.pressHandler;
            var releaseHandlerMatches =
              (!pressHandler && !releaseHandler) ||
              (!releaseHandler && !listener.releaseHandler) ||
              releaseHandler === listener.releaseHandler;

            if (comboMatches && pressHandlerMatches && releaseHandlerMatches) {
              this._listeners.splice(_i, 1);

              _i -= 1;
            }
          }

          return this;
        },
      },
      {
        key: "removeListener",
        value: function removeListener(keyComboStr, pressHandler, releaseHandler) {
          return this.unbind(keyComboStr, pressHandler, releaseHandler);
        },
      },
      {
        key: "off",
        value: function off(keyComboStr, pressHandler, releaseHandler) {
          return this.unbind(keyComboStr, pressHandler, releaseHandler);
        },
      },
      {
        key: "setContext",
        value: function setContext(contextName) {
          if (this._locale) {
            this.releaseAllKeys();
          }

          if (!this._contexts[contextName]) {
            var globalContext = this._contexts.global;
            this._contexts[contextName] = {
              listeners: [],
              targetWindow: globalContext.targetWindow,
              targetElement: globalContext.targetElement,
              targetPlatform: globalContext.targetPlatform,
              targetUserAgent: globalContext.targetUserAgent,
            };
          }

          var context = this._contexts[contextName];
          this._currentContext = contextName;
          this._listeners = context.listeners;
          this.stop();
          this.watch(
            context.targetWindow,
            context.targetElement,
            context.targetPlatform,
            context.targetUserAgent,
          );
          return this;
        },
      },
      {
        key: "getContext",
        value: function getContext() {
          return this._currentContext;
        },
      },
      {
        key: "withContext",
        value: function withContext(contextName, callback) {
          var previousContextName = this.getContext();
          this.setContext(contextName);
          callback();
          this.setContext(previousContextName);
          return this;
        },
      },
      {
        key: "watch",
        value: function watch(targetWindow, targetElement, targetPlatform, targetUserAgent) {
          var _this = this;

          this.stop();
          var win =
            typeof globalThis !== "undefined"
              ? globalThis
              : typeof global !== "undefined"
              ? global
              : typeof window !== "undefined"
              ? window
              : {};

          if (!targetWindow) {
            if (!win.addEventListener && !win.attachEvent) {
              throw new Error("Cannot find window functions addEventListener or attachEvent.");
            }

            targetWindow = win;
          } // Handle element bindings where a target window is not passed

          if (typeof targetWindow.nodeType === "number") {
            targetUserAgent = targetPlatform;
            targetPlatform = targetElement;
            targetElement = targetWindow;
            targetWindow = win;
          }

          if (!targetWindow.addEventListener && !targetWindow.attachEvent) {
            throw new Error("Cannot find addEventListener or attachEvent methods on targetWindow.");
          }

          this._isModernBrowser = !!targetWindow.addEventListener;
          var userAgent = (targetWindow.navigator && targetWindow.navigator.userAgent) || "";
          var platform = (targetWindow.navigator && targetWindow.navigator.platform) || "";
          (targetElement && targetElement !== null) || (targetElement = targetWindow.document);
          (targetPlatform && targetPlatform !== null) || (targetPlatform = platform);
          (targetUserAgent && targetUserAgent !== null) || (targetUserAgent = userAgent);

          this._targetKeyDownBinding = function(event) {
            _this.pressKey(event.keyCode, event);

            _this._handleCommandBug(event, platform);
          };

          this._targetKeyUpBinding = function(event) {
            _this.releaseKey(event.keyCode, event);
          };

          this._targetResetBinding = function(event) {
            _this.releaseAllKeys(event);
          };

          this._bindEvent(targetElement, "keydown", this._targetKeyDownBinding);

          this._bindEvent(targetElement, "keyup", this._targetKeyUpBinding);

          this._bindEvent(targetWindow, "focus", this._targetResetBinding);

          this._bindEvent(targetWindow, "blur", this._targetResetBinding);

          this._targetElement = targetElement;
          this._targetWindow = targetWindow;
          this._targetPlatform = targetPlatform;
          this._targetUserAgent = targetUserAgent;
          var currentContext = this._contexts[this._currentContext];
          currentContext.targetWindow = this._targetWindow;
          currentContext.targetElement = this._targetElement;
          currentContext.targetPlatform = this._targetPlatform;
          currentContext.targetUserAgent = this._targetUserAgent;
          return this;
        },
      },
      {
        key: "stop",
        value: function stop() {
          if (!this._targetElement || !this._targetWindow) {
            return;
          }

          this._unbindEvent(this._targetElement, "keydown", this._targetKeyDownBinding);

          this._unbindEvent(this._targetElement, "keyup", this._targetKeyUpBinding);

          this._unbindEvent(this._targetWindow, "focus", this._targetResetBinding);

          this._unbindEvent(this._targetWindow, "blur", this._targetResetBinding);

          this._targetWindow = null;
          this._targetElement = null;
          return this;
        },
      },
      {
        key: "pressKey",
        value: function pressKey(keyCode, event) {
          if (this._paused) {
            return this;
          }

          if (!this._locale) {
            throw new Error("Locale not set");
          }

          this._locale.pressKey(keyCode);

          this._applyBindings(event);

          return this;
        },
      },
      {
        key: "releaseKey",
        value: function releaseKey(keyCode, event) {
          if (this._paused) {
            return this;
          }

          if (!this._locale) {
            throw new Error("Locale not set");
          }

          this._locale.releaseKey(keyCode);

          this._clearBindings(event);

          return this;
        },
      },
      {
        key: "releaseAllKeys",
        value: function releaseAllKeys(event) {
          if (this._paused) {
            return this;
          }

          if (!this._locale) {
            throw new Error("Locale not set");
          }

          this._locale.pressedKeys.length = 0;

          this._clearBindings(event);

          return this;
        },
      },
      {
        key: "pause",
        value: function pause() {
          if (this._paused) {
            return this;
          }

          if (this._locale) {
            this.releaseAllKeys();
          }

          this._paused = true;
          return this;
        },
      },
      {
        key: "resume",
        value: function resume() {
          this._paused = false;
          return this;
        },
      },
      {
        key: "reset",
        value: function reset() {
          this.releaseAllKeys();
          this._listeners.length = 0;
          return this;
        },
      },
      {
        key: "_bindEvent",
        value: function _bindEvent(targetElement, eventName, handler) {
          return this._isModernBrowser
            ? targetElement.addEventListener(eventName, handler, false)
            : targetElement.attachEvent("on" + eventName, handler);
        },
      },
      {
        key: "_unbindEvent",
        value: function _unbindEvent(targetElement, eventName, handler) {
          return this._isModernBrowser
            ? targetElement.removeEventListener(eventName, handler, false)
            : targetElement.detachEvent("on" + eventName, handler);
        },
      },
      {
        key: "_getGroupedListeners",
        value: function _getGroupedListeners() {
          var listenerGroups = [];
          var listenerGroupMap = [];
          var listeners = this._listeners;

          if (this._currentContext !== "global") {
            listeners = [].concat(
              _toConsumableArray(listeners),
              _toConsumableArray(this._contexts.global.listeners),
            );
          }

          listeners
            .sort(function(a, b) {
              return (
                (b.keyCombo ? b.keyCombo.keyNames.length : 0) -
                (a.keyCombo ? a.keyCombo.keyNames.length : 0)
              );
            })
            .forEach(function(l) {
              var mapIndex = -1;

              for (var i = 0; i < listenerGroupMap.length; i += 1) {
                if (
                  (listenerGroupMap[i] === null && l.keyCombo === null) ||
                  (listenerGroupMap[i] !== null && listenerGroupMap[i].isEqual(l.keyCombo))
                ) {
                  mapIndex = i;
                }
              }

              if (mapIndex === -1) {
                mapIndex = listenerGroupMap.length;
                listenerGroupMap.push(l.keyCombo);
              }

              if (!listenerGroups[mapIndex]) {
                listenerGroups[mapIndex] = [];
              }

              listenerGroups[mapIndex].push(l);
            });
          return listenerGroups;
        },
      },
      {
        key: "_applyBindings",
        value: function _applyBindings(event) {
          var _this2 = this;

          var preventRepeat = false;
          event || (event = {});

          event.preventRepeat = function() {
            preventRepeat = true;
          };

          event.pressedKeys = this._locale.pressedKeys.slice(0);
          var activeTargetKeys = this._locale.activeTargetKeys;

          var pressedKeys = this._locale.pressedKeys.slice(0);

          var listenerGroups = this._getGroupedListeners();

          var _loop = function _loop(i) {
            var listeners = listenerGroups[i];
            var keyCombo = listeners[0].keyCombo;

            if (
              keyCombo === null ||
              keyCombo.check(pressedKeys) // &&
              // activeTargetKeys.some(function(k) {
              //   return keyCombo.keyNames.includes(k);
              // }))
            ) {
              for (var j = 0; j < listeners.length; j += 1) {
                var listener = listeners[j];

                if (
                  !listener.executingHandler &&
                  listener.pressHandler &&
                  !listener.preventRepeat
                ) {
                  listener.executingHandler = true;
                  listener.pressHandler.call(_this2, event);
                  listener.executingHandler = false;

                  if (preventRepeat || listener.preventRepeatByDefault) {
                    listener.preventRepeat = true;
                    preventRepeat = false;
                  }
                }

                if (_this2._appliedListeners.indexOf(listener) === -1) {
                  _this2._appliedListeners.push(listener);
                }
              }

              if (keyCombo) {
                for (var _j = 0; _j < keyCombo.keyNames.length; _j += 1) {
                  var index = pressedKeys.indexOf(keyCombo.keyNames[_j]);

                  if (index !== -1) {
                    pressedKeys.splice(index, 1);
                    _j -= 1;
                  }
                }
              }
            }
          };

          for (var i = 0; i < listenerGroups.length; i += 1) {
            _loop(i);
          }
        },
      },
      {
        key: "_clearBindings",
        value: function _clearBindings(event) {
          event || (event = {});
          event.pressedKeys = this._locale.pressedKeys.slice(0);

          for (var i = 0; i < this._appliedListeners.length; i += 1) {
            var listener = this._appliedListeners[i];
            var keyCombo = listener.keyCombo;

            if (keyCombo === null || !keyCombo.check(this._locale.pressedKeys)) {
              listener.preventRepeat = false;

              if (keyCombo !== null || event.pressedKeys.length === 0) {
                this._appliedListeners.splice(i, 1);

                i -= 1;
              }

              if (!listener.executingHandler && listener.releaseHandler) {
                listener.executingHandler = true;
                listener.releaseHandler.call(this, event);
                listener.executingHandler = false;
              }
            }
          }
        },
      },
      {
        key: "_handleCommandBug",
        value: function _handleCommandBug(event, platform) {
          // On Mac when the command key is kept pressed, keyup is not triggered for any other key.
          // In this case force a keyup for non-modifier keys directly after the keypress.
          var modifierKeys = ["shift", "ctrl", "alt", "capslock", "tab", "command"];

          if (
            platform.match("Mac") &&
            this._locale.pressedKeys.includes("command") &&
            !modifierKeys.includes(this._locale.getKeyNames(event.keyCode)[0])
          ) {
            this._targetKeyUpBinding(event);
          }
        },
      },
    ]);

    return Keyboard;
  })();

  function us(locale, platform, userAgent) {
    // general
    locale.bindKeyCode(3, ["cancel"]);
    locale.bindKeyCode(8, ["backspace"]);
    locale.bindKeyCode(9, ["tab"]);
    locale.bindKeyCode(12, ["clear"]);
    locale.bindKeyCode(13, ["enter"]);
    locale.bindKeyCode(16, ["shift"]);
    locale.bindKeyCode(17, ["ctrl"]);
    locale.bindKeyCode(18, ["alt", "menu"]);
    locale.bindKeyCode(19, ["pause", "break"]);
    locale.bindKeyCode(20, ["capslock"]);
    locale.bindKeyCode(27, ["escape", "esc"]);
    locale.bindKeyCode(32, ["space", "spacebar"]);
    locale.bindKeyCode(33, ["pageup"]);
    locale.bindKeyCode(34, ["pagedown"]);
    locale.bindKeyCode(35, ["end"]);
    locale.bindKeyCode(36, ["home"]);
    locale.bindKeyCode(37, ["left"]);
    locale.bindKeyCode(38, ["up"]);
    locale.bindKeyCode(39, ["right"]);
    locale.bindKeyCode(40, ["down"]);
    locale.bindKeyCode(41, ["select"]);
    locale.bindKeyCode(42, ["printscreen"]);
    locale.bindKeyCode(43, ["execute"]);
    locale.bindKeyCode(44, ["snapshot"]);
    locale.bindKeyCode(45, ["insert", "ins"]);
    locale.bindKeyCode(46, ["delete", "del"]);
    locale.bindKeyCode(47, ["help"]);
    locale.bindKeyCode(145, ["scrolllock", "scroll"]);
    locale.bindKeyCode(188, ["comma", ","]);
    locale.bindKeyCode(190, ["period", "."]);
    locale.bindKeyCode(191, ["slash", "forwardslash", "/"]);
    locale.bindKeyCode(192, ["graveaccent", "`"]);
    locale.bindKeyCode(219, ["openbracket", "["]);
    locale.bindKeyCode(220, ["backslash", "\\"]);
    locale.bindKeyCode(221, ["closebracket", "]"]);
    locale.bindKeyCode(222, ["apostrophe", "'"]); // 0-9

    locale.bindKeyCode(48, ["zero", "0"]);
    locale.bindKeyCode(49, ["one", "1"]);
    locale.bindKeyCode(50, ["two", "2"]);
    locale.bindKeyCode(51, ["three", "3"]);
    locale.bindKeyCode(52, ["four", "4"]);
    locale.bindKeyCode(53, ["five", "5"]);
    locale.bindKeyCode(54, ["six", "6"]);
    locale.bindKeyCode(55, ["seven", "7"]);
    locale.bindKeyCode(56, ["eight", "8"]);
    locale.bindKeyCode(57, ["nine", "9"]); // numpad

    locale.bindKeyCode(96, ["numzero", "num0"]);
    locale.bindKeyCode(97, ["numone", "num1"]);
    locale.bindKeyCode(98, ["numtwo", "num2"]);
    locale.bindKeyCode(99, ["numthree", "num3"]);
    locale.bindKeyCode(100, ["numfour", "num4"]);
    locale.bindKeyCode(101, ["numfive", "num5"]);
    locale.bindKeyCode(102, ["numsix", "num6"]);
    locale.bindKeyCode(103, ["numseven", "num7"]);
    locale.bindKeyCode(104, ["numeight", "num8"]);
    locale.bindKeyCode(105, ["numnine", "num9"]);
    locale.bindKeyCode(106, ["nummultiply", "num*"]);
    locale.bindKeyCode(107, ["numadd", "num+"]);
    locale.bindKeyCode(108, ["numenter"]);
    locale.bindKeyCode(109, ["numsubtract", "num-"]);
    locale.bindKeyCode(110, ["numdecimal", "num."]);
    locale.bindKeyCode(111, ["numdivide", "num/"]);
    locale.bindKeyCode(144, ["numlock", "num"]); // function keys

    locale.bindKeyCode(112, ["f1"]);
    locale.bindKeyCode(113, ["f2"]);
    locale.bindKeyCode(114, ["f3"]);
    locale.bindKeyCode(115, ["f4"]);
    locale.bindKeyCode(116, ["f5"]);
    locale.bindKeyCode(117, ["f6"]);
    locale.bindKeyCode(118, ["f7"]);
    locale.bindKeyCode(119, ["f8"]);
    locale.bindKeyCode(120, ["f9"]);
    locale.bindKeyCode(121, ["f10"]);
    locale.bindKeyCode(122, ["f11"]);
    locale.bindKeyCode(123, ["f12"]);
    locale.bindKeyCode(124, ["f13"]);
    locale.bindKeyCode(125, ["f14"]);
    locale.bindKeyCode(126, ["f15"]);
    locale.bindKeyCode(127, ["f16"]);
    locale.bindKeyCode(128, ["f17"]);
    locale.bindKeyCode(129, ["f18"]);
    locale.bindKeyCode(130, ["f19"]);
    locale.bindKeyCode(131, ["f20"]);
    locale.bindKeyCode(132, ["f21"]);
    locale.bindKeyCode(133, ["f22"]);
    locale.bindKeyCode(134, ["f23"]);
    locale.bindKeyCode(135, ["f24"]); // secondary key symbols

    locale.bindMacro("shift + `", ["tilde", "~"]);
    locale.bindMacro("shift + 1", ["exclamation", "exclamationpoint", "!"]);
    locale.bindMacro("shift + 2", ["at", "@"]);
    locale.bindMacro("shift + 3", ["number", "#"]);
    locale.bindMacro("shift + 4", ["dollar", "dollars", "dollarsign", "$"]);
    locale.bindMacro("shift + 5", ["percent", "%"]);
    locale.bindMacro("shift + 6", ["caret", "^"]);
    locale.bindMacro("shift + 7", ["ampersand", "and", "&"]);
    locale.bindMacro("shift + 8", ["asterisk", "*"]);
    locale.bindMacro("shift + 9", ["openparen", "("]);
    locale.bindMacro("shift + 0", ["closeparen", ")"]);
    locale.bindMacro("shift + -", ["underscore", "_"]);
    locale.bindMacro("shift + =", ["plus", "+"]);
    locale.bindMacro("shift + [", ["opencurlybrace", "opencurlybracket", "{"]);
    locale.bindMacro("shift + ]", ["closecurlybrace", "closecurlybracket", "}"]);
    locale.bindMacro("shift + \\", ["verticalbar", "|"]);
    locale.bindMacro("shift + ;", ["colon", ":"]);
    locale.bindMacro("shift + '", ["quotationmark", "'"]);
    locale.bindMacro("shift + !,", ["openanglebracket", "<"]);
    locale.bindMacro("shift + .", ["closeanglebracket", ">"]);
    locale.bindMacro("shift + /", ["questionmark", "?"]);

    if (platform.match("Mac")) {
      locale.bindMacro("command", ["mod", "modifier"]);
    } else {
      locale.bindMacro("ctrl", ["mod", "modifier"]);
    } //a-z and A-Z

    for (var keyCode = 65; keyCode <= 90; keyCode += 1) {
      var keyName = String.fromCharCode(keyCode + 32);
      var capitalKeyName = String.fromCharCode(keyCode);
      locale.bindKeyCode(keyCode, keyName);
      locale.bindMacro("shift + " + keyName, capitalKeyName);
      locale.bindMacro("capslock + " + keyName, capitalKeyName);
    } // browser caveats

    var semicolonKeyCode = userAgent.match("Firefox") ? 59 : 186;
    var dashKeyCode = userAgent.match("Firefox") ? 173 : 189;
    var equalKeyCode = userAgent.match("Firefox") ? 61 : 187;
    var leftCommandKeyCode;
    var rightCommandKeyCode;

    if (platform.match("Mac") && (userAgent.match("Safari") || userAgent.match("Chrome"))) {
      leftCommandKeyCode = 91;
      rightCommandKeyCode = 93;
    } else if (platform.match("Mac") && userAgent.match("Opera")) {
      leftCommandKeyCode = 17;
      rightCommandKeyCode = 17;
    } else if (platform.match("Mac") && userAgent.match("Firefox")) {
      leftCommandKeyCode = 224;
      rightCommandKeyCode = 224;
    }

    locale.bindKeyCode(semicolonKeyCode, ["semicolon", ";"]);
    locale.bindKeyCode(dashKeyCode, ["dash", "-"]);
    locale.bindKeyCode(equalKeyCode, ["equal", "equalsign", "="]);
    locale.bindKeyCode(leftCommandKeyCode, [
      "command",
      "windows",
      "win",
      "super",
      "leftcommand",
      "leftwindows",
      "leftwin",
      "leftsuper",
    ]);
    locale.bindKeyCode(rightCommandKeyCode, [
      "command",
      "windows",
      "win",
      "super",
      "rightcommand",
      "rightwindows",
      "rightwin",
      "rightsuper",
    ]); // kill keys

    locale.setKillKey("command");
  }

  function de(locale, platform, userAgent) {
    // general
    locale.bindKeyCode(3, ["cancel"]);
    locale.bindKeyCode(8, ["backspace"]);
    locale.bindKeyCode(9, ["tab"]);
    locale.bindKeyCode(12, ["clear"]);
    locale.bindKeyCode(13, ["enter"]);
    locale.bindKeyCode(16, ["shift"]);
    locale.bindKeyCode(17, ["ctrl"]);
    locale.bindKeyCode(18, ["alt", "menu"]);
    locale.bindKeyCode(19, ["pause", "break"]);
    locale.bindKeyCode(20, ["capslock"]);
    locale.bindKeyCode(27, ["escape", "esc"]);
    locale.bindKeyCode(32, ["space", "spacebar"]);
    locale.bindKeyCode(33, ["pageup"]);
    locale.bindKeyCode(34, ["pagedown"]);
    locale.bindKeyCode(35, ["end"]);
    locale.bindKeyCode(36, ["home"]);
    locale.bindKeyCode(37, ["left"]);
    locale.bindKeyCode(38, ["up"]);
    locale.bindKeyCode(39, ["right"]);
    locale.bindKeyCode(40, ["down"]);
    locale.bindKeyCode(41, ["select"]);
    locale.bindKeyCode(42, ["printscreen"]);
    locale.bindKeyCode(43, ["execute"]);
    locale.bindKeyCode(44, ["snapshot"]);
    locale.bindKeyCode(45, ["insert", "ins"]);
    locale.bindKeyCode(46, ["delete", "del"]);
    locale.bindKeyCode(47, ["help"]);
    locale.bindKeyCode(145, ["scrolllock", "scroll"]);
    locale.bindKeyCode(188, ["comma", ","]);
    locale.bindKeyCode(190, ["period", "."]);
    locale.bindKeyCode(191, ["slash", "forwardslash", "/"]);
    locale.bindKeyCode(192, ["graveaccent", "`"]);
    locale.bindKeyCode(219, ["ß"]);
    locale.bindKeyCode(220, ["backslash", "\\"]);
    locale.bindKeyCode(221, ["closebracket", "]"]);
    locale.bindKeyCode(222, ["apostrophe", "'"]); // 0-9

    locale.bindKeyCode(48, ["zero", "0"]);
    locale.bindKeyCode(49, ["one", "1"]);
    locale.bindKeyCode(50, ["two", "2"]);
    locale.bindKeyCode(51, ["three", "3"]);
    locale.bindKeyCode(52, ["four", "4"]);
    locale.bindKeyCode(53, ["five", "5"]);
    locale.bindKeyCode(54, ["six", "6"]);
    locale.bindKeyCode(55, ["seven", "7"]);
    locale.bindKeyCode(56, ["eight", "8"]);
    locale.bindKeyCode(57, ["nine", "9"]); // numpad

    locale.bindKeyCode(96, ["numzero", "num0"]);
    locale.bindKeyCode(97, ["numone", "num1"]);
    locale.bindKeyCode(98, ["numtwo", "num2"]);
    locale.bindKeyCode(99, ["numthree", "num3"]);
    locale.bindKeyCode(100, ["numfour", "num4"]);
    locale.bindKeyCode(101, ["numfive", "num5"]);
    locale.bindKeyCode(102, ["numsix", "num6"]);
    locale.bindKeyCode(103, ["numseven", "num7"]);
    locale.bindKeyCode(104, ["numeight", "num8"]);
    locale.bindKeyCode(105, ["numnine", "num9"]);
    locale.bindKeyCode(106, ["nummultiply", "num*"]);
    locale.bindKeyCode(107, ["numadd", "num+"]);
    locale.bindKeyCode(108, ["numenter"]);
    locale.bindKeyCode(109, ["numsubtract", "num-"]);
    locale.bindKeyCode(110, ["numdecimal", "num."]);
    locale.bindKeyCode(111, ["numdivide", "num/"]);
    locale.bindKeyCode(144, ["numlock", "num"]); // function keys

    locale.bindKeyCode(112, ["f1"]);
    locale.bindKeyCode(113, ["f2"]);
    locale.bindKeyCode(114, ["f3"]);
    locale.bindKeyCode(115, ["f4"]);
    locale.bindKeyCode(116, ["f5"]);
    locale.bindKeyCode(117, ["f6"]);
    locale.bindKeyCode(118, ["f7"]);
    locale.bindKeyCode(119, ["f8"]);
    locale.bindKeyCode(120, ["f9"]);
    locale.bindKeyCode(121, ["f10"]);
    locale.bindKeyCode(122, ["f11"]);
    locale.bindKeyCode(123, ["f12"]);
    locale.bindKeyCode(124, ["f13"]);
    locale.bindKeyCode(125, ["f14"]);
    locale.bindKeyCode(126, ["f15"]);
    locale.bindKeyCode(127, ["f16"]);
    locale.bindKeyCode(128, ["f17"]);
    locale.bindKeyCode(129, ["f18"]);
    locale.bindKeyCode(130, ["f19"]);
    locale.bindKeyCode(131, ["f20"]);
    locale.bindKeyCode(132, ["f21"]);
    locale.bindKeyCode(133, ["f22"]);
    locale.bindKeyCode(134, ["f23"]);
    locale.bindKeyCode(135, ["f24"]); // secondary key symbols

    locale.bindMacro("shift + `", ["tilde", "~"]);
    locale.bindMacro("shift + 1", ["exclamation", "exclamationpoint", "!"]);
    locale.bindMacro("shift + 2", ["at", "@"]);
    locale.bindMacro("shift + 3", ["number", "#"]);
    locale.bindMacro("shift + 4", ["dollar", "dollars", "dollarsign", "$"]);
    locale.bindMacro("shift + 5", ["percent", "%"]);
    locale.bindMacro("shift + 6", ["caret", "^"]);
    locale.bindMacro("shift + 7", ["ampersand", "and", "&"]);
    locale.bindMacro("shift + 8", ["asterisk", "*"]);
    locale.bindMacro("shift + 9", ["openparen", "("]);
    locale.bindMacro("shift + 0", ["closeparen", ")"]);
    locale.bindMacro("shift + -", ["underscore", "_"]);
    locale.bindMacro("shift + =", ["plus", "+"]);
    locale.bindMacro("shift + [", ["opencurlybrace", "opencurlybracket", "{"]);
    locale.bindMacro("shift + ]", ["closecurlybrace", "closecurlybracket", "}"]);
    locale.bindMacro("shift + \\", ["verticalbar", "|"]);
    locale.bindMacro("shift + ;", ["colon", ":"]);
    locale.bindMacro("shift + '", ["quotationmark", "'"]);
    locale.bindMacro("shift + !,", ["openanglebracket", "<"]);
    locale.bindMacro("shift + .", ["closeanglebracket", ">"]);
    locale.bindMacro("shift + ß", ["questionmark", "?"]);

    if (platform.match("Mac")) {
      locale.bindMacro("command", ["mod", "modifier"]);
    } else {
      locale.bindMacro("ctrl", ["mod", "modifier"]);
    } //a-z and A-Z

    for (var keyCode = 65; keyCode <= 90; keyCode += 1) {
      var keyName = String.fromCharCode(keyCode + 32);
      var capitalKeyName = String.fromCharCode(keyCode);
      locale.bindKeyCode(keyCode, keyName);
      locale.bindMacro("shift + " + keyName, capitalKeyName);
      locale.bindMacro("capslock + " + keyName, capitalKeyName);
    } // browser caveats

    var semicolonKeyCode = userAgent.match("Firefox") ? 59 : 186;
    var dashKeyCode = userAgent.match("Firefox") ? 173 : 189;
    var equalKeyCode = userAgent.match("Firefox") ? 61 : 187;
    var leftCommandKeyCode;
    var rightCommandKeyCode;

    if (platform.match("Mac") && (userAgent.match("Safari") || userAgent.match("Chrome"))) {
      leftCommandKeyCode = 91;
      rightCommandKeyCode = 93;
    } else if (platform.match("Mac") && userAgent.match("Opera")) {
      leftCommandKeyCode = 17;
      rightCommandKeyCode = 17;
    } else if (platform.match("Mac") && userAgent.match("Firefox")) {
      leftCommandKeyCode = 224;
      rightCommandKeyCode = 224;
    }

    locale.bindKeyCode(semicolonKeyCode, ["semicolon", ";"]);
    locale.bindKeyCode(dashKeyCode, ["dash", "-"]);
    locale.bindKeyCode(equalKeyCode, ["equal", "equalsign", "="]);
    locale.bindKeyCode(leftCommandKeyCode, [
      "command",
      "windows",
      "win",
      "super",
      "leftcommand",
      "leftwindows",
      "leftwin",
      "leftsuper",
    ]);
    locale.bindKeyCode(rightCommandKeyCode, [
      "command",
      "windows",
      "win",
      "super",
      "rightcommand",
      "rightwindows",
      "rightwin",
      "rightsuper",
    ]); // kill keys

    locale.setKillKey("command");
  }

  var keyboard = new Keyboard();
  keyboard.setLocale("de", de);
  keyboard.Keyboard = Keyboard;
  keyboard.Locale = Locale;
  keyboard.KeyCombo = KeyCombo;

  return keyboard;
});
