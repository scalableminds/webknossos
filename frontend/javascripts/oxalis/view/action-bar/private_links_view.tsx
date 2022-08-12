import React from "react";
import {
  createPrivateLink,
  deletePrivateLink,
  getPrivateLinks,
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
  List,
  Menu,
  Popover,
  Space,
  Spin,
  Table,
  Tooltip,
} from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  LoadingOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { ZarrPrivateLink } from "types/api_flow_types";
import { AsyncButton, AsyncIconButton } from "components/async_clickables";
import moment from "moment";
import FormattedDate from "components/formatted_date";
import { ColumnsType } from "antd/lib/table";

const LOADING_ICON = <LoadingOutlined style={{ fontSize: 24 }} spin />;

function useLinksQuery() {
  return useQuery(["links"], getPrivateLinks, {
    initialData: [],
    refetchOnWindowFocus: false,
  });
}

function useCreateLinkMutation() {
  const queryClient = useQueryClient();

  return useMutation(createPrivateLink, {
    mutationKey: ["links"],
    onSuccess: (newLink) => {
      queryClient.setQueryData(["links"], (oldItems: ZarrPrivateLink[] | undefined) =>
        (oldItems || []).concat([newLink]),
      );
    },
    onError: (err) => {
      Toast.error(`Could not create link. ${err}`);
    },
  });
}

function useUpdatePrivateLink() {
  const queryClient = useQueryClient();

  return useMutation(updatePrivateLink, {
    mutationKey: ["links"],
    onMutate: async (updatedLinkItem) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries(["links"]);

      // Snapshot the previous value
      const previousLinks = queryClient.getQueryData(["links"]);

      // Optimistically update to the new value
      queryClient.setQueryData(["links"], (oldItems: ZarrPrivateLink[] | undefined) =>
        (oldItems || []).map((link) => (link.id != updatedLinkItem.id ? link : updatedLinkItem)),
      );

      // Return a context object with the snapshotted value
      return { previousLinks };
    },
    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (err, _updatedLinkItem, context) => {
      Toast.error(`Could not update link. ${err}`);
      if (context) {
        queryClient.setQueryData(["links"], context.previousLinks);
      }
    },
  });
}

function useDeleteLinkMutation() {
  const queryClient = useQueryClient();

  return useMutation(deletePrivateLink, {
    mutationKey: ["links"],
    onMutate: async (linkIdToDelete) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries(["links"]);

      // Snapshot the previous value
      const previousLinks = queryClient.getQueryData(["links"]);

      // Optimistically update to the new value
      queryClient.setQueryData(["links"], (oldItems: ZarrPrivateLink[] | undefined) =>
        (oldItems || []).filter((link) => link.id != linkIdToDelete),
      );

      // Return a context object with the snapshotted value
      return { previousLinks };
    },
    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (err, _linkIdToDelete, context) => {
      Toast.error(`Could not delete link. ${err}`);
      if (context) {
        queryClient.setQueryData(["links"], context.previousLinks);
      }
    },
  });
}

function UrlInput({ linkItem }: { linkItem: ZarrPrivateLink }) {
  const url = "https://.../" + linkItem.accessToken;
  const copyTokenToClipboard = async () => {
    await navigator.clipboard.writeText(url);
    Toast.success("URL copied to clipboard");
  };
  return (
    <Input.Group compact className="no-borders">
      <Input
        value={url}
        size="small"
        style={{
          width: "90%",
        }}
        readOnly
      />
      <Button size="small" onClick={copyTokenToClipboard} icon={<CopyOutlined />} />
    </Input.Group>
  );
}

function ExpirationDate({ linkItem }: { linkItem: ZarrPrivateLink }) {
  const updateMutation = useUpdatePrivateLink();

  const onChange: DatePickerProps["onChange"] = (date, dateString) => {
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

  return linkItem.expirationDateTime == null ? (
    <Dropdown overlay={expirationMenu}>
      <Space style={{ color: "var(--ant-text-secondary)" }}>
        Add Expiration Date
        <DownOutlined />
      </Space>
    </Dropdown>
  ) : (
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
      </Popover>
    </span>
  );
}

export function PrivateLinksView() {
  const { error, data: links } = useLinksQuery();
  const createLinkMutation = useCreateLinkMutation();
  const deleteMutation = useDeleteLinkMutation();
  const isFetchingCount = useIsFetching(["links"]);
  const isMutatingCount = useIsMutating(["links"]);
  const isBusy = isFetchingCount + isMutatingCount > 0;

  if (error) {
    return <span>Error while loading the private links: {error}</span>;
  }

  const columns: ColumnsType<ZarrPrivateLink> = [
    {
      title: "URL",
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
      render: (_, linkItem) => {
        return (
          <Tooltip title="Delete Link" placement="left">
            <AsyncIconButton
              onClick={() => deleteMutation.mutateAsync(linkItem.id)}
              icon={<DeleteOutlined />}
            />
          </Tooltip>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        You can create a Zarr link to this annotation/dataset below. The link can be used by other
        tools to access the data in a streaming manner.
        {isBusy && <Spin indicator={LOADING_ICON} />}
      </div>
      {links.length > 0 && (
        <Table rowKey="id" columns={columns} dataSource={links} size="small" pagination={false} />
      )}

      <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
        <AsyncButton
          type={links.length === 0 ? "primary" : "link"}
          size={links.length === 0 ? "large" : undefined}
          icon={<PlusOutlined />}
          onClick={() => createLinkMutation.mutateAsync("62f3b0d22102004bb5cb5b2e")}
        >
          Create Zarr Link
        </AsyncButton>
      </div>
    </div>
  );
}
