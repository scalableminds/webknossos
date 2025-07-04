import LoginView from "admin/auth/login_view";
import {
  type PricingPlanEnum,
  isFeatureAllowedByPricingPlan,
} from "admin/organization/pricing_plan_utils";
import { PageUnavailableForYourPlanView } from "components/pricing_enforcers";
import { useWkSelector } from "libs/react_hooks";
import { isUserAdminOrManager } from "libs/utils";
import React from "react";
import { useLocation } from "react-router-dom";
import { PageNotAvailableToNormalUser } from "./permission_enforcer";

export type SecuredRouteProps = {
  children: React.ReactNode;
  requiredPricingPlan?: PricingPlanEnum;
  requiresAdminOrManagerRole?: boolean;
  serverAuthenticationCallback?: (...args: Array<any>) => any;
};

function SecuredRoute(props: SecuredRouteProps) {
  const location = useLocation();
  const activeOrganization = useWkSelector((state) => state.activeOrganization);
  const activeUser = useWkSelector((state) => state.activeUser);
  const isAuthenticated = activeUser !== null;
  const [isAdditionallyAuthenticated, setIsAdditionallyAuthenticated] = React.useState(false);

  React.useEffect(() => {
    async function fetchData() {
      if (!isAuthenticated && props.serverAuthenticationCallback != null) {
        const isAdditionallyAuthenticated = await props.serverAuthenticationCallback();
        setIsAdditionallyAuthenticated(isAdditionallyAuthenticated);
      }
    }
    fetchData();
  }, [isAuthenticated, props.serverAuthenticationCallback]);

  const { serverAuthenticationCallback, children, ..._rest } = props;
  const isCompletelyAuthenticated = serverAuthenticationCallback
    ? isAuthenticated || isAdditionallyAuthenticated
    : isAuthenticated;
  const isAdminOrManager = activeUser && isUserAdminOrManager(activeUser);

  if (!isCompletelyAuthenticated) {
    return <LoginView redirect={`${location.pathname}${location.search}`} />;
  }

  if (
    props.requiredPricingPlan &&
    !isFeatureAllowedByPricingPlan(activeOrganization, props.requiredPricingPlan)
  ) {
    return <PageUnavailableForYourPlanView requiredPricingPlan={props.requiredPricingPlan} />;
  }
  if (props.requiresAdminOrManagerRole && !isAdminOrManager) {
    return <PageNotAvailableToNormalUser />;
  }

  return children;
}

export default React.memo(SecuredRoute);
