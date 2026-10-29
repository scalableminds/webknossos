import LoginView from "admin/auth/login_view";
import {
  isFeatureAllowedByPricingPlan,
  type PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import { getUnversionedAnnotationInformation } from "admin/rest_api";
import { PageUnavailableForYourPlanView } from "components/pricing_enforcers";
import { useApi, useWkSelector } from "libs/react_hooks";
import { isUserAdminOrManager } from "libs/utils";
import type React from "react";
import { memo } from "react";
import { useLocation, useParams } from "react-router";
import { PageNotAvailableToNormalUser } from "./permission_enforcer";

type SecuredRouteProps = {
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
  // If the annotation cannot be found, the query fails silently and the resource is
  // treated as not public. Cached data is ignored until a fresh response arrived, since
  // the visibility might have changed in the meantime.
  const {
    data: annotationInformation,
    isFetchedAfterMount,
    isSuccess,
  } = useApi({
    queryKey: ["unversionedAnnotation", id],
    queryFn: () => getUnversionedAnnotationInformation(id as string),
    enabled: !isAuthenticated && checkIfResourceIsPublic && !!id,
    refetchOnWindowFocus: false,
    meta: { persist: false },
  });
  const isSecuredResourcePubliclyAvailable =
    isFetchedAfterMount && isSuccess && annotationInformation?.visibility === "Public";

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
