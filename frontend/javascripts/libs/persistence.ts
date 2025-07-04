import { PropTypes } from "@scalableminds/prop-types";
import ErrorHandling from "libs/error_handling";
import _ from "lodash";
import type { EmptyObject } from "types/globals";

class Persistence<T extends Record<string, any>> {
  stateProperties: Record<keyof T, any>;
  name: string;

  constructor(stateProperties: Record<keyof T, any>, name: string) {
    this.stateProperties = stateProperties;
    this.name = name;
  }

  load(): Partial<T> {
    const locationState = window.history.state as Record<string, T>;

    if (locationState?.[this.name] != null) {
      console.log(
        "Try to restore persisted history state of component with this.name:",
        this.name,
        "- state:",
        locationState[this.name],
      );

      const persistedState = _.pick(
        locationState[this.name],
        Object.keys(this.stateProperties),
      ) as T;

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
        this.persist({}, {});
        // @ts-ignore
        ErrorHandling.notify(e);
        return {};
      }

      return persistedState;
    }

    return {};
  }

  persist(
    state: Partial<T>,
    stateProperties: Record<keyof T, any> | EmptyObject = this.stateProperties,
  ) {
    const locationState = (window.history.state || {}) as Record<string, T>;

    const stateToBePersisted = _.pick(state, Object.keys(stateProperties));

    if (
      locationState[this.name] == null ||
      !_.isEqual(stateToBePersisted, locationState[this.name])
    ) {
      // Don't use the navigate object of react-router here, because
      // calling navigate(..., replace=True) leads to focus-loss-bugs for input fields
      // which are rendered into portals (this is the case for the search box
      // in the dashboard).

      // If one of the state properties changed, replace the whole state
      window.history.replaceState(
        // There could be multiple state namespaces on one page, so only extend the current location state,
        // but do not replace it
        _.extend(locationState, {
          [this.name]: stateToBePersisted,
        }),
        "",
      );
    }
  }
}

export default Persistence;
