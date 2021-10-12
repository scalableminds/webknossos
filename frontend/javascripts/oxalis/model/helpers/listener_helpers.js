// @flow
import Store, { type OxalisState } from "oxalis/store";

// Allows to listen on a certain property of the store.
// This function should only be used for converting legacy code to redux
// (especially as a replacement for backbone's listenTo calls).
// Try not to use this for new code.
// Usage:
// const unsubscribe = listenToStoreProperty(
//   (state) => state.someProperty.weWantToListenOn,
//   (newValue) => {
//     // do something with the new value
//   }
// );
// Don't forget to call unsubscribe(); if the handler is not needed anymore.

export function listenToStoreProperty<T>(
  select: OxalisState => T,
  onChange: (value: T) => void,
  callHandlerOnSubscribe: ?boolean = false,
): () => void {
  let currentValue;
  function handleChange(isOnSubscribeCall: boolean = false) {
    const nextValue = select(Store.getState());
    // Always trigger the first onChange call if callHandlerOnSubscribe
    // is true. Without the isOnSubscribeCall condition, the first
    // call would not happen if `select` returns null.
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
