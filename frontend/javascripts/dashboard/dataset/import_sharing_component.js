// @flow

import { Button, Input, Checkbox, Tooltip } from "antd";
import Clipboard from "clipboard-js";
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
  form: Object,
  datasetId: APIDatasetId,
  hasNoAllowedTeams: boolean,
};

export default function ImportSharingComponent({ form, datasetId, hasNoAllowedTeams }: Props) {
  const { getFieldDecorator } = form;
  const [sharingToken, setSharingToken] = useState("");
  const [dataSet, setDataSet] = useState<?APIDataset>(null);
  const allowedTeamsComponent = (
    <FormItemWithInfo
      label="Teams allowed to access this dataset"
      info="Except for administrators and dataset managers, only members of the teams defined here will be able to view this dataset."
      validateStatus={hasNoAllowedTeams ? "warning" : "success"}
      help={
        hasNoAllowedTeams
          ? "If this field is empty, only administrators and dataset managers will be able to view this dataset."
          : null
      }
    >
      {getFieldDecorator("dataset.allowedTeams", {})(<TeamSelectionComponent mode="multiple" />)}
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

  function handleSelectCode(event: SyntheticInputEvent<>): void {
    event.target.select();
  }

  async function handleCopySharingLink(): Promise<void> {
    await Clipboard.copy(getSharingLink());
    Toast.success("Sharing Link copied to clipboard");
  }

  async function handleRevokeSharingLink(): Promise<void> {
    await revokeDatasetSharingToken(datasetId);
    const newSharingToken = await getDatasetSharingToken(datasetId);
    setSharingToken(newSharingToken);
  }

  async function handleCopyAllowUsageCode(): Promise<void> {
    await Clipboard.copy(getAllowUsageCode());
    Toast.success("Code copied to clipboard");
  }

  function getSharingLink() {
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

  return (
    <div>
      <FormItemWithInfo
        label="Visibility"
        info="Make your dataset public, for anonymous/unregistered users to access your dataset."
      >
        {getFieldDecorator("dataset.isPublic", { valuePropName: "checked" })(
          <Checkbox>Make dataset publicly accessible </Checkbox>,
        )}
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
            style={{ width: "80%" }}
            readOnly
          />
          <Button onClick={handleCopySharingLink} style={{ width: "10%" }} icon={<CopyOutlined />}>
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
                style={{ width: "10%" }}
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
              style={{ width: "80%" }}
              readOnly
            />
            <Button
              onClick={handleCopyAllowUsageCode}
              style={{ width: "10%" }}
              icon={<CopyOutlined />}
            >
              Copy
            </Button>
          </Input.Group>
        </FormItemWithInfo>
      )}
    </div>
  );
}
