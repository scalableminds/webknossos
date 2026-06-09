import Icon, { PaperClipOutlined } from "@ant-design/icons";
import IconDownsampling from "@images/icons/icon-downsampling.svg?react";
import { useQuery } from "@tanstack/react-query";
import { SettingsCard } from "admin/account/helpers/settings_card";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getDatasetUsedStorageDetails } from "admin/rest_api";
import { Col, Collapse, Row, Spin, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import FastTooltip from "components/fast_tooltip";
import { ZeroStorageReasonList } from "dashboard/storage_info";
import { formatCountToDataAmountUnit, stringToColor } from "libs/format_utils";
import capitalize from "lodash-es/capitalize";
import groupBy from "lodash-es/groupBy";
import sumBy from "lodash-es/sumBy";
import type { APIDataset, APIStorageDetailEntry, LayerAttachmentType } from "types/api_types";
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
  type: LayerAttachmentType | "mag";
  usedStorageBytes: number;
};

const storageColumns: ColumnsType<StorageEntry> = [
  {
    key: "entry",
    render: (_: unknown, record: StorageEntry) => {
      const isMag = record.type === "mag";
      const tooltipTitle = isMag
        ? "Magnification/Image Data"
        : `${capitalize(record.type)} Attachment`;
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
    render: (_: unknown, record: StorageEntry) => (
      <FastTooltip title={`${new Intl.NumberFormat().format(record.usedStorageBytes)} bytes`}>
        {formatCountToDataAmountUnit(record.usedStorageBytes, true)}
      </FastTooltip>
    ),
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
    // Sort by type (mag vs attachment) first, then by attachment type, then by usedStorageBytes
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
    <SettingsCard
      title={title}
      tooltip={
        <>
          Storage used by this dataset within your organization. Parts of the dataset may not count
          to your used storage, and be skipped here because:
          {ZeroStorageReasonList}
        </>
      }
      content={content}
      style={{ minHeight: undefined }}
    />
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
            tooltip="When browsing this dataset, requests go via this server."
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
            tooltip="A unique name for the dataset within this organization. Stays fixed even when editing the displayed name. In case the dataset is disk-based, this name is used for its directory."
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
            tooltip="How this dataset was imported to WEBKNOSSOS"
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
            tooltip="The dataset structure is defined either in a file on disk (“disk-based datasets”) or in the WEBKNOSSOS database (“virtual datasets”). Note that the actual image data for virtual datasets may still be stored on disk."
            content={
              dataset.isVirtual ? (
                <Text>WEBKNOSSOS database</Text>
              ) : (
                <>
                  <Text code>datasource-properties.json</Text>
                  {" file "}
                  {dataset.rootPath != null && (
                    <>
                      {"in"}
                      <br />
                      <Text code copyable>
                        {dataset.rootPath}
                      </Text>
                      {dataset.rootRealPath != null && dataset.rootRealPath !== dataset.rootPath ? (
                        <>
                          <br />
                          {" (realpath "}
                          <Text code copyable>
                            {dataset.rootRealPath}
                          </Text>
                          {")"}
                          <br />
                        </>
                      ) : (
                        <br />
                      )}
                    </>
                  )}
                  {"on data store server "}
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
              tooltip="This dataset is not disk-based but a symlink-based mirror has been written to disk for backwards compatibility at the specified path. Note that this mirror is read-only and changes do not propagate back to WEBKNOSSOS."
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
