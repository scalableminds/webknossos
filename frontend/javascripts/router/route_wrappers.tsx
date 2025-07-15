import {
  getDatasetIdFromNameAndOrganization,
  getOrganizationForDataset,
} from "admin/api/disambiguate_legacy_routes";
import Onboarding from "admin/onboarding";
import { createExplorational, getShortLink } from "admin/rest_api";
import AsyncRedirect from "components/redirect";
import DashboardView, { urlTokenToTabKeyMap } from "dashboard/dashboard_view";
import { DatasetSettingsProvider } from "dashboard/dataset/dataset_settings_provider";
import DatasetSettingsView from "dashboard/dataset/dataset_settings_view";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import * as Utils from "libs/utils";
import { coalesce } from "libs/utils";
import window from "libs/window";
import { isNumber } from "lodash";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { APICompoundTypeEnum, type APIMagRestrictions, TracingTypeEnum } from "types/api_types";
import { ControlModeEnum } from "viewer/constants";
import { getDatasetIdOrNameFromReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { Store } from "viewer/singletons";
import TracingLayoutView from "viewer/view/layouting/tracing_layout_view";
import { PageNotFoundView } from "./page_not_found_view";

export function RootRouteWrapper() {
  const isAuthenticated = useWkSelector((state) => state.activeUser != null);
  const hasOrganizations = useWkSelector((state) => state.uiInformation.hasOrganizations);

  if (!hasOrganizations && !features()?.isWkorgInstance) {
    return <Navigate to="/onboarding" />;
  }

  if (isAuthenticated) {
    return <DashboardView userId={null} isAdminView={false} initialTabKey={null} />;
  }

  return <Navigate to="/auth/login" />;
}

export function DashboardRouteRootWrapper() {
  // Imperatively access store state to avoid race condition when logging in.
  // The `isAuthenticated` prop could be outdated for a short time frame which
  // would lead to an unnecessary browser refresh.
  const { activeUser } = Store.getState();
  if (activeUser) {
    return <DashboardView userId={null} isAdminView={false} initialTabKey={null} />;
  }

  // Hard navigate so that webknossos.org is shown for the wkorg instance.
  window.location.href = "/";
  return null;
}

export function DashboardRouteWrapper() {
  const { tab } = useParams();
  const initialTabKey =
    // @ts-ignore If tab does not exist in urlTokenToTabKeyMap, initialTabKey is still valid (i.e., undefined)
    tab ? urlTokenToTabKeyMap[tab] : null;
  return <DashboardView userId={null} isAdminView={false} initialTabKey={initialTabKey} />;
}

export function UserDetailsRouteWrapper() {
  const { userId } = useParams();
  return <DashboardView userId={userId} isAdminView={userId !== null} initialTabKey={null} />;
}

export function AnnotationsRouteWrapper() {
  const { type, id } = useParams();
  const location = useLocation();
  const initialMaybeCompoundType = type != null ? coalesce(APICompoundTypeEnum, type) : null;

  if (initialMaybeCompoundType == null) {
    const { hash, search } = location;
    return <Navigate to={`/annotations/${id}${search}${hash}`} />;
  }

  return <TracingViewRouteWrapper />;
}

export function DatasetSettingsRouteWrapper() {
  const { datasetNameAndId = "" } = useParams();
  const location = useLocation();
  const { datasetId, datasetName } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);
  const getParams = Utils.getUrlParamsObjectFromString(location.search);
  if (datasetName) {
    // Handle very old legacy URLs which neither have a datasetId nor an organizationId.
    // The schema is something like <authority>/datasets/:datasetName/edit
    return (
      <AsyncRedirect
        redirectTo={async () => {
          const organizationId = await getOrganizationForDataset(datasetName, getParams.token);
          const datasetId = await getDatasetIdFromNameAndOrganization(
            datasetName,
            organizationId,
            getParams.token,
          );
          return `/datasets/${datasetName}-${datasetId}/edit`;
        }}
      />
    );
  }
  return (
    <DatasetSettingsProvider
      isEditingMode
      datasetId={datasetId || ""}
      onComplete={() => window.history.back()}
      onCancel={() => window.history.back()}
    >
      <DatasetSettingsView />
    </DatasetSettingsProvider>
  );
}

export function CreateExplorativeRouteWrapper() {
  const { datasetId, type } = useParams();
  const location = useLocation();

  return (
    <AsyncRedirect
      pushToHistory={false}
      redirectTo={async () => {
        if (!datasetId || !type) {
          // Typehint for TS
          throw new Error("Invalid URL");
        }

        const tracingType = coalesce(TracingTypeEnum, type) || TracingTypeEnum.skeleton;
        const { autoFallbackLayer, fallbackLayerName, minMag, maxMag } =
          Utils.getUrlParamsObjectFromString(location.search);
        const magRestrictions: APIMagRestrictions = {};

        if (minMag !== undefined) {
          magRestrictions.min = Number.parseInt(minMag);

          if (!isNumber(magRestrictions.min)) {
            throw new Error("Invalid minMag parameter");
          }

          if (maxMag !== undefined) {
            magRestrictions.max = Number.parseInt(maxMag);

            if (!isNumber(magRestrictions.max)) {
              throw new Error("Invalid maxMag parameter");
            }
          }
        }

        const annotation = await createExplorational(
          datasetId,
          tracingType,
          !!autoFallbackLayer,
          fallbackLayerName,
          null,
          magRestrictions,
        );
        return `/annotations/${annotation.id}`;
      }}
    />
  );
}

