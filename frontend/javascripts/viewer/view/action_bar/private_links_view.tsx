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
  Collapse,
  type CollapseProps,
  DatePicker,
  type DatePickerProps,
  Dropdown,
  Flex,
  Input,
  type MenuProps,
  Modal,
  Popover,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import { AsyncButton } from "components/async_clickables";
import FormattedDate, { formatDateInLocalTimeZone } from "components/formatted_date";
import dayjs from "dayjs";
import { copyToClipboard } from "libs/clipboard";
import { makeComponentLazy } from "libs/react_helpers";
import { useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import messages from "messages";
import { useState } from "react";
import { ModalWidth } from "theme";
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

type ZarrLinkRow = {
  key: string;
  label: string;
  url: string;
  isWkOnly: boolean;
};

function useZarrLinks(maybeAccessToken: string | null) {
  const dataset = useWkSelector((state) => state.dataset);
  const annotation = useWkSelector((state) => state.annotation);
  const dataStoreURL = dataset.dataStore.url;
  const dataLayers = getDataLayers(dataset);

  const buildInfoQuery = useQueryWithErrorHandling(
    {
      queryKey: ["buildInfo"],
      queryFn: getBuildInfo,
      refetchOnMount: "always",
    },
    "Could not fetch the server's build information.",
  );
  const apiVersion = buildInfoQuery.data?.httpApiVersioning.currentApiVersion;

  const baseUrl =
    apiVersion == null
      ? null
      : maybeAccessToken
        ? `${dataStoreURL}/data/v${apiVersion}/annotations/zarr3/${maybeAccessToken}`
        : `${dataStoreURL}/data/v${apiVersion}/zarr3/${dataset.id}`;

  const isLoading = buildInfoQuery.isLoading;
  const isUnavailable = !isLoading && baseUrl == null;

  const layerRows: ZarrLinkRow[] = dataLayers.map((layer) => {
    const readableLayerName =
      "tracingId" in layer && layer.tracingId != null
        ? getReadableNameByVolumeTracingId(annotation, layer.tracingId)
        : layer.name;
    return {
      key: readableLayerName,
      label: readableLayerName,
      url: baseUrl == null ? "" : `${baseUrl}/${readableLayerName}`,
      isWkOnly: false,
    };
  });
  // The base URL itself references the whole dataset, which only WEBKNOSSOS can import.
  const allLayersRow: ZarrLinkRow = {
    key: "__all-layers__",
    label: "All layers",
    url: baseUrl ?? "",
    isWkOnly: true,
  };

  return {
    rows: [...layerRows, allLayersRow],
    isLoading,
    isUnavailable,
    error: buildInfoQuery.error,
  };
}

function ZarrLinkUrlRow({
  row,
  isLoading,
  isUnavailable,
}: {
  row: ZarrLinkRow;
  isLoading: boolean;
  isUnavailable: boolean;
}) {
  const { token } = theme.useToken();
  const isDisabled = isLoading || isUnavailable;

  return (
    <Flex vertical gap={token.marginXXS}>
      <Space size="small">
        <Typography.Text strong>{row.label}</Typography.Text>
        {row.isWkOnly && <Tag>WEBKNOSSOS only</Tag>}
      </Space>
      <Space.Compact block>
        <Input
          value={isLoading ? "Loading…" : isUnavailable ? "Unavailable" : row.url}
          style={{ fontFamily: token.fontFamilyCode, fontSize: token.fontSizeSM }}
          onFocus={(event) => event.target.select()}
          readOnly
        />
        <Button
          icon={<CopyOutlined />}
          disabled={isDisabled}
          onClick={() => {
            // Focusing the input selects its URL, which copyToClipboard would otherwise treat as
            // an ongoing text selection and skip copying.
            window.getSelection()?.removeAllRanges();
            copyToClipboard(row.url, "URL");
          }}
        >
          Copy
        </Button>
      </Space.Compact>
    </Flex>
  );
}

export function ZarrLinkUrlRows({ maybeAccessToken }: { maybeAccessToken: string | null }) {
  const { token } = theme.useToken();
  const { rows, isLoading, isUnavailable } = useZarrLinks(maybeAccessToken);

  return (
    <Flex vertical gap={token.marginSM}>
      {rows.map((row) => (
        <ZarrLinkUrlRow
          key={row.key}
          row={row}
          isLoading={isLoading}
          isUnavailable={isUnavailable}
        />
      ))}
    </Flex>
  );
}

// Private links don't store a creation date, but their id is an ObjectId whose first
// 4 bytes encode the creation time in seconds since the epoch.
function getCreationTimestamp(linkItem: ZarrPrivateLink) {
  return Number.parseInt(linkItem.id.slice(0, 8), 16) * 1000;
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
          <Space.Compact>
            <DatePicker onChange={onChange} defaultValue={expirationDate} allowClear={false} />
            <Tooltip title="Remove expiration date">
              <Button
                icon={<DeleteOutlined />}
                onClick={() => updateMutation.mutate({ ...linkItem, expirationDateTime: null })}
              />
            </Tooltip>
          </Space.Compact>
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
        now.endOf("day").to(expirationDate.endOf("day"));
  return (
    <span style={{ color: "var(--ant-color-text-secondary)", marginLeft: 4 }}>{duration}</span>
  );
}

function PrivateLinkHeaderExtra({ linkItem }: { linkItem: ZarrPrivateLink }) {
  const deleteMutation = useDeleteLinkMutation(linkItem.annotation);

  return (
    // Interacting with the expiration date or the delete button must not toggle the panel.
    // React events also bubble out of the popovers rendered in portals, hence the wrapper.
    <span onClick={(event) => event.stopPropagation()}>
      <Space size="small">
        <ExpirationDate linkItem={linkItem} />
        <Tooltip title="Delete Link" placement="left">
          <AsyncButton
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => deleteMutation.mutateAsync(linkItem.id)}
          />
        </Tooltip>
      </Space>
    </span>
  );
}

