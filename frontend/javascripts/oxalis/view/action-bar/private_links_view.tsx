import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  InfoCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  useIsFetching,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createPrivateLink,
  deletePrivateLink,
  getPrivateLinksByAnnotation,
  updatePrivateLink,
} from "admin/rest_api";
import {
  Button,
  DatePicker,
  type DatePickerProps,
  Dropdown,
  Input,
  type MenuProps,
  Modal,
  Popover,
  Space,
  Spin,
  Table,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/lib/table";
import { AsyncButton, AsyncIconButton } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import dayjs from "dayjs";
import { makeComponentLazy } from "libs/react_helpers";
import Toast from "libs/toast";
import { getDataLayers } from "oxalis/model/accessors/dataset_accessor";
import { getReadableNameByVolumeTracingId } from "oxalis/model/accessors/volumetracing_accessor";
import type { OxalisState } from "oxalis/store";
import { useSelector } from "react-redux";
import type { ZarrPrivateLink } from "types/api_types";

// TODO Remove explicit (error) type declaration when updating to tanstack/query >= 5
// https://github.com/TanStack/query/pull/4706
function useLinksQuery(annotationId: string) {
  return useQuery<ZarrPrivateLink[], Error>(
    ["links", annotationId],
    () => getPrivateLinksByAnnotation(annotationId),
    {
      refetchOnWindowFocus: false,
    },
  );
}

function useCreateLinkMutation(annotationId: string) {
  const queryClient = useQueryClient();
  const mutationKey = ["links", annotationId];

  return useMutation(createPrivateLink, {
    mutationKey,
    onSuccess: (newLink) => {
      queryClient.setQueryData(mutationKey, (oldItems: ZarrPrivateLink[] | undefined) =>
        (oldItems || []).concat([newLink]),
      );
    },
    onError: (err) => {
      Toast.error(`Could not create link. ${err}`);
    },
  });
}

function useUpdatePrivateLink(annotationId: string) {
  const queryClient = useQueryClient();
  const mutationKey = ["links", annotationId];

  return useMutation(updatePrivateLink, {
    mutationKey,
    onMutate: async (updatedLinkItem) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries(mutationKey);

      // Snapshot the previous value
      const previousLink = queryClient.getQueryData(mutationKey);

      // Optimistically update to the new value
      queryClient.setQueryData(mutationKey, (oldItems: ZarrPrivateLink[] | undefined) =>
        (oldItems || []).map((link) => (link.id !== updatedLinkItem.id ? link : updatedLinkItem)),
      );

      // Return a context object with the snapshotted value
      return { previousLink };
    },
    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (_err, _updatedLinkItem, context) => {
      Toast.error("Could not update link.");
      if (context) {
        queryClient.setQueryData(mutationKey, context.previousLink);
      }
    },
  });
}

function useDeleteLinkMutation(annotationId: string) {
  const queryClient = useQueryClient();

  const mutationKey = ["links", annotationId];

  return useMutation(deletePrivateLink, {
    mutationKey,
    onMutate: async (linkIdToDelete) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries(mutationKey);

      // Snapshot the previous value
      const previousLinks = queryClient.getQueryData(mutationKey);

      // Optimistically update to the new value
      queryClient.setQueryData(mutationKey, (oldItems: ZarrPrivateLink[] | undefined) =>
        (oldItems || []).filter((link) => link.id !== linkIdToDelete),
      );

      // Return a context object with the snapshotted value
      return { previousLinks };
    },
    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (err, _linkIdToDelete, context) => {
      Toast.error(`Could not delete link. ${err}`);
      if (context) {
        queryClient.setQueryData(mutationKey, context.previousLinks);
      }
    },
  });
}

