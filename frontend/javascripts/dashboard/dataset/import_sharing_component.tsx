import { Button, Input, Checkbox, Tooltip, FormInstance } from "antd";
import React, { useState, useEffect } from "react";
import type { APIDataset, APIDatasetId } from "types/api_flow_types";
import { AsyncButton } from "components/async_clickables";
import {
  getDatasetSharingToken,
  getDataset,
  revokeDatasetSharingToken,
} from "admin/admin_rest_api";
import Toast from "libs/toast";
import features from "features";
import window from "libs/window";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import { CopyOutlined, RetweetOutlined } from "@ant-design/icons";
import { FormItemWithInfo } from "./helper_components";
type Props = {
  form: FormInstance | null;
  datasetId: APIDatasetId;
  hasNoAllowedTeams: boolean;
};
export default function ImportSharingComponent({ form, datasetId, hasNoAllowedTeams }: Props) {
  const [sharingToken, setSharingToken] = useState("");
  const [dataSet, setDataSet] = useState<APIDataset | null | undefined>(null);
  const allowedTeamsComponent = (
    <FormItemWithInfo
      name={["dataset", "allowedTeams"]}
      label="Teams allowed to access this dataset"
      info="Except for administrators and dataset managers, only members of the teams defined here will be able to view this dataset."
      validateStatus={hasNoAllowedTeams ? "warning" : "success"}
      help={
        hasNoAllowedTeams
          ? "If this field is empty, only administrators, dataset managers and users with a valid sharing link (see below) will be able to view this dataset."
          : null
      }
    >
      <TeamSelectionComponent mode="multiple" />
    </FormItemWithInfo>
  );

  async function fetch() {
    const newSharingToken = await getDatasetSharingToken(datasetId);
    const newDataSet = await getDataset(datasetId);
    setSharingToken(newSharingToken);
    setDataSet(newDataSet);
  }

  useEffect(() => {
    fetch();
  }, []);

  function handleSelectCode(event: React.SyntheticEvent): void {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'select' does not exist on type 'EventTar... Remove this comment to see the full error message
    event.target.select();
  }

  async function handleCopySharingLink(): Promise<void> {
    const link = getSharingLink();

    if (!link) {
      return;
    }

    await navigator.clipboard.writeText(link);
    Toast.success("Sharing Link copied to clipboard");
  }

  async function handleRevokeSharingLink(): Promise<void> {
    await revokeDatasetSharingToken(datasetId);
    const newSharingToken = await getDatasetSharingToken(datasetId);
    setSharingToken(newSharingToken);
  }

  async function handleCopyAllowUsageCode(): Promise<void> {
    await navigator.clipboard.writeText(getAllowUsageCode());
    Toast.success("Code copied to clipboard");
  }

  function getSharingLink() {
    if (!form) return undefined;
    const doesNeedToken = !form.getFieldValue("dataset.isPublic");
    const tokenSuffix = `?token=${sharingToken}`;
    return `${window.location.origin}/datasets/${datasetId.owningOrganization}/${
      datasetId.name
    }/view${doesNeedToken ? tokenSuffix : ""}`;
  }

  function getAllowUsageCode() {
    if (dataSet != null) {
      const dataStoreName = dataSet.dataStore.name;
      const dataStoreURL = dataSet.dataStore.url;
      return `${dataStoreName}, ${dataStoreURL}, ${datasetId.name}`;
    } else return "";
  }

  return form ? (
    <div>
      <FormItemWithInfo
        name={["dataset", "isPublic"]}
        label="Visibility"
        info="Make your dataset public, for anonymous/unregistered users to access your dataset."
        valuePropName="checked"
      >
        <Checkbox>Make dataset publicly accessible </Checkbox>
      </FormItemWithInfo>
      {allowedTeamsComponent}
      <FormItemWithInfo
        label="Sharing Link"
        info={
          <span>
            The sharing link can be used to allow unregistered users to view this dataset. If the
            dataset itself is not public, the link contains a secret token which ensures that the
            dataset can be opened if you know the special link.
          </span>
        }
      >
        <Input.Group compact>
          <Input
            value={getSharingLink()}
            onClick={handleSelectCode}
            style={{
              width: "80%",
            }}
            readOnly
          />
          <Button
            onClick={handleCopySharingLink}
            style={{
              width: "10%",
            }}
            icon={<CopyOutlined />}
          >
            Copy
          </Button>
          {!form.getFieldValue("dataset.isPublic") && (
            <Tooltip
              title={
                <span>
                  The URL contains a secret token which enables anybody with this link to view the
                  dataset. Renew the token to make the old link invalid.
                </span>
              }
            >
              <AsyncButton
                onClick={handleRevokeSharingLink}
                style={{
                  width: "10%",
                }}
                icon={<RetweetOutlined />}
              >
                Renew
              </AsyncButton>
            </Tooltip>
          )}
        </Input.Group>
      </FormItemWithInfo>
      {form.getFieldValue("dataset.isPublic") && features().addForeignDataset && (
        <FormItemWithInfo
          label="Code for adding this dataset to other webKnossos instances"
          info="Give this code to users with other webKnossos instances in order to add this dataset."
        >
          <Input.Group compact>
            <Input
              value={getAllowUsageCode()}
              onClick={handleSelectCode}
              style={{
                width: "80%",
              }}
              readOnly
            />
            <Button
              onClick={handleCopyAllowUsageCode}
              style={{
                width: "10%",
              }}
              icon={<CopyOutlined />}
            >
              Copy
            </Button>
          </Input.Group>
        </FormItemWithInfo>
      )}
    </div>
  ) : null;
}
