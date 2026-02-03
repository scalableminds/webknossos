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

export function OrganizationPlanUpdatesLogView() {
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
      },
      {
        title: "Plan",
        dataIndex: "pricingPlan",
        key: "pricingPlan",
        width: 140,
      },
      {
        title: "Paid Until",
        dataIndex: "paidUntil",
        key: "paidUntil",
        width: 180,
        render: (value: APIOrganizationPricingPlanUpdate["paidUntil"]) =>
          value != null ? <FormattedDate timestamp={value} /> : "N/A",
      },
      {
        title: "Included Users",
        dataIndex: "includedUsers",
        key: "includedUsers",
        width: 140,
        render: (value: APIOrganizationPricingPlanUpdate["includedUsers"]) =>
          Number.isFinite(value) ? value : "∞",
      },
      {
        title: "Included Storage",
        dataIndex: "includedStorageBytes",
        key: "includedStorageBytes",
        width: 160,
        render: (value: APIOrganizationPricingPlanUpdate["includedStorageBytes"]) =>
          Number.isFinite(value) ? formatCountToDataAmountUnit(value, true) : "∞",
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
