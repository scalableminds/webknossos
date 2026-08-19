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
  getBuildInfo,
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
  Typography,
} from "antd";
import type { ColumnsType } from "antd/lib/table";
import { AsyncButton, AsyncIconButton } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import dayjs from "dayjs";
import { copyToClipboard } from "libs/clipboard";
import { makeComponentLazy } from "libs/react_helpers";
import { useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import type { ZarrPrivateLink } from "types/api_types";
import { getDataLayers } from "viewer/model/accessors/dataset_accessor";
import { getReadableNameByVolumeTracingId } from "viewer/model/accessors/volumetracing_accessor";

function useLinksQuery(annotationId: string) {
  return useQuery({
    queryKey: ["links", annotationId],
    queryFn: () => getPrivateLinksByAnnotation(annotationId),
    refetchOnWindowFocus: false,
  });
}

function useCreateLinkMutation(annotationId: string) {
  const queryClient = useQueryClient();
  const mutationKey = ["links", annotationId];

  return useMutation({
    mutationFn: createPrivateLink,
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

  return useMutation({
    mutationFn: updatePrivateLink,
    mutationKey,
    onMutate: async (updatedLinkItem) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({
        queryKey: mutationKey,
      });

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

  return useMutation({
    mutationFn: deletePrivateLink,
    mutationKey,
    onMutate: async (linkIdToDelete) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({
        queryKey: mutationKey,
      });

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
  const dataset = useWkSelector((state) => state.dataset);
  const annotation = useWkSelector((state) => state.annotation);
  const dataStoreURL = dataset.dataStore.url;
  const dataLayers = getDataLayers(dataset);

  // The zarr links are versioned (e.g. /data/v15/zarr/...) so that they keep working
  // against a future datastore even if it drops support for older, unversioned
  // requests. Fetch the currently supported API version from the webknossos backend's
  // build info (cached indefinitely, since it only changes when the server is upgraded).
  const buildInfoQuery = useQueryWithErrorHandling(
    {
      queryKey: ["buildInfo"],
      queryFn: getBuildInfo,
      staleTime: Number.POSITIVE_INFINITY,
    },
    "Could not fetch the server's build information.",
  );
  const apiVersion = buildInfoQuery.data?.httpApiVersioning.currentApiVersion;

  const baseUrl =
    apiVersion == null
      ? null
      : maybeAccessToken
        ? `${dataStoreURL}/data/v${apiVersion}/annotations/zarr/${maybeAccessToken}`
        : `${dataStoreURL}/data/v${apiVersion}/zarr/${dataset.id}`;

  const copyTokenToClipboard = ({ key: layerName }: { key: string }) => {
    if (baseUrl == null) {
      return;
    }
    copyToClipboard(`${baseUrl}/${layerName}`, "URL");
  };

  const copyLayerUrlMenu: MenuProps = {
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

  return { baseUrl: baseUrl ?? "", copyLayerUrlMenu, isLoading: baseUrl == null };
}

function UrlInput({ linkItem }: { linkItem: ZarrPrivateLink }) {
  const { baseUrl, copyLayerUrlMenu, isLoading } = useZarrLinkMenu(linkItem.accessToken);

  return (
    <Space.Compact className="no-borders" block>
      <Input
        value={isLoading ? "Loading…" : baseUrl}
        size="small"
        style={{
          width: "90%",
          background: "transparent",
          color: "var(--ant-color-text-secondary)",
        }}
        readOnly
        disabled
      />

      <Dropdown menu={copyLayerUrlMenu} disabled={isLoading}>
        <Button
          size="small"
          icon={<CopyOutlined />}
          style={{ background: "transparent" }}
          disabled={isLoading}
        />
      </Dropdown>
    </Space.Compact>
  );
}

function ExpirationDate({ linkItem }: { linkItem: ZarrPrivateLink }) {
  const updateMutation = useUpdatePrivateLink(linkItem.annotation);

  const onChange: DatePickerProps["onChange"] = (date) => {
    if (Array.isArray(date)) {
      return;
    }
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
    // @ts-expect-error
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
    Date.now() > linkItem.expirationDateTime ? (
      <Tooltip title="This link has expired">
        <Typography.Text type="danger">
          <InfoCircleOutlined />
        </Typography.Text>
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
              <DatePicker onChange={onChange} defaultValue={expirationDate} allowClear={false} />
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
        <Space size="small">
          <EditOutlined style={{ marginLeft: 4 }} />
          {maybeWarning || <HumanizedDuration expirationDate={expirationDate} />}
        </Space>
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
  const { error, data: links, isPending } = useLinksQuery(annotationId);
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

      {isPending || links == null ? (
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

function _PrivateLinksModal({
  isOpen,
  onOk,
  annotationId,
}: {
  isOpen: boolean;
  onOk: () => void;
  annotationId: string;
}) {
  const mutationKey = ["links", annotationId];
  const isFetchingCount = useIsFetching({
    queryKey: mutationKey,
  });
  const isMutatingCount = useIsMutating({
    mutationKey: mutationKey,
  });
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