export function ShortLinksRouteWrapper() {
  const { key = "" } = useParams();
  return (
    <AsyncRedirect
      redirectTo={async () => {
        const shortLink = await getShortLink(key);
        return shortLink.longLink;
      }}
    />
  );
}

export function TracingViewRouteWrapper() {
  const { type, id } = useParams();
  const initialMaybeCompoundType = type != null ? coalesce(APICompoundTypeEnum, type) : null;

  return (
    <TracingLayoutView
      initialMaybeCompoundType={initialMaybeCompoundType}
      initialCommandType={{
        type: ControlModeEnum.TRACE,
        annotationId: id || "",
      }}
    />
  );
}

export function TracingSandboxLegacyRouteWrapper() {
  const { type, datasetName = "", organizationId = "" } = useParams();
  const location = useLocation();

  const tracingType = coalesce(TracingTypeEnum, type);
  if (tracingType == null) {
    return <h3>Invalid annotation URL.</h3>;
  }
  const getParams = Utils.getUrlParamsObjectFromString(location.search);
  return (
    <AsyncRedirect
      redirectTo={async () => {
        const datasetId = await getDatasetIdFromNameAndOrganization(
          datasetName,
          organizationId,
          getParams.token,
        );
        return `/datasets/${datasetName}-${datasetId}/sandbox/${tracingType}${location.search}${location.hash}`;
      }}
    />
  );
}

export function TracingSandboxRouteWrapper() {
  const { type, datasetNameAndId = "" } = useParams();
  const location = useLocation();

  const tracingType = coalesce(TracingTypeEnum, type);
  const { datasetId, datasetName } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);
  const getParams = Utils.getUrlParamsObjectFromString(location.search);

  if (tracingType == null) {
    return <h3>Invalid annotation URL.</h3>;
  }
  if (datasetName) {
    // Handle very old legacy URLs which neither have a datasetId nor an organizationId.
    // The schema is something like <authority>/datasets/:datasetName/sandbox/<type>
    return (
      <AsyncRedirect
        redirectTo={async () => {
          const organizationId = await getOrganizationForDataset(datasetName, getParams.token);
          const datasetId = await getDatasetIdFromNameAndOrganization(
            datasetName,
            organizationId,
            getParams.token,
          );
          return `/datasets/${datasetName}-${datasetId}/sandbox/${tracingType}${location.search}${location.hash}`;
        }}
      />
    );
  }
  return (
    <TracingLayoutView
      initialMaybeCompoundType={null}
      initialCommandType={{
        type: ControlModeEnum.SANDBOX,
        tracingType,
        datasetId: datasetId || "",
      }}
    />
  );
}

export function TracingViewModeLegacyWrapper() {
  const { datasetName = "", organizationId = "" } = useParams();
  const location = useLocation();
  const getParams = Utils.getUrlParamsObjectFromString(location.search);

  return (
    <AsyncRedirect
      redirectTo={async () => {
        const datasetId = await getDatasetIdFromNameAndOrganization(
          datasetName,
          organizationId,
          getParams.token,
        );
        return `/datasets/${datasetName}-${datasetId}/view${location.search}${location.hash}`;
      }}
    />
  );
}

export function TracingViewModeRouteWrapper() {
  const { datasetNameAndId = "" } = useParams();
  const location = useLocation();

  const { datasetId, datasetName } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);
  const getParams = Utils.getUrlParamsObjectFromString(location.search);

  if (datasetName) {
    // Handle very old legacy URLs which neither have a datasetId nor an organizationId.
    // The schema is something like <authority>/datasets/:datasetName/view
    return (
      <AsyncRedirect
        redirectTo={async () => {
          const organizationId = await getOrganizationForDataset(datasetName, getParams.token);
          const datasetId = await getDatasetIdFromNameAndOrganization(
            datasetName,
            organizationId,
            getParams.token,
          );
          return `/datasets/${datasetName}-${datasetId}/view${location.search}${location.hash}`;
        }}
      />
    );
  }
  return (
    <TracingLayoutView
      initialMaybeCompoundType={null}
      initialCommandType={{
        type: ControlModeEnum.VIEW,
        datasetId: datasetId || "",
      }}
    />
  );
}

export function OnboardingRouteWrapper() {
  return !features()?.isWkorgInstance ? <Onboarding /> : <PageNotFoundView />;
}
