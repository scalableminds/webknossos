declare module "keyboardjs" {
  export interface Handler {
    (event: KeyboardEvent): void;
  }

  export class KeyCombo {
    constructor(keyComboStr: string);
    check(pressedKeys: string[]): boolean;
    isEqual(keyComboStr: string | string[]): boolean;
    keyNames: string[];
  }

  export class Locale {
    constructor(name: string);
    bindKeyCode(keyCode: number, keyNames: string | string[]): void;
    bindMacro(keyComboStr: string, keyNames: string | string[]): void;
    setKillKey(keyName: string): void;
    pressKey(keyCode: number): void;
    releaseKey(keyCode: number): void;
    getKeyNames(keyCode: number): string[];
    pressedKeys: string[];
    activeTargetKeys: string[];
  }

  export class Keyboard {
    constructor(
      targetWindow?: Window | null,
      targetElement?: Document | HTMLElement | null,
      targetPlatform?: string | null,
      targetUserAgent?: string | null
    );

    setLocale(
      localeName: string,
      localeBuilder?: (
        locale: Locale,
        platform: string,
        userAgent: string
      ) => void
    ): this;
    getLocale(localName?: string): Locale | null;

    bind(
      keyComboStr: string | string[] | null,
      pressHandler?: Handler | null,
      releaseHandler?: Handler | null,
      preventRepeatByDefault?: boolean
    ): this;
    addListener(
      keyComboStr: string | string[] | null,
      pressHandler?: Handler | null,
      releaseHandler?: Handler | null,
      preventRepeatByDefault?: boolean
    ): this;
    on(
      keyComboStr: string | string[] | null,
      pressHandler?: Handler | null,
      releaseHandler?: Handler | null,
      preventRepeatByDefault?: boolean
    ): this;

    bindPress(
      keyComboStr: string | string[] | null,
      pressHandler: Handler,
      preventRepeatByDefault?: boolean
    ): this;
    bindRelease(
      keyComboStr: string | string[] | null,
      releaseHandler: Handler
    ): this;

    unbind(
      keyComboStr: string | string[] | null,
      pressHandler?: Handler | null,
      releaseHandler?: Handler | null
    ): this;
    removeListener(
      keyComboStr: string | string[] | null,
      pressHandler?: Handler | null,
      releaseHandler?: Handler | null
    ): this;
    off(
      keyComboStr: string | string[] | null,
      pressHandler?: Handler | null,
      releaseHandler?: Handler | null
    ): this;

    setContext(contextName: string): this;
    getContext(): string;
    withContext(contextName: string, callback: () => void): this;

    watch(
      targetWindow?: Window | null,
      targetElement?: Document | HTMLElement | null,
      targetPlatform?: string | null,
      targetUserAgent?: string | null
    ): this;
    stop(): this;

    pressKey(keyCode: number | string, event?: any): this;
    releaseKey(keyCode: number | string, event?: any): this;
    releaseAllKeys(event?: any): this;
    pause(): this;
    resume(): this;
    reset(): this;
  }

  const keyboardInstance: Keyboard & {
    Keyboard: typeof Keyboard;
    Locale: typeof Locale;
    KeyCombo: typeof KeyCombo;
  };

  export default keyboardInstance;
}

declare module "keyboardjs/locales/us" {
  import { Locale } from "keyboardjs";
  export function us(locale: Locale, platform: string, userAgent: string): void;
}
