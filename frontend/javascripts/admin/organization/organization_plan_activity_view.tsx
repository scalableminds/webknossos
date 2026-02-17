import { useQuery } from "@tanstack/react-query";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getPricingPlanUpdates } from "admin/api/organization";
import { Table, Typography } from "antd";
import type { ColumnsType } from "antd/lib/table";
import FormattedDate from "components/formatted_date";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import type { APIOrganizationPricingPlanUpdate } from "types/api_types";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";

const { Text } = Typography;
const UNCHANGED_LABEL = <Text type="secondary">Unchanged</Text>;
const CLEARED_LABEL = <Text type="secondary">Cleared</Text>;
const EMPTY_LABEL = <Text type="secondary">—</Text>;

export function OrganizationPlanActivityView() {
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const { data: planUpdates, isFetching } = useQuery({
    queryKey: ["organizationPricingPlanUpdates", organization.id],
    queryFn: async () => {
      const updates = await getPricingPlanUpdates();
      return updates.filter((update) => update.organizationId === organization.id);
    },
  });

  const tableData = useMemo(
    () => [...(planUpdates || [])].sort((first, second) => second.created - first.created),
    [planUpdates],
  );

  const columns = useMemo<ColumnsType<APIOrganizationPricingPlanUpdate>>(
    () => [
      {
        title: "Changed",
        dataIndex: "created",
        key: "created",
        width: 180,
        render: (value: APIOrganizationPricingPlanUpdate["created"]) => (
          <FormattedDate timestamp={value} />
        ),
        sorter: (first, second) => first.created - second.created,
        defaultSortOrder: "descend",
      },
      {
        title: "Description",
        dataIndex: "description",
        key: "description",
        render: (value: APIOrganizationPricingPlanUpdate["description"]) => value || EMPTY_LABEL,
      },
      {
        title: "Plan",
        dataIndex: "pricingPlan",
        key: "pricingPlan",
        width: 140,
        render: (value: APIOrganizationPricingPlanUpdate["pricingPlan"]) =>
          value ?? UNCHANGED_LABEL,
      },
      {
        title: "Paid Until",
        dataIndex: "paidUntil",
        key: "paidUntil",
        width: 140,
        render: (value: APIOrganizationPricingPlanUpdate["paidUntil"]) => {
          if (value === undefined) {
            return UNCHANGED_LABEL;
          }
          if (value === null) {
            return CLEARED_LABEL;
          }
          return <FormattedDate dateOnly timestamp={value} />;
        },
      },
      {
        title: "Included Users",
        dataIndex: "includedUsers",
        key: "includedUsers",
        width: 140,
        render: (value: APIOrganizationPricingPlanUpdate["includedUsers"]) => {
          if (value === undefined) {
            return UNCHANGED_LABEL;
          }
          if (value === null) {
            return CLEARED_LABEL;
          }
          return Number.isFinite(value) ? value : "∞";
        },
      },
      {
        title: "Included Storage",
        dataIndex: "includedStorageBytes",
        key: "includedStorageBytes",
        width: 160,
        render: (value: APIOrganizationPricingPlanUpdate["includedStorageBytes"]) => {
          if (value === undefined) {
            return UNCHANGED_LABEL;
          }
          if (value === null) {
            return CLEARED_LABEL;
          }
          return Number.isFinite(value) ? formatCountToDataAmountUnit(value, true) : "∞";
        },
      },
      {
        title: "AI Plan",
        dataIndex: "aiPlan",
        key: "aiPlan",
        width: 140,
        render: (value: APIOrganizationPricingPlanUpdate["aiPlan"]) => value ?? UNCHANGED_LABEL,
      },
    ],
    [],
  );

  return (
    <>
      <SettingsTitle
        title="Plan Updates"
        description="Track recent changes to your organization's subscription."
      />
      <Table<APIOrganizationPricingPlanUpdate>
        rowKey={(update) => `${update.organizationId}-${update.created}-${update.pricingPlan}`}
        loading={isFetching}
        dataSource={tableData}
        columns={columns}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{
          emptyText: <Text type="secondary">No recent subscription changes found.</Text>,
        }}
      />
    </>
  );
}