export function useZarrLinkMenu(maybeAccessToken: string | null) {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const annotation = useSelector((state: OxalisState) => state.annotation);
  const dataStoreURL = dataset.dataStore.url;
  const dataLayers = getDataLayers(dataset);

  const baseUrl = maybeAccessToken
    ? `${dataStoreURL}/data/annotations/zarr/${maybeAccessToken}`
    : `${dataStoreURL}/data/zarr/${dataset.owningOrganization}/${dataset.directoryName}`;

  const copyTokenToClipboard = async ({ key: layerName }: { key: string }) => {
    await navigator.clipboard.writeText(`${baseUrl}/${layerName}`);
    Toast.success("URL copied to clipboard");
  };

  const copyLayerUrlMenu: MenuProps = {
    // @ts-ignore
    onClick: copyTokenToClipboard,
    items: [
      {
        type: "group",
        label: "Select layer to copy URL",
        children: dataLayers.map((layer) => {
          const readableLayerName =
            "tracingId" in layer && layer.tracingId != null
              ? getReadableNameByVolumeTracingId(annotation, layer.tracingId)
              : layer.name;
          return {
            label: readableLayerName,
            key: readableLayerName,
          };
        }),
      },
    ],
  };

  return { baseUrl, copyLayerUrlMenu };
}

function UrlInput({ linkItem }: { linkItem: ZarrPrivateLink }) {
  const { baseUrl, copyLayerUrlMenu } = useZarrLinkMenu(linkItem.accessToken);

  return (
    <Space.Compact className="no-borders">
      <Input
        value={baseUrl}
        size="small"
        style={{
          width: "90%",
          background: "transparent",
          color: "var(--ant-color-text-secondary)",
        }}
        readOnly
        disabled
      />

      <Dropdown menu={copyLayerUrlMenu}>
        <Button size="small" icon={<CopyOutlined />} style={{ background: "transparent" }} />
      </Dropdown>
    </Space.Compact>
  );
}

function ExpirationDate({ linkItem }: { linkItem: ZarrPrivateLink }) {
  const updateMutation = useUpdatePrivateLink(linkItem.annotation);

  const onChange: DatePickerProps["onChange"] = (date) => {
    updateMutation.mutate({ ...linkItem, expirationDateTime: Number(date?.endOf("day")) });
  };

  const handleExpirationMenuClick = ({
    key,
  }: {
    key: "1 day" | "1 week" | "6 months" | "1 year";
  }) => {
    const expirationDateTime = (() => {
      const endOfToday = dayjs().endOf("day");
      switch (key) {
        case "1 day":
          return endOfToday.add(24, "hours");
        case "1 week":
          return endOfToday.add(1, "week");
        case "6 months":
          return endOfToday.add(6, "months");
        case "1 year":
          return endOfToday.add(1, "year");
        default:
          throw new Error("Unexpected expiration date key");
      }
    })();

    updateMutation.mutate({ ...linkItem, expirationDateTime: Number(expirationDateTime) });
  };
  const expirationMenu: MenuProps = {
    // @ts-ignore
    onClick: handleExpirationMenuClick,
    items: [
      {
        label: "1 day",
        key: "1 day",
      },
      {
        label: "1 week",
        key: "1 week",
      },
      {
        label: "6 months",
        key: "6 months",
      },
      {
        label: "1 year",
        key: "1 year",
      },
    ],
  };

  if (linkItem.expirationDateTime == null) {
    return (
      <Dropdown menu={expirationMenu}>
        <Space style={{ color: "var(--ant-color-text-secondary)" }}>
          Add Expiration Date
          <DownOutlined />
        </Space>
      </Dropdown>
    );
  }

  const maybeWarning =
    Number(new Date()) > linkItem.expirationDateTime ? (
      <Tooltip title="This link has expired">
        <InfoCircleOutlined style={{ color: "var(--ant-color-error)" }} />
      </Tooltip>
    ) : null;

  const expirationDate = dayjs(linkItem.expirationDateTime);
  return (
    <span>
      <FormattedDate timestamp={linkItem.expirationDateTime} />
      <Popover
        content={
          <>
            <div>
              <DatePicker
                onChange={onChange}
                // @ts-ignore
                defaultValue={expirationDate}
                allowClear={false}
              />
            </div>
            <Button
              type="link"
              onClick={() => updateMutation.mutate({ ...linkItem, expirationDateTime: null })}
            >
              Remove expiration date
            </Button>
          </>
        }
        title="Set an expiration date"
        trigger="click"
      >
        <EditOutlined style={{ marginLeft: 4 }} />
        {maybeWarning || <HumanizedDuration expirationDate={expirationDate} />}
      </Popover>
    </span>
  );
}

