// @flow
import { type ContextRouter, type Location, type Match, Route, withRouter } from "react-router-dom";
import React, { type ComponentType } from "react";

import LoginView from "admin/auth/login_view";

type Props = {|
  component?: ComponentType<*>,
  path: string,
  render?: ContextRouter => React$Node,
  isAuthenticated: boolean,
  serverAuthenticationCallback?: Function,
  computedMatch: Match,
  location: Location,
  exact?: boolean,
|};

type State = {
  isAdditionallyAuthenticated: boolean,
};

class SecuredRoute extends React.PureComponent<Props, State> {
  state = {
    isAdditionallyAuthenticated: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    if (this.props.serverAuthenticationCallback != null) {
      const isAdditionallyAuthenticated = await this.props.serverAuthenticationCallback({
        match: this.props.computedMatch,
        location: this.props.location,
      });
      this.setState({ isAdditionallyAuthenticated });
    }
  }

  render() {
    const {
      component: Component,
      render,
      isAuthenticated,
      serverAuthenticationCallback,
      ...rest
    } = this.props;

    const isCompletelyAuthenticated = serverAuthenticationCallback
      ? isAuthenticated || this.state.isAdditionallyAuthenticated
      : isAuthenticated;

    return (
      <Route
        {...rest}
        render={props => {
          if (isCompletelyAuthenticated) {
            if (Component != null) {
              return <Component />;
            } else if (render != null) {
              return render(props);
            } else {
              throw Error("Specified neither component nor render function.");
            }
          }

          return <LoginView layout="horizontal" redirect={this.props.location.pathname} />;
        }}
      />
    );
  }
}

export default withRouter(SecuredRoute);
