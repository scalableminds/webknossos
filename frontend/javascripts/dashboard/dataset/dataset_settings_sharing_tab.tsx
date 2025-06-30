import { CopyOutlined, InfoCircleOutlined, RetweetOutlined } from "@ant-design/icons";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import { getDatasetSharingToken, revokeDatasetSharingToken } from "admin/rest_api";
import { Button, Checkbox, Col, Collapse, Form, Input, Row, Space, Switch, Tooltip } from "antd";
import { AsyncButton } from "components/async_clickables";
import { PricingEnforcedBlur } from "components/pricing_enforcers";
import DatasetAccessListView from "dashboard/advanced_dataset/dataset_access_list_view";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import { useEffectOnlyOnce, useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { isUserAdminOrDatasetManager, isUserAdminOrTeamManager } from "libs/utils";
import window from "libs/window";
import { useState } from "react";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { useDatasetSettingsContext } from "./dataset_settings_context";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { SettingsCard } from "admin/account/helpers/settings_card";

export default function DatasetSettingsSharingTab() {
  const { form, datasetId, dataset } = useDatasetSettingsContext();
  const [sharingToken, setSharingToken] = useState("");
  const activeUser = useWkSelector((state) => state.activeUser);
  const isDatasetManagerOrAdmin = isUserAdminOrDatasetManager(activeUser);

  async function fetch() {
    const newSharingToken = await getDatasetSharingToken(datasetId);
    setSharingToken(newSharingToken);
  }

  useEffectOnlyOnce(() => {
    fetch();
  });

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

    const doesNeedToken = !form.getFieldValue(["dataset", "isPublic"]);
    const tokenSuffix = `?token=${sharingToken}`;
    return `${window.location.origin}/datasets/${dataset ? getReadableURLPart(dataset) : datasetId}/view${doesNeedToken ? tokenSuffix : ""}`;
  }

  function getUserAccessList() {
    if (!activeUser || !dataset) return undefined;
    if (!isUserAdminOrTeamManager(activeUser)) return undefined;

    return (
      <Collapse
        collapsible="header"
        ghost
        style={{ padding: 0 }}
        items={[
          {
            key: "1",
            label: "See all users",
            children: <DatasetAccessListView dataset={dataset} />,
          },
        ]}
      />
    );
  }

  const sharingItems = [
    {
      title: "Make dataset publicly accessible",
      explanation:
        "Make your dataset public, for anonymous/unregistered users to access your dataset.",
      value: (
        <Form.Item name={["dataset", "isPublic"]} valuePropName="checked">
          <Switch />
        </Form.Item>
      ),
    },
    {
      title: "Additional team access permissions for this dataset",
      explanation:
        "The dataset can be seen by administrators, dataset managers and by teams that have access to the folder in which the dataset is located. If you want to grant additional teams access, define these teams here.",
      value: (
        <Form.Item name={["dataset", "allowedTeams"]} validateStatus="success">
          <PricingEnforcedBlur requiredPricingPlan={PricingPlanEnum.Team}>
            <TeamSelectionComponent
              mode="multiple"
              allowNonEditableTeams={isDatasetManagerOrAdmin}
            />
          </PricingEnforcedBlur>
        </Form.Item>
      ),
    },
    {
      title: "Sharing Link",
      value: (
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
          {!form.getFieldValue(["dataset", "isPublic"]) && (
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
      ),
      explanation:
        "The sharing link can be used to allow unregistered users to view this dataset. If the dataset itself is not public, the link contains a secret token which ensures that the dataset can be opened if you know the special link.",
    },

    {
      title: "Users with access permission to work with this dataset",
      explanation:
        "Dataset access is based on the specified team permissions and individual user roles. Any changes will only appear after pressing the Save button.",
      value: getUserAccessList(),
    },
  ];

  return form ? (
    <div>
      <SettingsTitle
        title="Sharing & Permissions"
        description="Manage your personal information and preferences"
      />
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        {sharingItems.map((item) => (
          <Col span={12} key={item.title}>
            <SettingsCard
              title={item.title}
              description={item.value}
              explanation={item.explanation}
            />
          </Col>
        ))}
      </Row>
    </div>
  ) : null;
}
