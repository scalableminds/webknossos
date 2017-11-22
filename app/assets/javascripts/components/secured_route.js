// @flow
import React from "react";
import { Route, withRouter } from "react-router-dom";
import LoginView from "admin/views/auth/login_view";

import type { ReactRouterMatchType, ReactRouterLocationType } from "react_router";

type Props = {
  component: typeof React$Component,
  render: Function,
  isAuthenticated: boolean,
  serverAuthenticationCallback: Function,
  computedMatch: ReactRouterMatchType,
  location: ReactRouterLocationType,
};

type State = {
  isAddtionallyAuthenticated: boolean,
};

class SecuredRoute extends React.PureComponent<Props, State> {
  state = {
    isAddtionallyAuthenticated: false,
  };

  componentDidMount() {
    if (this.props.serverAuthenticationCallback) {
      this.fetchData();
    }
  }

  async fetchData() {
    const isAddtionallyAuthenticated = await this.props.serverAuthenticationCallback({
      match: this.props.computedMatch,
      location: this.props.location,
    });
    this.setState({ isAddtionallyAuthenticated });
  }

  render() {
    const {
      component: Component,
      render,
      isAuthenticated,
      serverAuthenticationCallback,
      ...rest
    } = this.props;

    const isCompletlyAuthenticated = serverAuthenticationCallback
      ? isAuthenticated || this.state.isAddtionallyAuthenticated
      : isAuthenticated;

    return (
      <Route
        {...rest}
        render={props => {
          if (isCompletlyAuthenticated) {
            return Component ? <Component {...props} /> : render(props);
          }

          return <LoginView />;
        }}
      />
    );
  }
}

export default withRouter(SecuredRoute);
