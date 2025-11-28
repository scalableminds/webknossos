// @ts-nocheck

// Based on KeyboardJS v2.6.2
// https://github.com/RobertWHurst/KeyboardJS/releases/tag/v2.6.2
export class KeyCombo {
  constructor(keyComboStr) {
    this.sourceStr = keyComboStr;
    this.subCombos = KeyCombo.parseComboStr(keyComboStr);
    this.keyNames  = this.subCombos.reduce((memo, nextSubCombo) =>
      memo.concat(nextSubCombo), []);
  }

  check(pressedKeyNames) {
    let startingKeyNameIndex = 0;
    for (let i = 0; i < this.subCombos.length; i += 1) {
      startingKeyNameIndex = this._checkSubCombo(
        this.subCombos[i],
        startingKeyNameIndex,
        pressedKeyNames
      );
      if (startingKeyNameIndex === -1) { return false; }
    }
    return true;
  };

  isEqual(otherKeyCombo) {
    if (
      !otherKeyCombo ||
      typeof otherKeyCombo !== 'string' &&
      typeof otherKeyCombo !== 'object'
    ) { return false; }

    if (typeof otherKeyCombo === 'string') {
      otherKeyCombo = new KeyCombo(otherKeyCombo);
    }

    if (this.subCombos.length !== otherKeyCombo.subCombos.length) {
      return false;
    }
    for (let i = 0; i < this.subCombos.length; i += 1) {
      if (this.subCombos[i].length !== otherKeyCombo.subCombos[i].length) {
        return false;
      }
    }

    for (let i = 0; i < this.subCombos.length; i += 1) {
      const subCombo      = this.subCombos[i];
      const otherSubCombo = otherKeyCombo.subCombos[i].slice(0);

      for (let j = 0; j < subCombo.length; j += 1) {
        const keyName = subCombo[j];
        const index   = otherSubCombo.indexOf(keyName);

        if (index > -1) {
          otherSubCombo.splice(index, 1);
        }
      }
      if (otherSubCombo.length !== 0) {
        return false;
      }
    }

    return true;
  };

  _checkSubCombo(subCombo, startingKeyNameIndex, pressedKeyNames) {
    subCombo = subCombo.slice(0);
    pressedKeyNames = pressedKeyNames.slice(startingKeyNameIndex);

    let endIndex = startingKeyNameIndex;
    for (let i = 0; i < subCombo.length; i += 1) {

      let keyName = subCombo[i];
      if (keyName[0] === '\\') {
        const escapedKeyName = keyName.slice(1);
        if (
          escapedKeyName === KeyCombo.comboDeliminator ||
          escapedKeyName === KeyCombo.keyDeliminator
        ) {
          keyName = escapedKeyName;
        }
      }

      const index = pressedKeyNames.indexOf(keyName);
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
  };
}

KeyCombo.comboDeliminator = '>';
KeyCombo.keyDeliminator   = '+';

KeyCombo.parseComboStr = function(keyComboStr) {
  const subComboStrs = KeyCombo._splitStr(keyComboStr, KeyCombo.comboDeliminator);
  const combo        = [];

  for (let i = 0 ; i < subComboStrs.length; i += 1) {
    combo.push(KeyCombo._splitStr(subComboStrs[i], KeyCombo.keyDeliminator));
  }
  return combo;
}

KeyCombo._splitStr = function(str, deliminator) {
  const s  = str;
  const d  = deliminator;
  let c  = '';
  const ca = [];

  for (let ci = 0; ci < s.length; ci += 1) {
    if (ci > 0 && s[ci] === d && s[ci - 1] !== '\\') {
      ca.push(c.trim());
      c = '';
      ci += 1;
    }
    c += s[ci];
  }
  if (c) { ca.push(c.trim()); }

  return ca;
};


export class Keyboard {
  constructor(targetWindow, targetElement, targetPlatform, targetUserAgent) {
    this._locale               = null;
    this._currentContext       = '';
    this._contexts             = {};
    this._listeners            = [];
    this._appliedListeners     = [];
    this._locales              = {};
    this._targetElement        = null;
    this._targetWindow         = null;
    this._targetPlatform       = '';
    this._targetUserAgent      = '';
    this._isModernBrowser      = false;
    this._targetKeyDownBinding = null;
    this._targetKeyUpBinding   = null;
    this._targetResetBinding   = null;
    this._paused               = false;

    this._contexts.global = {
      listeners: this._listeners,
      targetWindow,
      targetElement,
      targetPlatform,
      targetUserAgent
    };

    this.setContext('global');
  }

