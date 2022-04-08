import type { RouteComponentProps } from "react-router-dom";
import { Route, withRouter } from "react-router-dom";
import type { ComponentType } from "react";
import React from "react";
import LoginView from "admin/auth/login_view";

type Props = RouteComponentProps & {
  component?: ComponentType<any>;
  path: string;
  render?: (arg0: RouteComponentProps) => React.ReactNode;
  isAuthenticated: boolean;
  serverAuthenticationCallback?: (...args: Array<any>) => any;
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
        // @ts-expect-error computedMatch is a private property of ReactRouter and not exposed through their types
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

          return <LoginView redirect={this.props.location.pathname} />;
        }}
      />
    );
  }
}


export default withRouter<Props, any>(SecuredRoute);
