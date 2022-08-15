import React from "react";
import {
  createPrivateLink,
  deletePrivateLink,
  getPrivateLinksByAnnotation,
  updatePrivateLink,
} from "admin/admin_rest_api";
import {
  useQuery,
  useMutation,
  useQueryClient,
  useIsFetching,
  useIsMutating,
} from "@tanstack/react-query";
import Toast from "libs/toast";
import {
  Button,
  DatePicker,
  DatePickerProps,
  Dropdown,
  Input,
  Menu,
  Modal,
  Popover,
  Space,
  Table,
  Tooltip,
} from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  InfoCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { ZarrPrivateLink } from "types/api_flow_types";
import { AsyncButton, AsyncIconButton } from "components/async_clickables";
import moment from "moment";
import FormattedDate from "components/formatted_date";
import { ColumnsType } from "antd/lib/table";
import { makeComponentLazy } from "libs/react_helpers";
import { OxalisState } from "oxalis/store";
import { useSelector } from "react-redux";
import { getDataLayers } from "oxalis/model/accessors/dataset_accessor";
import { getReadableNameByVolumeTracingId } from "oxalis/model/accessors/volumetracing_accessor";

function useLinksQuery(annotationId: string) {
  return useQuery(["links", annotationId], () => getPrivateLinksByAnnotation(annotationId), {
    initialData: [],
    refetchOnWindowFocus: false,
  });
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
      const previousLinks = queryClient.getQueryData(mutationKey);

      // Optimistically update to the new value
      queryClient.setQueryData(mutationKey, (oldItems: ZarrPrivateLink[] | undefined) =>
        (oldItems || []).map((link) => (link.id !== updatedLinkItem.id ? link : updatedLinkItem)),
      );

      // Return a context object with the snapshotted value
      return { previousLinks };
    },
    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (err, _updatedLinkItem, context) => {
      Toast.error(`Could not update link. ${err}`);
      if (context) {
        queryClient.setQueryData(mutationKey, context.previousLinks);
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

function UrlInput({ linkItem }: { linkItem: ZarrPrivateLink }) {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const dataStoreURL = dataset.dataStore.url;
  const dataLayers = getDataLayers(dataset);
  const baseUrl = `${dataStoreURL}/annotations/zarr/${linkItem.accessToken}`;

  const copyTokenToClipboard = async ({ key: layerName }: { key: string }) => {
    await navigator.clipboard.writeText(`${baseUrl}/${layerName}`);
    Toast.success("URL copied to clipboard");
  };

  const copyLayerUrlMenu = (
    <Menu
      // @ts-ignore
      onClick={copyTokenToClipboard}
      items={[
        {
          type: "group",
          label: "Select layer to copy URL",
          children: dataLayers.map((layer) => ({
            label:
              "tracingId" in layer && layer.tracingId != null
                ? getReadableNameByVolumeTracingId(tracing, layer.tracingId)
                : layer.name,
            key: layer.name,
          })),
        },
      ]}
    />
  );

  return (
    <Input.Group compact className="no-borders">
      <Input
        value={baseUrl}
        size="small"
        style={{
          width: "90%",
        }}
        readOnly
      />

      <Dropdown overlay={copyLayerUrlMenu}>
        <Button size="small" icon={<CopyOutlined />} />
      </Dropdown>
    </Input.Group>
  );
}

function ExpirationDate({ linkItem }: { linkItem: ZarrPrivateLink }) {
  const updateMutation = useUpdatePrivateLink(linkItem.annotation);

  const onChange: DatePickerProps["onChange"] = (date) => {
    updateMutation.mutate({ ...linkItem, expirationDateTime: Number(date) });
  };

  const handleExpirationMenuClick = ({
    key,
  }: {
    key: "24 hours" | "1 week" | "6 months" | "1 year";
  }) => {
    const expirationDateTime = (() => {
      switch (key) {
        case "24 hours":
          return moment().add(24, "hours");
        case "1 week":
          return moment().add(1, "week");
        case "6 months":
          return moment().add(6, "months");
        case "1 year":
          return moment().add(1, "year");
        default:
          throw new Error("Unexpected expiration date key");
      }
    })();

    updateMutation.mutate({ ...linkItem, expirationDateTime: Number(expirationDateTime) });
  };
  const expirationMenu = (
    <Menu
      // @ts-ignore
      onClick={handleExpirationMenuClick}
      items={[
        {
          label: "24 hours",
          key: "24 hours",
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
      ]}
    />
  );

  if (linkItem.expirationDateTime == null) {
    return (
      <Dropdown overlay={expirationMenu}>
        <Space style={{ color: "var(--ant-text-secondary)" }}>
          Add Expiration Date
          <DownOutlined />
        </Space>
      </Dropdown>
    );
  }

  const maybeWarning =
    Number(new Date()) > linkItem.expirationDateTime ? (
      <Tooltip title="This link has expired">
        <InfoCircleOutlined style={{ color: "var(--ant-error)" }} />
      </Tooltip>
    ) : null;

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
                defaultValue={moment(linkItem.expirationDateTime)}
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
        {maybeWarning}
      </Popover>
    </span>
  );
}

function PrivateLinksView({ annotationId }: { annotationId: string }) {
  const { error, data: links } = useLinksQuery(annotationId);
  const createLinkMutation = useCreateLinkMutation(annotationId);
  const deleteMutation = useDeleteLinkMutation(annotationId);

  if (error) {
    return <span>Error while loading the private links: {error}</span>;
  }

  const columns: ColumnsType<ZarrPrivateLink> = [
    {
      title: "Base URL",
      key: "name",
      render: (_, linkItem) => <UrlInput linkItem={linkItem} />,
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
        Create <a href="https://zarr.dev">Zarr</a> streaming links to allow other tools to load the
        data of this annotation. Note that anyone with these links can access the data, regardless
        of other sharing settings.
      </div>
      {links.length > 0 && (
        <Table rowKey="id" columns={columns} dataSource={links} size="small" pagination={false} />
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
    </div>
  );
}

export function _PrivateLinksModal({
  isVisible,
  onOk,
  annotationId,
}: {
  isVisible: boolean;
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
      visible={isVisible}
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
