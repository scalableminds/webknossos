import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";

// Allows to listen on a certain property of the store.
// This function should only be used when listening to the Store
// via react components (+ redux) is not an option.
//
// Usage:
// const unsubscribe = listenToStoreProperty(
//   (state) => state.someProperty.weWantToListenOn,
//   (newValue) => {
//     // do something with the new value
//   }
// );
// Don't forget to call unsubscribe(); if the handler is not needed anymore.
export function listenToStoreProperty<T>(
  select: (arg0: OxalisState) => T,
  onChange: (value: T) => void,
  callHandlerOnSubscribe: boolean | null | undefined = false,
): () => void {
  // @ts-expect-error ts-migrate(7034) FIXME: Variable 'currentValue' implicitly has type 'any' ... Remove this comment to see the full error message
  let currentValue;

  function handleChange(isOnSubscribeCall: boolean = false) {
    const nextValue = select(Store.getState());

    // Always trigger the first onChange call if callHandlerOnSubscribe
    // is true. Without the isOnSubscribeCall condition, the first
    // call would not happen if `select` returns null.
    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'currentValue' implicitly has an 'any' ty... Remove this comment to see the full error message
    if (nextValue !== currentValue || isOnSubscribeCall) {
      currentValue = nextValue;
      onChange(currentValue);
    }
  }

  if (callHandlerOnSubscribe) {
    handleChange(true);
  }

  // return the unsubscribe function
  return Store.subscribe(handleChange);
}
export default {};