function EmptyLinkList({ onCreate }: { onCreate: () => Promise<void> }) {
  const { token } = theme.useToken();

  // Mimics the Collapse's border and header background, so the modal looks the same before and
  // after creating the first link.
  return (
    <Flex
      align="center"
      justify="space-between"
      gap="middle"
      style={{
        border: `${token.lineWidth}px ${token.lineType} ${token.colorBorder}`,
        borderRadius: token.borderRadiusLG,
        background: token.colorFillAlter,
        padding: `${token.padding}px ${token.paddingLG}px`,
      }}
    >
      <div>
        <Typography.Paragraph strong style={{ marginBottom: 0 }}>
          No Zarr links yet
        </Typography.Paragraph>
        <Typography.Text type="secondary">
          A link gives access to every layer of this annotation. It expires after 1 month by
          default.
        </Typography.Text>
      </div>
      <AsyncButton type="primary" icon={<PlusOutlined />} onClick={onCreate}>
        Create Zarr Link
      </AsyncButton>
    </Flex>
  );
}

function PrivateLinksView({ annotationId }: { annotationId: string }) {
  const { token } = theme.useToken();
  const { error, data: links, isPending } = useLinksQuery(annotationId);
  const createLinkMutation = useCreateLinkMutation(annotationId);
  // undefined: the user did not pick a link yet, so the newest one is expanded.
  // null: the user collapsed all links.
  const [activeLinkId, setActiveLinkId] = useState<string | null | undefined>(undefined);

  if (error) {
    return <span>Error while loading the private links: {error.message}</span>;
  }

  const createLink = async () => {
    const newLink = await createLinkMutation.mutateAsync(annotationId);
    setActiveLinkId(newLink.id);
  };

  const collapseItems: CollapseProps["items"] = (links ?? []).map((linkItem) => ({
    key: linkItem.id,
    label: (
      <Space size="small">
        <Typography.Text strong>Zarr Link</Typography.Text>
        <Typography.Text type="secondary">
          created {formatDateInLocalTimeZone(getCreationTimestamp(linkItem), "D MMMM YYYY HH:mm")}
        </Typography.Text>
      </Space>
    ),
    extra: <PrivateLinkHeaderExtra linkItem={linkItem} />,
    children: <ZarrLinkUrlRows maybeAccessToken={linkItem.accessToken} />,
  }));

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
      ) : links.length === 0 ? (
        <EmptyLinkList onCreate={createLink} />
      ) : (
        <>
          <Collapse
            accordion
            size="small"
            items={collapseItems}
            activeKey={activeLinkId === undefined ? (links.at(-1)?.id ?? []) : (activeLinkId ?? [])}
            onChange={(keys) => setActiveLinkId(keys[0] ?? null)}
          />
          <Typography.Paragraph
            type="secondary"
            style={{
              fontSize: token.fontSizeSM,
              margin: `${token.marginXS}px 0 ${token.margin}px`,
            }}
          >
            {messages["tracing.zarr_link_compatibility_hint"]}
          </Typography.Paragraph>
          <AsyncButton icon={<PlusOutlined />} onClick={createLink}>
            Create Another Zarr Link
          </AsyncButton>
        </>
      )}
    </div>
  );
}

function PrivateLinksModalInner({
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
      width={ModalWidth.ExtraLarge}
      onCancel={onOk}
      footer={
        <Button onClick={onOk} loading={isBusy}>
          Close
        </Button>
      }
    >
      <PrivateLinksView annotationId={annotationId} />
    </Modal>
  );
}

export const PrivateLinksModal = makeComponentLazy(PrivateLinksModalInner);
