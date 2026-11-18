import Icon, { PaperClipOutlined } from "@ant-design/icons";
import IconDownsampling from "@images/icons/icon-downsampling.svg?react";
import { useQuery } from "@tanstack/react-query";
import { SettingsCard } from "admin/account/helpers/settings_card";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getDatasetUsedStorageDetails } from "admin/rest_api";
import { Col, Collapse, Row, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import FastTooltip from "components/fast_tooltip";
import { UsedStorageAmount, ZeroStorageReasonList } from "dashboard/storage_info";
import { copyToClipboard } from "libs/clipboard";
import { stringToTagColor } from "libs/colors";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import capitalize from "lodash-es/capitalize";
import sumBy from "lodash-es/sumBy";
import type {
  APIDataLayer,
  APIDataLayerAttachments,
  APIDataset,
  LayerAttachmentType,
} from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { useDatasetSettingsContext } from "./dataset_settings_context";

const { Text } = Typography;

export default function DatasetSettingsStorageTab() {
  const { dataset } = useDatasetSettingsContext();
  if (dataset == null || !dataset.isActive) {
    return null;
  }
  return <DatasetSettingsStorageTabWithDataset dataset={dataset} />;
}

type StorageEntry = {
  key: string;
  name: string;
  type: LayerAttachmentType | "mag";
  path: string | undefined;
  mag: Vector3 | undefined;
  usedStorageBytes: number;
};

const ATTACHMENT_TYPE_BY_KEY: Record<keyof APIDataLayerAttachments, LayerAttachmentType> = {
  meshes: "mesh",
  agglomerates: "agglomerate",
  segmentIndex: "segmentIndex",
  connectomes: "connectome",
  cumsum: "cumsum",
  segmentStatistics: "segmentStatistics",
};

// Mags are named like this in the used storage table, e.g. "2-2-1".
function magToName(mag: Vector3): string {
  return mag.join("-");
}

function getUsedStorageKey(
  layerName: string,
  type: LayerAttachmentType | "mag",
  name: string,
): string {
  return JSON.stringify([layerName, type, name]);
}

function compareMags(a: Vector3, b: Vector3): number {
  const maxDiff = Math.max(...a) - Math.max(...b);
  if (maxDiff !== 0) return maxDiff;
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function compareStorageEntries(a: StorageEntry, b: StorageEntry): number {
  const aIsMag = a.type === "mag";
  const bIsMag = b.type === "mag";
  if (aIsMag !== bIsMag) return aIsMag ? -1 : 1;
  if (a.mag != null && b.mag != null) return compareMags(a.mag, b.mag);
  const typeOrder = a.type.localeCompare(b.type);
  if (typeOrder !== 0) return typeOrder;
  return b.usedStorageBytes - a.usedStorageBytes;
}

// Lists all mags and attachments of the layer. Their used storage is taken from the used
// storage table. Where it has no entry (yet), zero is assumed.
function getStorageEntriesForLayer(
  layer: APIDataLayer,
  usedStorageByKey: Map<string, number>,
): StorageEntry[] {
  const getUsedStorage = (type: LayerAttachmentType | "mag", name: string) =>
    usedStorageByKey.get(getUsedStorageKey(layer.name, type, name)) ?? 0;

  const magEntries: StorageEntry[] = layer.mags.map(({ mag, path }) => {
    const name = magToName(mag);
    return {
      key: getUsedStorageKey(layer.name, "mag", name),
      name,
      type: "mag",
      path,
      mag,
      usedStorageBytes: getUsedStorage("mag", name),
    };
  });

  const attachmentEntries: StorageEntry[] = Object.entries(layer.attachments ?? {}).flatMap(
    ([attachmentKey, attachmentOrAttachments]) => {
      const type = ATTACHMENT_TYPE_BY_KEY[attachmentKey as keyof APIDataLayerAttachments];
      if (type == null || attachmentOrAttachments == null) return [];
      const attachments = Array.isArray(attachmentOrAttachments)
        ? attachmentOrAttachments
        : [attachmentOrAttachments];
      return attachments.map((attachment) => ({
        key: getUsedStorageKey(layer.name, type, attachment.name),
        name: attachment.name,
        type,
        path: attachment.path,
        mag: undefined,
        usedStorageBytes: getUsedStorage(type, attachment.name),
      }));
    },
  );

  return [...magEntries, ...attachmentEntries].sort(compareStorageEntries);
}

const storageColumns: ColumnsType<StorageEntry> = [
  {
    key: "entry",
    render: (_: unknown, record: StorageEntry) => {
      const isMag = record.type === "mag";
      const typeLabel = isMag
        ? "Magnification/Image Data"
        : `${capitalize(record.type)} Attachment`;
      const icon = isMag ? <Icon component={IconDownsampling} /> : <PaperClipOutlined />;
      const { path } = record;
      return (
        <span>
          <FastTooltip title={typeLabel}>{icon}</FastTooltip>{" "}
          {path != null ? (
            <FastTooltip
              dynamicRenderer={() => (
                <div style={{ maxWidth: 600 }}>
                  <code style={{ wordBreak: "break-all" }}>{path}</code>
                  <br />
                  (Click to copy)
                </div>
              )}
            >
              <span onClick={() => copyToClipboard(path, "path")}>{record.name}</span>
            </FastTooltip>
          ) : (
            <FastTooltip title="No explicit path">{record.name}</FastTooltip>
          )}
        </span>
      );
    },
  },
  {
    key: "storage",
    width: 80,
    render: (_: unknown, record: StorageEntry) => (
      <UsedStorageAmount bytes={record.usedStorageBytes} />
    ),
    align: "right" as const,
  },
];

const fixedTableComponents = {
  table: (props: React.HTMLAttributes<HTMLTableElement>) => (
    <table {...props} style={{ ...props.style, tableLayout: "fixed" }} />
  ),
};

function StorageBreakdownCard({ dataset }: { dataset: APIDataset }) {
  const {
    data: storageDetails,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["datasetStorageDetails", dataset.id],
    queryFn: () => getDatasetUsedStorageDetails(dataset.id),
    refetchOnWindowFocus: false,
  });

  const usedStorageByKey = new Map<string, number>();
  for (const entry of storageDetails ?? []) {
    const key = getUsedStorageKey(entry.layerName, entry.attachmentType ?? "mag", entry.name);
    usedStorageByKey.set(key, (usedStorageByKey.get(key) ?? 0) + entry.usedStorageBytes);
  }

  const layers = [...dataset.dataSource.dataLayers].sort((a, b) => a.name.localeCompare(b.name));
  const entriesByLayer = layers.map((layer) => ({
    layer,
    entries: getStorageEntriesForLayer(layer, usedStorageByKey),
  }));

  const collapseItems = entriesByLayer.map(({ layer, entries }) => {
    const layerBytes = sumBy(entries, (e: StorageEntry) => e.usedStorageBytes);
    return {
      key: layer.name,
      label: (
        <span>
          Layer: {layer.name}{" "}
          <Text type="secondary">
            (<UsedStorageAmount bytes={layerBytes} />)
          </Text>
        </span>
      ),
      children: (
        <Table<StorageEntry>
          dataSource={entries}
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
  if (isPending) {
    content = <Spin />;
  } else if (isError) {
    content = <Text type="danger">Could not load the used storage of this dataset.</Text>;
  } else if (layers.length === 0) {
    content = <Text type="secondary">This dataset has no layers.</Text>;
  } else {
    content = <Collapse items={collapseItems} defaultActiveKey={layers.map((l) => l.name)} />;
  }

  const totalBytes = sumBy(entriesByLayer, ({ entries }) =>
    sumBy(entries, (e: StorageEntry) => e.usedStorageBytes),
  );
  const title =
    isPending || isError
      ? "Used Storage"
      : `Used Storage (${formatCountToDataAmountUnit(totalBytes, true)})`;

  return (
    <SettingsCard
      title={title}
      tooltip={
        <>
          Storage used by this dataset within your organization, per mag and attachment. Some
          entries may show zero because:
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
              <Tag color={stringToTagColor(dataset.dataStore.name)} variant="outlined">
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
              <>
                {dataset.creationType != null ? (
                  <Text code>{dataset.creationType}</Text>
                ) : (
                  <Text>(unknown)</Text>
                )}
                {dataset.uploaderFullName != null && (
                  <>
                    <br />
                    <Text type="secondary">Uploaded by {dataset.uploaderFullName}</Text>
                  </>
                )}
              </>
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
                  <Tag color={stringToTagColor(dataset.dataStore.name)} variant="outlined">
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
        <Col span={24}>
          <StorageBreakdownCard dataset={dataset} />
        </Col>
      </Row>
    </div>
  );
};
