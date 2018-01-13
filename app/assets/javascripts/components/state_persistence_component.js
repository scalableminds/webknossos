// @flow
import _ from "lodash";
import { PropTypes } from "prop-types";
import ErrorHandling from "libs/error_handling";
import type { RouterHistory } from "react-router-dom";

export function loadPersisted<T: Object>(
  history: RouterHistory,
  name: string,
  stateProperties: { [$Keys<T>]: Function },
): $Shape<T> {
  const locationState = history.location.state;
  if (locationState != null && locationState[name] != null) {
    console.log(
      "Try to restore persisted history state of component with name:",
      name,
      "- state:",
      locationState[name],
    );
    const persistedState = _.pick(locationState[name], Object.keys(stateProperties));
    try {
      // Check whether the type of the persisted state conforms to that of the component to avoid messing up
      // the components state - this could happen if the type of a state property changed
      PropTypes.checkPropTypes(stateProperties, persistedState, "persisted state property", name);
    } catch (e) {
      // Reset the persisted state and log the error to airbrake so we learn whether and how often this happens
      persist(history, name, {}, {});
      ErrorHandling.notify(e);
      return {};
    }
    return persistedState;
  }
  return {};
}

export function persist<T: Object>(
  history: RouterHistory,
  name: string,
  stateProperties: { [$Keys<T>]: Function },
  state: T,
) {
  const locationState = history.location.state || {};
  const stateToBePersisted = _.pick(state, Object.keys(stateProperties));
  if (locationState[name] == null || !_.isEqual(stateToBePersisted, locationState[name])) {
    // If one of the state properties changed, replace the whole state
    history.replace(
      history.location.pathname,
      // There could be multiple state namespaces on one page, so only extend the current location state,
      // but do not replace it
      _.extend(locationState, {
        [name]: stateToBePersisted,
      }),
    );
  }
}
