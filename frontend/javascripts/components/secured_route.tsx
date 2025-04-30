import LoginView from "admin/auth/login_view";
import {
  type PricingPlanEnum,
  isFeatureAllowedByPricingPlan,
} from "admin/organization/pricing_plan_utils";
import { PageUnavailableForYourPlanView } from "components/pricing_enforcers";
import { isUserAdminOrManager } from "libs/utils";
import type { OxalisState } from "oxalis/store";
import React from "react";
import type { ComponentType } from "react";
import { connect } from "react-redux";
import { Route, withRouter } from "react-router-dom";
import type { RouteComponentProps } from "react-router-dom";
import type { APIOrganization, APIUser } from "types/api_types";
import { PageNotAvailableToNormalUser } from "./permission_enforcer";

type StateProps = {
  activeOrganization: APIOrganization | null;
  activeUser: APIUser | null | undefined;
};
export type SecuredRouteProps = RouteComponentProps &
  StateProps & {
    component?: ComponentType<any>;
    path: string;
    render?: (arg0: RouteComponentProps) => React.ReactNode;
    isAuthenticated: boolean;
    requiredPricingPlan?: PricingPlanEnum;
    requiresAdminOrManagerRole?: boolean;
    serverAuthenticationCallback?: (...args: Array<any>) => any;
    exact?: boolean;
  };
type State = {
  isAdditionallyAuthenticated: boolean;
};

class SecuredRoute extends React.PureComponent<SecuredRouteProps, State> {
  state: State = {
    isAdditionallyAuthenticated: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    if (!this.props.isAuthenticated && this.props.serverAuthenticationCallback != null) {
      const isAdditionallyAuthenticated = await this.props.serverAuthenticationCallback({
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'computedMatch' does not exist on type 'R... Remove this comment to see the full error message
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
    const isAdminOrManager = this.props.activeUser && isUserAdminOrManager(this.props.activeUser);
    return (
      <Route
        {...rest}
        render={(props) => {
          if (!isCompletelyAuthenticated) {
            return (
              <LoginView
                redirect={this.props.location.pathname.concat(this.props.location.search)}
              />
            );
          }

          if (
            this.props.requiredPricingPlan &&
            !isFeatureAllowedByPricingPlan(
              this.props.activeOrganization,
              this.props.requiredPricingPlan,
            )
          ) {
            return (
              <PageUnavailableForYourPlanView
                requiredPricingPlan={this.props.requiredPricingPlan}
              />
            );
          }
          if (this.props.requiresAdminOrManagerRole && !isAdminOrManager) {
            return <PageNotAvailableToNormalUser />;
          }

          if (Component != null) {
            return <Component />;
          } else if (render != null) {
            return render(props);
          } else {
            throw Error("Specified neither component nor render function.");
          }
        }}
      />
    );
  }
}
const mapStateToProps = (state: OxalisState): StateProps => ({
  activeOrganization: state.activeOrganization,
  activeUser: state.activeUser,
});

const connector = connect(mapStateToProps);
export default connector(withRouter<SecuredRouteProps, any>(SecuredRoute));
