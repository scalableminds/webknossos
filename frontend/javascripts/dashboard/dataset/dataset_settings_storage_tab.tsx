import Icon, { PaperClipOutlined } from "@ant-design/icons";
import IconDownsampling from "@images/icons/icon-downsampling.svg?react";
import { useQuery } from "@tanstack/react-query";
import { SettingsCard } from "admin/account/helpers/settings_card";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getDatasetUsedStorageDetails } from "admin/rest_api";
import { Col, Collapse, Row, Spin, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { formatCountToDataAmountUnit, stringToColor } from "libs/format_utils";
import groupBy from "lodash-es/groupBy";
import sumBy from "lodash-es/sumBy";
import type { APIDataset, APIStorageDetailEntry } from "types/api_types";
import { useDatasetSettingsContext } from "./dataset_settings_context";

const { Text } = Typography;

export default function DatasetSettingsStorageTab() {
  const { dataset } = useDatasetSettingsContext();
  if (dataset == null) {
    return null;
  }
  return <DatasetSettingsStorageTabWithDataset dataset={dataset} />;
}

type StorageEntry = {
  key: string;
  name: string;
  type: string;
  usedStorageBytes: number;
};

const storageColumns: ColumnsType<StorageEntry> = [
  {
    key: "entry",
    onCell: () => ({ style: { wordBreak: "break-word" } }),
    render: (_: unknown, record: StorageEntry) => {
      const isMag = record.type === "mag";
      const tooltipTitle = isMag
        ? "Magnification/Image Data"
        : `${record.type.charAt(0).toUpperCase()}${record.type.slice(1)} Attachment`;
      const icon = isMag ? <Icon component={IconDownsampling} /> : <PaperClipOutlined />;
      return (
        <span>
          <Tooltip title={tooltipTitle}>{icon}</Tooltip> {record.name}
        </span>
      );
    },
  },
  {
    key: "storage",
    width: 80,
    render: (_: unknown, record: StorageEntry) =>
      formatCountToDataAmountUnit(record.usedStorageBytes, true),
    align: "right" as const,
  },
];

const fixedTableComponents = {
  table: (props: React.HTMLAttributes<HTMLTableElement>) => (
    <table {...props} style={{ ...props.style, tableLayout: "fixed" }} />
  ),
};

function StorageBreakdownCard({ datasetId }: { datasetId: string }) {
  const { data: storageDetails, isLoading } = useQuery({
    queryKey: ["datasetStorageDetails", datasetId],
    queryFn: () => getDatasetUsedStorageDetails(datasetId),
    refetchOnWindowFocus: false,
  });

  const layerGroups = groupBy(storageDetails ?? [], (e: APIStorageDetailEntry) => e.layerName);
  const sortedLayerNames = Object.keys(layerGroups).sort();

  const collapseItems = sortedLayerNames.map((layerName) => {
    const entries = layerGroups[layerName];
    const sortedEntries = [...entries].sort((a, b) => {
      const aIsMag = !a.attachmentType;
      const bIsMag = !b.attachmentType;
      if (aIsMag !== bIsMag) return aIsMag ? -1 : 1;
      if (aIsMag) return b.usedStorageBytes - a.usedStorageBytes;
      const typeOrder = (a.attachmentType ?? "").localeCompare(b.attachmentType ?? "");
      if (typeOrder !== 0) return typeOrder;
      return b.usedStorageBytes - a.usedStorageBytes;
    });
    const totalBytes = sumBy(entries, (e: APIStorageDetailEntry) => e.usedStorageBytes);
    const tableData: StorageEntry[] = sortedEntries.map((e, i) => ({
      key: `${e.name}-${e.attachmentType ?? ""}-${i}`,
      name: e.name,
      type: e.attachmentType ?? "mag",
      usedStorageBytes: e.usedStorageBytes,
    }));
    return {
      key: layerName,
      label: (
        <span>
          Layer: {layerName}{" "}
          <Text type="secondary">({formatCountToDataAmountUnit(totalBytes, true)})</Text>
        </span>
      ),
      children: (
        <Table<StorageEntry>
          dataSource={tableData}
          columns={storageColumns}
          components={fixedTableComponents}
          pagination={false}
          size="small"
          showHeader={false}
        />
      ),
    };
  });

  let content: React.ReactNode;
  if (isLoading) {
    content = <Spin />;
  } else if (sortedLayerNames.length === 0) {
    content = <Text type="secondary">No storage data available yet.</Text>;
  } else {
    content = <Collapse items={collapseItems} defaultActiveKey={sortedLayerNames} />;
  }

  const totalBytes = sumBy(storageDetails ?? [], (e: APIStorageDetailEntry) => e.usedStorageBytes);
  const title =
    storageDetails != null && storageDetails.length > 0
      ? `Used Storage (${formatCountToDataAmountUnit(totalBytes, true)})`
      : "Used Storage";

  return (
    <SettingsCard title={title} tooltip="TODO" content={content} style={{ minHeight: undefined }} />
  );
}

const DatasetSettingsStorageTabWithDataset = ({ dataset }: { dataset: APIDataset }) => {
  return (
    <div>
      <SettingsTitle
        title="Storage Details"
        description="Technical storage information for this dataset"
      />
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <SettingsCard
            title="Data Store Server"
            tooltip="TODO"
            style={{ height: "100%" }}
            content={
              <Tag color={stringToColor(dataset.dataStore.name)} variant="outlined">
                {dataset.dataStore.name}
              </Tag>
            }
          />
        </Col>
        <Col span={8}>
          <SettingsCard
            title="Directory Name"
            tooltip="TODO"
            style={{ height: "100%" }}
            content={
              <>
                <Text code copyable>
                  {dataset.directoryName}
                </Text>
                <br />
                <Text type="secondary">
                  {dataset.directoryName === dataset.name
                    ? "(same as name)"
                    : "(differing from name)"}
                </Text>
              </>
            }
          />
        </Col>
        <Col span={8}>
          <SettingsCard
            title="Creation Type"
            tooltip="TODO"
            style={{ height: "100%" }}
            content={
              dataset.creationType != null ? (
                <Text code>{dataset.creationType}</Text>
              ) : (
                <Text>(unknown)</Text>
              )
            }
          />
        </Col>
        <Col span={24}>
          <SettingsCard
            title="Dataset Structure Source"
            tooltip="TODO"
            content={
              dataset.isVirtual ? (
                <Text>WEBKNOSSOS database</Text>
              ) : (
                <>
                  <Text code copyable>
                    {dataset.datasourcePropertiesPath ?? "datasource-properties.json"}
                  </Text>
                  {" on data store server "}
                  <Tag color={stringToColor(dataset.dataStore.name)} variant="outlined">
                    {dataset.dataStore.name}
                  </Tag>
                </>
              )
            }
          />
        </Col>
        {dataset.mirrorPath != null && (
          <Col span={24}>
            <SettingsCard
              title="Read-Only Dataset Mirror"
              tooltip="TODO"
              content={
                <Text code copyable>
                  {dataset.mirrorPath}
                </Text>
              }
            />
          </Col>
        )}
        {dataset.usedStorageBytes != null && dataset.usedStorageBytes > 0 && (
          <Col span={24}>
            <StorageBreakdownCard datasetId={dataset.id} />
          </Col>
        )}
      </Row>
    </div>
  );
};
