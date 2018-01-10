// @flow
import _ from "lodash";
import * as React from "react";
import { withRouter } from "react-router-dom";
import type { RouterHistory } from "react-router-dom";

type Props = {
  name: string,
  stateProperties: Array<string>,
  state: Object,
  updateState: Object => void,
  history: RouterHistory,
};

class StatePersistenceComponent extends React.PureComponent<Props> {
  componentWillMount() {
    if (
      this.props.history.location.state != null &&
      this.props.history.location.state[this.props.name] != null
    ) {
      const locationState = this.props.history.location.state[this.props.name];
      console.log(
        "Restore history state of component with name:",
        this.props.name,
        "- state:",
        locationState,
      );
      const newState = _.pick(locationState, this.props.stateProperties);
      this.props.updateState(newState);
    }
  }

  componentDidUpdate(prevProps: Props) {
    for (const key of this.props.stateProperties) {
      if (!_.isEqual(this.props.state[key], prevProps.state[key])) {
        // If one of the state properties changed, replace the whole state
        this.props.history.replace(
          this.props.history.location.pathname,
          // There could be multiple StatePersistenceComponents on one page, so only extend the current location state,
          // but do not replace it
          _.extend(this.props.history.location.state, {
            [this.props.name]: _.pick(this.props.state, this.props.stateProperties),
          }),
        );
        break;
      }
    }
  }

  render() {
    return null;
  }
}

export default withRouter(StatePersistenceComponent);
