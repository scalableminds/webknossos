// @ts-expect-error ts-migrate(2305) FIXME: Module '"react-router-dom"' has no exported member... Remove this comment to see the full error message
import type { ContextRouter, Location, Match } from "react-router-dom";
import { Route, withRouter } from "react-router-dom";
import type { ComponentType } from "react";
import React from "react";
import LoginView from "admin/auth/login_view";
type Props = {
  component?: ComponentType<any>;
  path: string;
  render?: (arg0: ContextRouter) => React.ReactNode;
  isAuthenticated: boolean;
  serverAuthenticationCallback?: (...args: Array<any>) => any;
  computedMatch: Match;
  location: Location;
  exact?: boolean;
};
type State = {
  isAdditionallyAuthenticated: boolean;
};

class SecuredRoute extends React.PureComponent<Props, State> {
  state = {
    isAdditionallyAuthenticated: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    if (!this.props.isAuthenticated && this.props.serverAuthenticationCallback != null) {
      const isAdditionallyAuthenticated = await this.props.serverAuthenticationCallback({
        match: this.props.computedMatch,
        location: this.props.location,
      });
      this.setState({
        isAdditionallyAuthenticated,
      });
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
        render={(props) => {
          if (isCompletelyAuthenticated) {
            if (Component != null) {
              return <Component />;
            } else if (render != null) {
              return render(props);
            } else {
              throw Error("Specified neither component nor render function.");
            }
          }

          // @ts-expect-error ts-migrate(2322) FIXME: Type '{ layout: string; redirect: any; }' is not a... Remove this comment to see the full error message
          return <LoginView layout="horizontal" redirect={this.props.location.pathname} />;
        }}
      />
    );
  }
}

// @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'typeof SecuredRoute' is not assi... Remove this comment to see the full error message
export default withRouter(SecuredRoute);
