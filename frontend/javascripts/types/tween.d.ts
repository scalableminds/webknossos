declare namespace TWEEN {
  export function getAll(): Tween[];
  export function removeAll(): void;
  export function add(tween: Tween): void;
  export function remove(tween: Tween): void;
  export function update(time?: number, preserve?: boolean): boolean;
  export function now(): number;

  export class Tween {
    constructor(object: any);
    
    to(properties: object, duration?: number): this;
    start(time?: number): this;
    stop(): this;
    end(): this;
    stopChainedTweens(): void;
    delay(amount: number): this;
    repeat(times: number): this;
    repeatDelay(amount: number): this;
    yoyo(yoyo: boolean): this;
    easing(easing: (k: number) => number): this;
    interpolation(interpolation: (v: any[], k: number) => number): this;
    chain(...tweens: Tween[]): this;
    onStart(callback: (object: any) => void): this;
    onUpdate(callback: (value: number) => void): this;
    onComplete(callback: (object: any) => void): this;
    onStop(callback: (object: any) => void): this;
    update(time: number): boolean;
  }

  export namespace Easing {
    export namespace Linear {
      export function None(k: number): number;
    }

    export namespace Quadratic {
      export function In(k: number): number;
      export function Out(k: number): number;
      export function InOut(k: number): number;
    }

    export namespace Cubic {
      export function In(k: number): number;
      export function Out(k: number): number;
      export function InOut(k: number): number;
    }

    export namespace Quartic {
      export function In(k: number): number;
      export function Out(k: number): number;
      export function InOut(k: number): number;
    }

    export namespace Quintic {
      export function In(k: number): number;
      export function Out(k: number): number;
      export function InOut(k: number): number;
    }

    export namespace Sinusoidal {
      export function In(k: number): number;
      export function Out(k: number): number;
      export function InOut(k: number): number;
    }

    export namespace Exponential {
      export function In(k: number): number;
      export function Out(k: number): number;
      export function InOut(k: number): number;
    }

    export namespace Circular {
      export function In(k: number): number;
      export function Out(k: number): number;
      export function InOut(k: number): number;
    }

    export namespace Elastic {
      export function In(k: number): number;
      export function Out(k: number): number;
      export function InOut(k: number): number;
    }

    export namespace Back {
      export function In(k: number): number;
      export function Out(k: number): number;
      export function InOut(k: number): number;
    }

    export namespace Bounce {
      export function In(k: number): number;
      export function Out(k: number): number;
      export function InOut(k: number): number;
    }
  }

  export namespace Interpolation {
    export function Linear(v: any[], k: number): number;
    export function Bezier(v: any[], k: number): number;
    export function CatmullRom(v: any[], k: number): number;

    export namespace Utils {
      export function Linear(p0: number, p1: number, t: number): number;
      export function Bernstein(n: number, i: number): number;
      export function Factorial(n: number): number;
      export function CatmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number;
    }
  }
}

declare module "tween.js" {
  export = TWEEN;
} 