function HumanizedDuration({ expirationDate }: { expirationDate: dayjs.Dayjs }) {
  const now = dayjs();
  const hourDiff = expirationDate.diff(now, "hours");

  const duration =
    hourDiff < 24
      ? now.to(expirationDate)
      : // Expiration dates usually end at 23:59 UTC. If now == 1 day before the
        // expiration date at 08:00, moment.to() would round the duration and
        // render "2 days" which is confusing if the user selected (in 1 day).
        // Therefore, we pin the time at each date to 23:59 UTC.
        now
          .endOf("day")
          .to(expirationDate.endOf("day"));
  return (
    <span style={{ color: "var(--ant-color-text-secondary)", marginLeft: 4 }}>{duration}</span>
  );
}

function PrivateLinksView({ annotationId }: { annotationId: string }) {
  const { error, data: links, isLoading } = useLinksQuery(annotationId);
  const createLinkMutation = useCreateLinkMutation(annotationId);
  const deleteMutation = useDeleteLinkMutation(annotationId);

  if (error) {
    return <span>Error while loading the private links: {error.message}</span>;
  }

  const columns: ColumnsType<ZarrPrivateLink> = [
    {
      title: "Base URL",
      key: "name",
      render: (_, linkItem) => <UrlInput linkItem={linkItem} />,
      width: "60%",
    },
    {
      title: "Expiration Date",
      key: "name",
      dataIndex: "expirationDateTime",
      render: (_, linkItem) => <ExpirationDate linkItem={linkItem} />,
    },
    {
      title: "",
      key: "action",
      render: (_, linkItem) => (
        <Tooltip title="Delete Link" placement="left">
          <AsyncIconButton
            onClick={() => deleteMutation.mutateAsync(linkItem.id)}
            icon={<DeleteOutlined />}
          />
        </Tooltip>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        Create{" "}
        <a href="https://zarr.dev" target="_blank" rel="noreferrer">
          Zarr
        </a>{" "}
        streaming links to allow other tools to load the image data of this annotation (this does
        not include skeleton data). Note that anyone with these links can access the data,
        regardless of other sharing settings.
      </div>

      {isLoading || links == null ? (
        <div
          style={{
            margin: "40px 0",
            textAlign: "center",
          }}
        >
          <Spin />
        </div>
      ) : (
        <>
          {links.length > 0 && (
            <Table
              rowKey="id"
              columns={columns}
              dataSource={links}
              size="small"
              pagination={false}
            />
          )}

          <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
            <AsyncButton
              type={links.length === 0 ? "primary" : "link"}
              size={links.length === 0 ? "large" : undefined}
              icon={<PlusOutlined />}
              onClick={() => createLinkMutation.mutateAsync(annotationId)}
            >
              Create Zarr Link
            </AsyncButton>
          </div>
        </>
      )}
    </div>
  );
}

export function _PrivateLinksModal({
  isOpen,
  onOk,
  annotationId,
}: {
  isOpen: boolean;
  onOk: () => void;
  annotationId: string;
}) {
  const mutationKey = ["links", annotationId];
  const isFetchingCount = useIsFetching(mutationKey);
  const isMutatingCount = useIsMutating(mutationKey);
  const isBusy = isFetchingCount + isMutatingCount > 0;

  return (
    <Modal
      title="Manage Zarr Links"
      open={isOpen}
      width={800}
      onCancel={onOk}
      onOk={onOk}
      footer={[
        <Button key="ok" type="primary" loading={isBusy} onClick={onOk}>
          OK
        </Button>,
      ]}
    >
      <PrivateLinksView annotationId={annotationId} />
    </Modal>
  );
}

export const PrivateLinksModal = makeComponentLazy(_PrivateLinksModal);
