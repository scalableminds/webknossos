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
  function handleChange() {
    const nextValue = select(Store.getState());
    // When callHandlerOnSubscribe is used, the initial value can be 0. In that case,
    // we do not want to invoke the caller-provided isEqual function, since this usually
    // doesn't handle null values.
    if (nextValue !== currentValue) {
      currentValue = nextValue;
      onChange(currentValue);
    }
  }

  if (callHandlerOnSubscribe) {
    handleChange();
  }

  // return the unsubscribe function
  return Store.subscribe(handleChange);
}

export default {};
