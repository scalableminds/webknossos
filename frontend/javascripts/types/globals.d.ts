declare global {
  interface Window {
    needsRerender: boolean;
  }
}

type ValueOf<T> = T[keyof T];
export { ValueOf };
