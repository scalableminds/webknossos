import { CopyOutlined, InfoCircleOutlined, RetweetOutlined } from "@ant-design/icons";
import { getDatasetSharingToken, revokeDatasetSharingToken } from "admin/admin_rest_api";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import { Button, Checkbox, Collapse, type FormInstance, Input, Space, Tooltip } from "antd";
import { AsyncButton } from "components/async_clickables";
import { PricingEnforcedBlur } from "components/pricing_enforcers";
import DatasetAccessListView from "dashboard/advanced_dataset/dataset_access_list_view";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import Toast from "libs/toast";
import { isUserAdminOrDatasetManager, isUserAdminOrTeamManager } from "libs/utils";
import window from "libs/window";
import { getReadableURLPart } from "oxalis/model/accessors/dataset_accessor";
import type { OxalisState } from "oxalis/store";
import type React from "react";
import { useEffect, useState } from "react";
import { connect } from "react-redux";
import { type RouteComponentProps, withRouter } from "react-router-dom";
import type { APIDataset, APIUser } from "types/api_types";
import { FormItemWithInfo } from "./helper_components";

type Props = {
  form: FormInstance | null;
  datasetId: string;
  dataset: APIDataset | null | undefined;
  activeUser: APIUser | null | undefined;
};

function DatasetSettingsSharingTab({ form, datasetId, dataset, activeUser }: Props) {
  const [sharingToken, setSharingToken] = useState("");
  const isDatasetManagerOrAdmin = isUserAdminOrDatasetManager(activeUser);

  const allowedTeamsComponent = (
    <FormItemWithInfo
      name={["dataset", "allowedTeams"]}
      label="Additional team access permissions for this dataset"
      info="The dataset can be seen by administrators, dataset managers and by teams that have access to the folder in which the dataset is located. If you want to grant additional teams access, define these teams here."
      validateStatus="success"
    >
      <PricingEnforcedBlur requiredPricingPlan={PricingPlanEnum.Team}>
        <TeamSelectionComponent mode="multiple" allowNonEditableTeams={isDatasetManagerOrAdmin} />
      </PricingEnforcedBlur>
    </FormItemWithInfo>
  );

  async function fetch() {
    const newSharingToken = await getDatasetSharingToken(datasetId);
    setSharingToken(newSharingToken);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies(fetch):
  useEffect(() => {
    fetch();
  }, []);

  function handleSelectCode(event: React.MouseEvent<HTMLInputElement>): void {
    event.currentTarget.select();
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

  function getSharingLink() {
    if (!form) return undefined;

    const doesNeedToken = !form.getFieldValue("dataset.isPublic");
    const tokenSuffix = `?token=${sharingToken}`;
    return `${window.location.origin}/datasets/${dataset ? getReadableURLPart(dataset) : datasetId}/view${doesNeedToken ? tokenSuffix : ""}`;
  }

  function getUserAccessList() {
    if (!activeUser || !dataset) return undefined;
    if (!isUserAdminOrTeamManager(activeUser)) return undefined;

    const panelLabel = (
      <span>
        All users with access permission to work with this dataset{" "}
        <Tooltip title="Based on the specified team permissions and individual user roles. Any changes will only appear after pressing the Save button.">
          <InfoCircleOutlined style={{ color: "gray" }} />
        </Tooltip>
      </span>
    );

    return (
      <Collapse
        collapsible="header"
        items={[
          {
            label: panelLabel,
            key: "1",
            children: <DatasetAccessListView dataset={dataset} />,
          },
        ]}
      />
    );
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
        <Space.Compact>
          <Input
            value={getSharingLink()}
            onClick={handleSelectCode}
            style={{
              width: "80%",
            }}
            readOnly
          />
          <Button onClick={handleCopySharingLink} icon={<CopyOutlined />}>
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
              <AsyncButton onClick={handleRevokeSharingLink} icon={<RetweetOutlined />}>
                Renew
              </AsyncButton>
            </Tooltip>
          )}
        </Space.Compact>
      </FormItemWithInfo>
      {getUserAccessList()}
    </div>
  ) : null;
}

const mapStateToProps = (state: OxalisState) => ({
  activeUser: state.activeUser,
});

const connector = connect(mapStateToProps);
export default connector(withRouter<RouteComponentProps & Props, any>(DatasetSettingsSharingTab));
