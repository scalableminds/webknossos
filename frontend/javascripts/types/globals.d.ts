declare global {
  interface Window {
    needsRerender: boolean;
  }
}

// https://stackoverflow.com/questions/49285864/is-there-a-valueof-similar-to-keyof-in-typescript
type ValueOf<T> = T[keyof T];
export { ValueOf };