  setLocale(localeName, localeBuilder) {
    let locale = null;
    if (typeof localeName === 'string') {

      if (localeBuilder) {
        locale = new Locale(localeName);
        localeBuilder(locale, this._targetPlatform, this._targetUserAgent);
      } else {
        locale = this._locales[localeName] || null;
      }
    } else {
      locale     = localeName;
      localeName = locale._localeName;
    }

    this._locale              = locale;
    this._locales[localeName] = locale;
    if (locale) {
      this._locale.pressedKeys = locale.pressedKeys;
    }

    return this;
  }

  getLocale(localName) {
    localName || (localName = this._locale.localeName);
    return this._locales[localName] || null;
  }

  bind(keyComboStr, pressHandler, releaseHandler, preventRepeatByDefault) {
    if (keyComboStr === null || typeof keyComboStr === 'function') {
      preventRepeatByDefault = releaseHandler;
      releaseHandler         = pressHandler;
      pressHandler           = keyComboStr;
      keyComboStr            = null;
    }

    if (
      keyComboStr &&
      typeof keyComboStr === 'object' &&
      typeof keyComboStr.length === 'number'
    ) {
      for (let i = 0; i < keyComboStr.length; i += 1) {
        this.bind(keyComboStr[i], pressHandler, releaseHandler);
      }
      return this;
    }

    this._listeners.push({
      keyCombo              : keyComboStr ? new KeyCombo(keyComboStr) : null,
      pressHandler          : pressHandler           || null,
      releaseHandler        : releaseHandler         || null,
      preventRepeat         : false,
      preventRepeatByDefault: preventRepeatByDefault || false,
      executingHandler      : false
    });

    return this;
  }

  addListener(keyComboStr, pressHandler, releaseHandler, preventRepeatByDefault) {
    return this.bind(keyComboStr, pressHandler, releaseHandler, preventRepeatByDefault);
  }

  on(keyComboStr, pressHandler, releaseHandler, preventRepeatByDefault) {
    return this.bind(keyComboStr, pressHandler, releaseHandler, preventRepeatByDefault);
  }

  bindPress(keyComboStr, pressHandler, preventRepeatByDefault) {
    return this.bind(keyComboStr, pressHandler, null, preventRepeatByDefault);
  }

  bindRelease(keyComboStr, releaseHandler) {
    return this.bind(keyComboStr, null, releaseHandler, preventRepeatByDefault);
  }

  unbind(keyComboStr, pressHandler, releaseHandler) {
    if (keyComboStr === null || typeof keyComboStr === 'function') {
      releaseHandler = pressHandler;
      pressHandler   = keyComboStr;
      keyComboStr = null;
    }

    if (
      keyComboStr &&
      typeof keyComboStr === 'object' &&
      typeof keyComboStr.length === 'number'
    ) {
      for (let i = 0; i < keyComboStr.length; i += 1) {
        this.unbind(keyComboStr[i], pressHandler, releaseHandler);
      }
      return this;
    }

    for (let i = 0; i < this._listeners.length; i += 1) {
      const listener = this._listeners[i];

      const comboMatches          = !keyComboStr && !listener.keyCombo ||
                                  listener.keyCombo && listener.keyCombo.isEqual(keyComboStr);
      const pressHandlerMatches   = !pressHandler && !releaseHandler ||
                                  !pressHandler && !listener.pressHandler ||
                                  pressHandler === listener.pressHandler;
      const releaseHandlerMatches = !pressHandler && !releaseHandler ||
                                  !releaseHandler && !listener.releaseHandler ||
                                  releaseHandler === listener.releaseHandler;

      if (comboMatches && pressHandlerMatches && releaseHandlerMatches) {
        this._listeners.splice(i, 1);
        i -= 1;
      }
    }

    return this;
  }

  removeListener(keyComboStr, pressHandler, releaseHandler) {
    return this.unbind(keyComboStr, pressHandler, releaseHandler);
  }

  off(keyComboStr, pressHandler, releaseHandler) {
    return this.unbind(keyComboStr, pressHandler, releaseHandler);
  }

