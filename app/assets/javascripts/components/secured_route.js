// @flow
import React from "react";
import { Route, withRouter } from "react-router-dom";
import LoginView from "admin/views/auth/login_view";
import type { Match, Location, ContextRouter } from "react-router-dom";
import type { ComponentType } from "react";

type Props = {
  component?: ComponentType<*>,
  path: string,
  render?: (router: ContextRouter) => React$Node,
  isAuthenticated: boolean,
  serverAuthenticationCallback?: Function,
  computedMatch: Match,
  location: Location,
};

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
              return <Component {...props} />;
            } else if (render != null) {
              return render(props);
            } else {
              throw Error("Did specify neither component nor render function.");
            }
          }

          return <LoginView layout="horizontal" />;
        }}
      />
    );
  }
}

export default withRouter(SecuredRoute);
