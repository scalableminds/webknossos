import { getDatasetIdFromNameAndOrganization, getOrganizationForDataset } from "admin/api/disambiguate_legacy_routes";
import AsyncRedirect from "components/redirect";
import { coalesce, getUrlParamsObjectFromString } from "libs/utils";
import { useParams } from "react-router-dom";
import { APICompoundTypeEnum, TracingTypeEnum } from "types/api_types";
import { ControlModeEnum } from "viewer/constants";
import { getDatasetIdOrNameFromReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import TracingLayoutView from "viewer/view/layouting/tracing_layout_view";


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

  const tracingType = coalesce(TracingTypeEnum, type);
  if (tracingType == null) {
    return <h3>Invalid annotation URL.</h3>;
  }
  const getParams = getUrlParamsObjectFromString(location.search);
  return (
    <AsyncRedirect
      redirectTo={async () => {
        const datasetId = await getDatasetIdFromNameAndOrganization(
          datasetName,
          organizationId,
          getParams.token,
        );
        return `/datasets/${datasetName}-${datasetId}/sandbox/:${tracingType}${location.search}${location.hash}`;
      }}
    />
  );
}

export function TracingSandboxRouteWrapper() {
  const { type, datasetNameAndId =""} = useParams();
  const tracingType = coalesce(TracingTypeEnum, type);
  const { datasetId, datasetName } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);
  const getParams = getUrlParamsObjectFromString(location.search);

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
  const getParams = getUrlParamsObjectFromString(location.search);
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

export function TracingViewModeRouteWrapper () {
  const { datasetNameAndId = "" } = useParams();
  const { datasetId, datasetName } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);
  const getParams = getUrlParamsObjectFromString(location.search);
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
};