  setContext(contextName) {
    if(this._locale) { this.releaseAllKeys(); }

    if (!this._contexts[contextName]) {
      const globalContext = this._contexts.global;
      this._contexts[contextName] = {
        listeners      : [],
        targetWindow   : globalContext.targetWindow,
        targetElement  : globalContext.targetElement,
        targetPlatform : globalContext.targetPlatform,
        targetUserAgent: globalContext.targetUserAgent
      };
    }

    const context        = this._contexts[contextName];
    this._currentContext = contextName;
    this._listeners      = context.listeners;

    this.stop();
    this.watch(
      context.targetWindow,
      context.targetElement,
      context.targetPlatform,
      context.targetUserAgent
    );

    return this;
  }

  getContext() {
    return this._currentContext;
  }

  withContext(contextName, callback) {
    const previousContextName = this.getContext();
    this.setContext(contextName);

    callback();

    this.setContext(previousContextName);

    return this;
  }

  watch(targetWindow, targetElement, targetPlatform, targetUserAgent) {
    this.stop();

    const win = typeof globalThis !== 'undefined' ? globalThis :
                typeof global !== 'undefined' ? global :
                typeof window !== 'undefined' ? window :
                {};

    if (!targetWindow) {
      if (!win.addEventListener && !win.attachEvent) {
        // This was added so when using things like JSDOM watch can be used to configure watch
        // for the global namespace manually.
        if (this._currentContext === 'global') {
          return
        }
        throw new Error('Cannot find window functions addEventListener or attachEvent.');
      }
      targetWindow = win;
    }

    // Handle element bindings where a target window is not passed
    if (typeof targetWindow.nodeType === 'number') {
      targetUserAgent = targetPlatform;
      targetPlatform  = targetElement;
      targetElement   = targetWindow;
      targetWindow    = win;
    }

    if (!targetWindow.addEventListener && !targetWindow.attachEvent) {
      throw new Error('Cannot find addEventListener or attachEvent methods on targetWindow.');
    }

    this._isModernBrowser = !!targetWindow.addEventListener;

    const userAgent = targetWindow.navigator && targetWindow.navigator.userAgent || '';
    const platform  = targetWindow.navigator && targetWindow.navigator.platform  || '';

    targetElement   && targetElement   !== null || (targetElement   = targetWindow.document);
    targetPlatform  && targetPlatform  !== null || (targetPlatform  = platform);
    targetUserAgent && targetUserAgent !== null || (targetUserAgent = userAgent);

    this._targetKeyDownBinding = (event) => {
      this.pressKey(event.keyCode, event);
      this._handleCommandBug(event, platform);
    };
    this._targetKeyUpBinding = (event) => {
      this.releaseKey(event.keyCode, event);
    };
    this._targetResetBinding = (event) => {
      this.releaseAllKeys(event);
    };

    this._bindEvent(targetElement, 'keydown', this._targetKeyDownBinding);
    this._bindEvent(targetElement, 'keyup',   this._targetKeyUpBinding);
    this._bindEvent(targetWindow,  'focus',   this._targetResetBinding);
    this._bindEvent(targetWindow,  'blur',    this._targetResetBinding);

    this._targetElement   = targetElement;
    this._targetWindow    = targetWindow;
    this._targetPlatform  = targetPlatform;
    this._targetUserAgent = targetUserAgent;

    const currentContext           = this._contexts[this._currentContext];
    currentContext.targetWindow    = this._targetWindow;
    currentContext.targetElement   = this._targetElement;
    currentContext.targetPlatform  = this._targetPlatform;
    currentContext.targetUserAgent = this._targetUserAgent;

    return this;
  }

  stop() {
    if (!this._targetElement || !this._targetWindow) { return; }

    this._unbindEvent(this._targetElement, 'keydown', this._targetKeyDownBinding);
    this._unbindEvent(this._targetElement, 'keyup',   this._targetKeyUpBinding);
    this._unbindEvent(this._targetWindow,  'focus',   this._targetResetBinding);
    this._unbindEvent(this._targetWindow,  'blur',    this._targetResetBinding);

    this._targetWindow  = null;
    this._targetElement = null;

    return this;
  }

  pressKey(keyCode, event) {
    if (this._paused) { return this; }
    if (!this._locale) { throw new Error('Locale not set'); }

    this._locale.pressKey(keyCode);
    this._applyBindings(event);

    return this;
  }

