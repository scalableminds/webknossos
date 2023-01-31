import React from "react";
import { Route, withRouter } from "react-router-dom";
import { connect } from "react-redux";
import LoginView from "admin/auth/login_view";
import { PricingPlanEnum } from "admin/organization/organization_edit_view";
import { isPricingPlanGreaterEqualThan } from "admin/organization/pricing_plan_utils";
import { APIOrganization } from "types/api_flow_types";
import { PageUnavailableForYourPlanView } from "components/pricing_enforcers";
import type { ComponentType } from "react";
import type { RouteComponentProps } from "react-router-dom";
import type { OxalisState } from "oxalis/store";

type StateProps = {
  activeOrganization: APIOrganization | null;
};
export type SecuredRouteProps = RouteComponentProps &
  StateProps & {
    component?: ComponentType<any>;
    path: string;
    render?: (arg0: RouteComponentProps) => React.ReactNode;
    isAuthenticated: boolean;
    requiredPricingPlan?: PricingPlanEnum;
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
    return (
      <Route
        {...rest}
        render={(props) => {
          if (!isCompletelyAuthenticated) {
            return <LoginView redirect={this.props.location.pathname} />;
          }

          if (
            this.props.requiredPricingPlan &&
            !(
              this.props.activeOrganization &&
              isPricingPlanGreaterEqualThan(
                this.props.activeOrganization.pricingPlan,
                this.props.requiredPricingPlan,
              )
            )
          ) {
            return <PageUnavailableForYourPlanView />;
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
});

const connector = connect(mapStateToProps);
export default connector(withRouter<SecuredRouteProps, any>(SecuredRoute));
