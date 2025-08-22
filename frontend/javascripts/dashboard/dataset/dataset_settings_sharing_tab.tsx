import { RetweetOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { SettingsCard, type SettingsCardProps } from "admin/account/helpers/settings_card";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import { getDatasetSharingToken, revokeDatasetSharingToken } from "admin/rest_api";
import { Col, Collapse, Form, Row, Space, Switch, Tooltip, Typography } from "antd";
import { AsyncButton } from "components/async_clickables";
import { PricingEnforcedBlur } from "components/pricing_enforcers";
import DatasetAccessListView from "dashboard/advanced_dataset/dataset_access_list_view";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import { useWkSelector } from "libs/react_hooks";
import { isUserAdminOrDatasetManager, isUserAdminOrTeamManager } from "libs/utils";
import window from "libs/window";
import { useCallback, useMemo } from "react";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { useDatasetSettingsContext } from "./dataset_settings_context";

export default function DatasetSettingsSharingTab() {
  const { form, datasetId, dataset } = useDatasetSettingsContext();
  const activeUser = useWkSelector((state) => state.activeUser);
  const isDatasetManagerOrAdmin = isUserAdminOrDatasetManager(activeUser);

  const isDatasetPublic = Form.useWatch(["dataset", "isPublic"], form);
  const { data: sharingToken, refetch } = useQuery({
    queryKey: ["datasetSharingToken", datasetId],
    queryFn: () => getDatasetSharingToken(datasetId),
  });

  const handleRevokeSharingLink = useCallback(async () => {
    await revokeDatasetSharingToken(datasetId);
    refetch();
  }, [datasetId, refetch]);

  const sharingLink = useMemo(() => {
    const tokenSuffix = `?token=${sharingToken}`;
    const sharingLink = `${window.location.origin}/datasets/${dataset ? getReadableURLPart(dataset) : datasetId}/view${isDatasetPublic ? "" : tokenSuffix}`;
    return (
      <Typography.Paragraph copyable ellipsis={{ expandable: true }}>
        {sharingLink}
      </Typography.Paragraph>
    );
  }, [dataset, datasetId, isDatasetPublic, sharingToken]);

  const userAccessList = useMemo(() => {
    if (!activeUser || !dataset) return undefined;
    if (!isUserAdminOrTeamManager(activeUser)) return undefined;

    return (
      <Collapse
        collapsible="header"
        ghost
        items={[
          {
            key: "1",
            label: "Show all users",
            children: <DatasetAccessListView dataset={dataset} />,
          },
        ]}
      />
    );
  }, [activeUser, dataset]);

  const sharingItems: SettingsCardProps[] = useMemo(
    () => [
      {
        title: "Make dataset publicly accessible",
        tooltip:
          "Make your dataset public, for anonymous/unregistered users to access your dataset.",
        content: (
          <Form.Item name={["dataset", "isPublic"]} valuePropName="checked">
            <Switch />
          </Form.Item>
        ),
      },
      {
        title: "Additional team access permissions for this dataset",
        tooltip:
          "The dataset can be seen by administrators, dataset managers and by teams that have access to the folder in which the dataset is located. If you want to grant additional teams access, define these teams here.",
        content: (
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
        content: (
          <>
            {sharingLink}
            <Space.Compact>
              {!isDatasetPublic && (
                <Tooltip
                  title={
                    <span>
                      The URL contains a secret token which enables anybody with this link to view
                      the dataset. Renew the token to make the old link invalid.
                    </span>
                  }
                >
                  <AsyncButton onClick={handleRevokeSharingLink} icon={<RetweetOutlined />}>
                    Renew Authorization Token
                  </AsyncButton>
                </Tooltip>
              )}
            </Space.Compact>
          </>
        ),
        tooltip:
          "The sharing link can be used to allow unregistered users to view this dataset. If the dataset itself is not public, the link contains a secret token which ensures that the dataset can be opened if you know the special link.",
      },

      {
        title: "Users with access permission to work with this dataset",
        tooltip:
          "Dataset access is based on the specified team permissions and individual user roles. Any changes will only appear after pressing the Save button.",
        content: userAccessList,
      },
    ],
    [
      sharingLink,
      userAccessList,
      handleRevokeSharingLink,
      isDatasetPublic,
      isDatasetManagerOrAdmin,
    ],
  );

  return (
    <div>
      <SettingsTitle
        title="Sharing & Permissions"
        description="Control who can access and edit this dataset"
      />
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        {sharingItems.map((item) => (
          <Col span={12} key={item.title}>
            <SettingsCard title={item.title} content={item.content} tooltip={item.tooltip} />
          </Col>
        ))}
      </Row>
    </div>
  );
}
