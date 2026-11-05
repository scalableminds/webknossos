import type { ApiResult } from "admin/api/api_result";
import LoginView from "admin/auth/login_view";
import {
  isFeatureAllowedByPricingPlan,
  type PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import { getUnversionedAnnotationInformation } from "admin/rest_api";
import BrainSpinner from "components/brain_spinner";
import { PageUnavailableForYourPlanView } from "components/pricing_enforcers";
import { useApi, useWkSelector } from "libs/react_hooks";
import { isUserAdminOrManager } from "libs/utils";
import type React from "react";
import { memo } from "react";
import { useLocation, useParams } from "react-router";
import type { APIAnnotationVisibility } from "types/api_types";
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
  // If the annotation cannot be found, the query fails without an error toast and the
  // resource is treated as not public. Cached data is ignored until a fresh response
  // arrived, since the visibility might have changed in the meantime.
  const shouldCheckVisibility = !isAuthenticated && checkIfResourceIsPublic && !!id;
  const {
    data: visibility,
    isFetchedAfterMount,
    isSuccess,
  } = useApi({
    // Own root key so that invalidations of the merge modal's (persisted)
    // ["unversionedAnnotation", id] query don't hit this one.
    queryKey: ["annotationVisibility", id],
    queryFn: async (): Promise<ApiResult<APIAnnotationVisibility>> => {
      const result = await getUnversionedAnnotationInformation(id as string, {
        showErrorToast: false,
      });
      // Only keep the visibility in the cache, not the whole annotation.
      return result.ok ? { ok: true, value: result.value.visibility } : result;
    },
    enabled: shouldCheckVisibility,
    // A failed background refetch would flip isSuccess and unmount the open viewer.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { persist: false },
  });
  const isSecuredResourcePubliclyAvailable =
    isFetchedAfterMount && isSuccess && visibility === "Public";

  const isCompletelyAuthenticated = checkIfResourceIsPublic
    ? isAuthenticated || isSecuredResourcePubliclyAvailable
    : isAuthenticated;
  const isAdminOrManager = activeUser && isUserAdminOrManager(activeUser);

  if (!isCompletelyAuthenticated) {
    // Avoid flashing the login form for annotations that turn out to be public.
    // The viewer shows the same spinner while loading.
    if (shouldCheckVisibility && !isFetchedAfterMount) {
      return <BrainSpinner />;
    }
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
