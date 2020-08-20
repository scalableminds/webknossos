// @flow
import { PropTypes } from "@scalableminds/prop-types";
import type { RouterHistory } from "react-router-dom";
import _ from "lodash";

import ErrorHandling from "libs/error_handling";

class Persistence<T: Object> {
  stateProperties: { [$Keys<T>]: Function };
  name: string;

  constructor(stateProperties: { [$Keys<T>]: Function }, name: string) {
    this.stateProperties = stateProperties;
    this.name = name;
  }

  load(history: RouterHistory): $Shape<T> | {||} {
    const locationState = history.location.state;
    if (locationState != null && locationState[this.name] != null) {
      console.log(
        "Try to restore persisted history state of component with this.name:",
        this.name,
        "- state:",
        locationState[this.name],
      );
      const persistedState = _.pick(locationState[this.name], Object.keys(this.stateProperties));
      try {
        // Check whether the type of the persisted state conforms to that of the component to avoid messing up
        // the components state - this could happen if the type of a state property changed
        PropTypes.checkPropTypes(
          this.stateProperties,
          persistedState,
          "persisted state property",
          this.name,
        );
      } catch (e) {
        // Reset the persisted state and log the error to airbrake so we learn whether and how often this happens
        this.persist(history, {}, {});
        ErrorHandling.notify(e);
        return {};
      }
      return persistedState;
    }
    return {};
  }

  persist(
    history: RouterHistory,
    state: $Shape<T>,
    stateProperties?: { [$Keys<T>]: Function } = this.stateProperties,
  ) {
    const locationState = history.location.state || {};
    const stateToBePersisted = _.pick(state, Object.keys(stateProperties));
    if (
      locationState[this.name] == null ||
      !_.isEqual(stateToBePersisted, locationState[this.name])
    ) {
      // If one of the state properties changed, replace the whole state
      history.replace(
        history.location.pathname,
        // There could be multiple state namespaces on one page, so only extend the current location state,
        // but do not replace it
        _.extend(locationState, {
          [this.name]: stateToBePersisted,
        }),
      );
    }
  }
}

export default Persistence;