  releaseKey(keyCode, event) {
    if (this._paused) { return this; }
    if (!this._locale) { throw new Error('Locale not set'); }

    this._locale.releaseKey(keyCode);
    this._clearBindings(event);

    return this;
  }

  releaseAllKeys(event) {
    if (this._paused) { return this; }
    if (!this._locale) { throw new Error('Locale not set'); }

    this._locale.pressedKeys.length = 0;
    this._clearBindings(event);

    return this;
  }

  pause() {
    if (this._paused) { return this; }
    if (this._locale) { this.releaseAllKeys(); }
    this._paused = true;

    return this;
  }

  resume() {
    this._paused = false;

    return this;
  }

  reset() {
    this.releaseAllKeys();
    this._listeners.length = 0;

    return this;
  }

  _bindEvent(targetElement, eventName, handler) {
    return this._isModernBrowser ?
      targetElement.addEventListener(eventName, handler, false) :
      targetElement.attachEvent('on' + eventName, handler);
  }

  _unbindEvent(targetElement, eventName, handler) {
    return this._isModernBrowser ?
      targetElement.removeEventListener(eventName, handler, false) :
      targetElement.detachEvent('on' + eventName, handler);
  }

  _getGroupedListeners() {
    const listenerGroups   = [];
    const listenerGroupMap = [];

    let listeners = this._listeners;
    if (this._currentContext !== 'global') {
      listeners = [...listeners, ...this._contexts.global.listeners];
    }

    listeners.sort(
      (a, b) =>
        (b.keyCombo ? b.keyCombo.keyNames.length : 0) -
        (a.keyCombo ? a.keyCombo.keyNames.length : 0)
    ).forEach((l) => {
      let mapIndex = -1;
      for (let i = 0; i < listenerGroupMap.length; i += 1) {
        if (listenerGroupMap[i] === null && l.keyCombo === null ||
            listenerGroupMap[i] !== null && listenerGroupMap[i].isEqual(l.keyCombo)) {
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
  }

  _applyBindings(event) {
    let preventRepeat = false;

    event || (event = {});
    event.preventRepeat = () => { preventRepeat = true; };
    event.pressedKeys   = this._locale.pressedKeys.slice(0);

    const activeTargetKeys = this._locale.activeTargetKeys;
    const pressedKeys      = this._locale.pressedKeys.slice(0);
    const listenerGroups   = this._getGroupedListeners();

    for (let i = 0; i < listenerGroups.length; i += 1) {
      const listeners = listenerGroups[i];
      const keyCombo  = listeners[0].keyCombo;

      if (
        keyCombo === null ||
        keyCombo.check(pressedKeys) &&
        activeTargetKeys.some(k => keyCombo.keyNames.includes(k))
      ) {
        for (let j = 0; j < listeners.length; j += 1) {
          let listener = listeners[j];

          if (!listener.executingHandler && listener.pressHandler && !listener.preventRepeat) {
            listener.executingHandler = true;
            listener.pressHandler.call(this, event);
            listener.executingHandler = false;

            if (preventRepeat || listener.preventRepeatByDefault) {
              listener.preventRepeat = true;
              preventRepeat          = false;
            }
          }

          if (this._appliedListeners.indexOf(listener) === -1) {
            this._appliedListeners.push(listener);
          }
        }

        if (keyCombo) {
          for (let j = 0; j < keyCombo.keyNames.length; j += 1) {
            const index = pressedKeys.indexOf(keyCombo.keyNames[j]);
            if (index !== -1) {
              pressedKeys.splice(index, 1);
              j -= 1;
            }
          }
        }
      }
    }
  }

  _clearBindings(event) {
    event || (event = {});
    event.pressedKeys = this._locale.pressedKeys.slice(0);

    for (let i = 0; i < this._appliedListeners.length; i += 1) {
      const listener = this._appliedListeners[i];
      const keyCombo = listener.keyCombo;
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
  }

  _handleCommandBug(event, platform) {
    // On Mac when the command key is kept pressed, keyup is not triggered for any other key.
    // In this case force a keyup for non-modifier keys directly after the keypress.
    const modifierKeys = ["shift", "ctrl", "alt", "capslock", "tab", "command"];
    if (platform.match("Mac") && this._locale.pressedKeys.includes("command") &&
        !modifierKeys.includes(this._locale.getKeyNames(event.keyCode)[0])) {
      this._targetKeyUpBinding(event);
    }
  }
}

export class Locale {
  constructor(name) {
    this.localeName          = name;
    this.activeTargetKeys = [];
    this.pressedKeys         = [];
    this._appliedMacros      = [];
    this._keyMap             = {};
    this._killKeyCodes       = [];
    this._macros             = [];
  }

  bindKeyCode(keyCode, keyNames) {
    if (typeof keyNames === 'string') {
      keyNames = [keyNames];
    }

    this._keyMap[keyCode] = keyNames;
  };

  bindMacro(keyComboStr, keyNames) {
    if (typeof keyNames === 'string') {
      keyNames = [ keyNames ];
    }

    let handler = null;
    if (typeof keyNames === 'function') {
      handler = keyNames;
      keyNames = null;
    }

    const macro = {
      keyCombo : new KeyCombo(keyComboStr),
      keyNames : keyNames,
      handler  : handler
    };

    this._macros.push(macro);
  };

  getKeyCodes(keyName) {
    const keyCodes = [];
    for (const keyCode in this._keyMap) {
      const index = this._keyMap[keyCode].indexOf(keyName);
      if (index > -1) { keyCodes.push(keyCode|0); }
    }
    return keyCodes;
  };

  getKeyNames(keyCode) {
    return this._keyMap[keyCode] || [];
  };

  setKillKey(keyCode) {
    if (typeof keyCode === 'string') {
      const keyCodes = this.getKeyCodes(keyCode);
      for (let i = 0; i < keyCodes.length; i += 1) {
        this.setKillKey(keyCodes[i]);
      }
      return;
    }

    this._killKeyCodes.push(keyCode);
  };

  pressKey(keyCode) {
    if (typeof keyCode === 'string') {
      const keyCodes = this.getKeyCodes(keyCode);
      for (let i = 0; i < keyCodes.length; i += 1) {
        this.pressKey(keyCodes[i]);
      }
      return;
    }

    this.activeTargetKeys.length = 0;
    const keyNames = this.getKeyNames(keyCode);
    for (let i = 0; i < keyNames.length; i += 1) {
      this.activeTargetKeys.push(keyNames[i]);
      if (this.pressedKeys.indexOf(keyNames[i]) === -1) {
        this.pressedKeys.push(keyNames[i]);
      }
    }

    this._applyMacros();
  };

  releaseKey(keyCode) {
    if (typeof keyCode === 'string') {
      const keyCodes = this.getKeyCodes(keyCode);
      for (let i = 0; i < keyCodes.length; i += 1) {
        this.releaseKey(keyCodes[i]);
      }

    } else {
      const keyNames         = this.getKeyNames(keyCode);
      const killKeyCodeIndex = this._killKeyCodes.indexOf(keyCode);

      if (killKeyCodeIndex !== -1) {
        this.pressedKeys.length = 0;
      } else {
        for (let i = 0; i < keyNames.length; i += 1) {
          const index = this.pressedKeys.indexOf(keyNames[i]);
          if (index > -1) {
            this.pressedKeys.splice(index, 1);
          }
        }
      }

      this.activeTargetKeys.length = 0;
      this._clearMacros();
    }
  };

  _applyMacros() {
    const macros = this._macros.slice(0);
    for (let i = 0; i < macros.length; i += 1) {
      const macro = macros[i];
      if (macro.keyCombo.check(this.pressedKeys)) {
        if (macro.handler) {
          macro.keyNames = macro.handler(this.pressedKeys);
        }
        for (let j = 0; j < macro.keyNames.length; j += 1) {
          if (this.pressedKeys.indexOf(macro.keyNames[j]) === -1) {
            this.pressedKeys.push(macro.keyNames[j]);
          }
        }
        this._appliedMacros.push(macro);
      }
    }
  };

  _clearMacros() {
    for (let i = 0; i < this._appliedMacros.length; i += 1) {
      const macro = this._appliedMacros[i];
      if (!macro.keyCombo.check(this.pressedKeys)) {
        for (let j = 0; j < macro.keyNames.length; j += 1) {
          const index = this.pressedKeys.indexOf(macro.keyNames[j]);
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
  }
}


export function us(locale, platform, userAgent) {

  // general
  locale.bindKeyCode(3,   ['cancel']);
  locale.bindKeyCode(8,   ['backspace']);
  locale.bindKeyCode(9,   ['tab']);
  locale.bindKeyCode(12,  ['clear']);
  locale.bindKeyCode(13,  ['enter']);
  locale.bindKeyCode(16,  ['shift']);
  locale.bindKeyCode(17,  ['ctrl']);
  locale.bindKeyCode(18,  ['alt', 'menu']);
  locale.bindKeyCode(19,  ['pause', 'break']);
  locale.bindKeyCode(20,  ['capslock']);
  locale.bindKeyCode(27,  ['escape', 'esc']);
  locale.bindKeyCode(32,  ['space', 'spacebar']);
  locale.bindKeyCode(33,  ['pageup']);
  locale.bindKeyCode(34,  ['pagedown']);
  locale.bindKeyCode(35,  ['end']);
  locale.bindKeyCode(36,  ['home']);
  locale.bindKeyCode(37,  ['left']);
  locale.bindKeyCode(38,  ['up']);
  locale.bindKeyCode(39,  ['right']);
  locale.bindKeyCode(40,  ['down']);
  locale.bindKeyCode(41,  ['select']);
  locale.bindKeyCode(42,  ['printscreen']);
  locale.bindKeyCode(43,  ['execute']);
  locale.bindKeyCode(44,  ['snapshot']);
  locale.bindKeyCode(45,  ['insert', 'ins']);
  locale.bindKeyCode(46,  ['delete', 'del']);
  locale.bindKeyCode(47,  ['help']);
  locale.bindKeyCode(145, ['scrolllock', 'scroll']);
  locale.bindKeyCode(188, ['comma', ',']);
  locale.bindKeyCode(190, ['period', '.']);
  locale.bindKeyCode(191, ['slash', 'forwardslash', '/']);
  locale.bindKeyCode(192, ['graveaccent', '`']);
  locale.bindKeyCode(219, ['openbracket', '[']);
  locale.bindKeyCode(220, ['backslash', '\\']);
  locale.bindKeyCode(221, ['closebracket', ']']);
  locale.bindKeyCode(222, ['apostrophe', '\'']);

  // 0-9
  locale.bindKeyCode(48, ['zero', '0']);
  locale.bindKeyCode(49, ['one', '1']);
  locale.bindKeyCode(50, ['two', '2']);
  locale.bindKeyCode(51, ['three', '3']);
  locale.bindKeyCode(52, ['four', '4']);
  locale.bindKeyCode(53, ['five', '5']);
  locale.bindKeyCode(54, ['six', '6']);
  locale.bindKeyCode(55, ['seven', '7']);
  locale.bindKeyCode(56, ['eight', '8']);
  locale.bindKeyCode(57, ['nine', '9']);

  // numpad
  locale.bindKeyCode(96, ['numzero', 'num0']);
  locale.bindKeyCode(97, ['numone', 'num1']);
  locale.bindKeyCode(98, ['numtwo', 'num2']);
  locale.bindKeyCode(99, ['numthree', 'num3']);
  locale.bindKeyCode(100, ['numfour', 'num4']);
  locale.bindKeyCode(101, ['numfive', 'num5']);
  locale.bindKeyCode(102, ['numsix', 'num6']);
  locale.bindKeyCode(103, ['numseven', 'num7']);
  locale.bindKeyCode(104, ['numeight', 'num8']);
  locale.bindKeyCode(105, ['numnine', 'num9']);
  locale.bindKeyCode(106, ['nummultiply', 'num*']);
  locale.bindKeyCode(107, ['numadd', 'num+']);
  locale.bindKeyCode(108, ['numenter']);
  locale.bindKeyCode(109, ['numsubtract', 'num-']);
  locale.bindKeyCode(110, ['numdecimal', 'num.']);
  locale.bindKeyCode(111, ['numdivide', 'num/']);
  locale.bindKeyCode(144, ['numlock', 'num']);

  // function keys
  locale.bindKeyCode(112, ['f1']);
  locale.bindKeyCode(113, ['f2']);
  locale.bindKeyCode(114, ['f3']);
  locale.bindKeyCode(115, ['f4']);
  locale.bindKeyCode(116, ['f5']);
  locale.bindKeyCode(117, ['f6']);
  locale.bindKeyCode(118, ['f7']);
  locale.bindKeyCode(119, ['f8']);
  locale.bindKeyCode(120, ['f9']);
  locale.bindKeyCode(121, ['f10']);
  locale.bindKeyCode(122, ['f11']);
  locale.bindKeyCode(123, ['f12']);
  locale.bindKeyCode(124, ['f13']);
  locale.bindKeyCode(125, ['f14']);
  locale.bindKeyCode(126, ['f15']);
  locale.bindKeyCode(127, ['f16']);
  locale.bindKeyCode(128, ['f17']);
  locale.bindKeyCode(129, ['f18']);
  locale.bindKeyCode(130, ['f19']);
  locale.bindKeyCode(131, ['f20']);
  locale.bindKeyCode(132, ['f21']);
  locale.bindKeyCode(133, ['f22']);
  locale.bindKeyCode(134, ['f23']);
  locale.bindKeyCode(135, ['f24']);

  // secondary key symbols
  locale.bindMacro('shift + `', ['tilde', '~']);
  locale.bindMacro('shift + 1', ['exclamation', 'exclamationpoint', '!']);
  locale.bindMacro('shift + 2', ['at', '@']);
  locale.bindMacro('shift + 3', ['number', '#']);
  locale.bindMacro('shift + 4', ['dollar', 'dollars', 'dollarsign', '$']);
  locale.bindMacro('shift + 5', ['percent', '%']);
  locale.bindMacro('shift + 6', ['caret', '^']);
  locale.bindMacro('shift + 7', ['ampersand', 'and', '&']);
  locale.bindMacro('shift + 8', ['asterisk', '*']);
  locale.bindMacro('shift + 9', ['openparen', '(']);
  locale.bindMacro('shift + 0', ['closeparen', ')']);
  locale.bindMacro('shift + -', ['underscore', '_']);
  locale.bindMacro('shift + =', ['plus', '+']);
  locale.bindMacro('shift + [', ['opencurlybrace', 'opencurlybracket', '{']);
  locale.bindMacro('shift + ]', ['closecurlybrace', 'closecurlybracket', '}']);
  locale.bindMacro('shift + \\', ['verticalbar', '|']);
  locale.bindMacro('shift + ;', ['colon', ':']);
  locale.bindMacro('shift + \'', ['quotationmark', '\'']);
  locale.bindMacro('shift + !,', ['openanglebracket', '<']);
  locale.bindMacro('shift + .', ['closeanglebracket', '>']);
  locale.bindMacro('shift + /', ['questionmark', '?']);

  if (platform.match('Mac')) {
    locale.bindMacro('command', ['mod', 'modifier']);
  } else {
    locale.bindMacro('ctrl', ['mod', 'modifier']);
  }

  //a-z and A-Z
  for (let keyCode = 65; keyCode <= 90; keyCode += 1) {
    var keyName = String.fromCharCode(keyCode + 32);
    var capitalKeyName = String.fromCharCode(keyCode);
    locale.bindKeyCode(keyCode, keyName);
    locale.bindMacro('shift + ' + keyName, capitalKeyName);
    locale.bindMacro('capslock + ' + keyName, capitalKeyName);
  }

  // browser caveats
  const semicolonKeyCode = userAgent.match('Firefox') ? 59  : 186;
  const dashKeyCode      = userAgent.match('Firefox') ? 173 : 189;
  const equalKeyCode     = userAgent.match('Firefox') ? 61  : 187;
  let leftCommandKeyCode;
  let rightCommandKeyCode;
  if (platform.match('Mac') && (userAgent.match('Safari') || userAgent.match('Chrome'))) {
    leftCommandKeyCode  = 91;
    rightCommandKeyCode = 93;
  } else if(platform.match('Mac') && userAgent.match('Opera')) {
    leftCommandKeyCode  = 17;
    rightCommandKeyCode = 17;
  } else if(platform.match('Mac') && userAgent.match('Firefox')) {
    leftCommandKeyCode  = 224;
    rightCommandKeyCode = 224;
  }
  locale.bindKeyCode(semicolonKeyCode,    ['semicolon', ';']);
  locale.bindKeyCode(dashKeyCode,         ['dash', '-']);
  locale.bindKeyCode(equalKeyCode,        ['equal', 'equalsign', '=']);
  locale.bindKeyCode(leftCommandKeyCode,  ['command', 'windows', 'win', 'super', 'leftcommand', 'leftwindows', 'leftwin', 'leftsuper']);
  locale.bindKeyCode(rightCommandKeyCode, ['command', 'windows', 'win', 'super', 'rightcommand', 'rightwindows', 'rightwin', 'rightsuper']);

  // kill keys
  locale.setKillKey('command');
};
