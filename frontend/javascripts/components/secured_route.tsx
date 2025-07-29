import LoginView from "admin/auth/login_view";
import {
  type PricingPlanEnum,
  isFeatureAllowedByPricingPlan,
} from "admin/organization/pricing_plan_utils";
import { getUnversionedAnnotationInformation } from "admin/rest_api";
import { PageUnavailableForYourPlanView } from "components/pricing_enforcers";
import { useWkSelector } from "libs/react_hooks";
import { isUserAdminOrManager } from "libs/utils";
import type React from "react";
import { memo, useCallback, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { PageNotAvailableToNormalUser } from "./permission_enforcer";

export type SecuredRouteProps = {
  children: React.ReactNode;
  requiredPricingPlan?: PricingPlanEnum;
  requiresAdminOrManagerRole?: boolean;
  checkIfResourceIsPublic?: boolean;
};

function SecuredRoute({
  children,
  requiredPricingPlan,
  requiresAdminOrManagerRole,
  checkIfResourceIsPublic = false,
}: SecuredRouteProps) {
  const location = useLocation();
  const { id } = useParams();
  const activeOrganization = useWkSelector((state) => state.activeOrganization);
  const activeUser = useWkSelector((state) => state.activeUser);
  const isAuthenticated = activeUser !== null;
  const [isSecuredResourcePubliclyAvailable, setIsSecuredResourcePubliclyAvailable] =
    useState(false);

  const getIsResourcePublic = useCallback(async () => {
    if (id) {
      try {
        const annotationInformation = await getUnversionedAnnotationInformation(id || "");
        return annotationInformation.visibility === "Public";
      } catch (_ex) {
        // Annotation could not be found
      }
    }

    return false;
  }, [id]);

  useEffect(() => {
    async function fetchData() {
      if (!isAuthenticated && checkIfResourceIsPublic) {
        const isAdditionallyAuthenticated = await getIsResourcePublic();
        setIsSecuredResourcePubliclyAvailable(isAdditionallyAuthenticated);
      }
    }
    fetchData();
  }, [isAuthenticated, getIsResourcePublic, checkIfResourceIsPublic]);

  const isCompletelyAuthenticated = checkIfResourceIsPublic
    ? isAuthenticated || isSecuredResourcePubliclyAvailable
    : isAuthenticated;
  const isAdminOrManager = activeUser && isUserAdminOrManager(activeUser);

  if (!isCompletelyAuthenticated) {
    return <LoginView redirect={`${location.pathname}${location.search}`} />;
  }

  if (
    requiredPricingPlan &&
    !isFeatureAllowedByPricingPlan(activeOrganization, requiredPricingPlan)
  ) {
    return <PageUnavailableForYourPlanView requiredPricingPlan={requiredPricingPlan} />;
  }
  if (requiresAdminOrManagerRole && !isAdminOrManager) {
    return <PageNotAvailableToNormalUser />;
  }

  return children;
}

export default memo(SecuredRoute);
