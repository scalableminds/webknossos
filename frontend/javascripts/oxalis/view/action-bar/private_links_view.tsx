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
  Tooltip,
} from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  LinkOutlined,
  LoadingOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { ZarrPrivateLink } from "types/api_flow_types";
import { AsyncButton, AsyncIconButton } from "components/async_clickables";
import moment from "moment";
import FormattedDate from "components/formatted_date";
import { createLocation } from "history";

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

function LinkListItem({ linkItem }: { linkItem: ZarrPrivateLink }) {
  const deleteMutation = useDeleteLinkMutation();
  const updateMutation = useUpdatePrivateLink();
  const linkUrl = "https://.../" + linkItem.accessToken;
  const copyTokenToClipboard = async () => {
    await navigator.clipboard.writeText(linkUrl);
    Toast.success("URL copied to clipboard");
  };
  const linkUrlInput = (
    <Input.Group compact>
      <Input
        value={linkUrl}
        size="small"
        style={{
          width: "90%",
        }}
        readOnly
      />
      <Button
        size="small"
        onClick={copyTokenToClipboard}
        icon={<CopyOutlined className="without-icon-margin" />}
      />
    </Input.Group>
  );

  const onChange: DatePickerProps["onChange"] = (date, dateString) => {
    updateMutation.mutate({ ...linkItem, expirationDateTime: Number(date) });
  };

  const handleExpiryMenuClick = ({
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
          throw new Error("Unexpected expiry date key");
      }
    })();

    updateMutation.mutate({ ...linkItem, expirationDateTime: Number(expirationDateTime) });
  };
  const expiryMenu = (
    <Menu
      onClick={handleExpiryMenuClick}
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

  return (
    <List.Item
      actions={[
        <span>
          <Tooltip title="Delete Link" placement="left">
            <AsyncIconButton
              onClick={() => deleteMutation.mutateAsync(linkItem.id)}
              icon={<DeleteOutlined className="without-icon-margin" />}
            />
          </Tooltip>
        </span>,
      ]}
    >
      <List.Item.Meta
        avatar={<LinkOutlined style={{ marginTop: 10 }} />}
        title={linkUrlInput}
        description={
          linkItem.expirationDateTime == null ? (
            <Dropdown overlay={expiryMenu}>
              <Space>
                Add Expiry Date
                <DownOutlined />
              </Space>
            </Dropdown>
          ) : (
            <span>
              Expires on <FormattedDate timestamp={linkItem.expirationDateTime} />
              <Popover
                content={
                  <>
                    <DatePicker
                      onChange={onChange}
                      defaultValue={moment(linkItem.expirationDateTime)}
                    />
                    <Button
                      type="link"
                      onClick={() =>
                        updateMutation.mutate({ ...linkItem, expirationDateTime: null })
                      }
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
          )
        }
      />
    </List.Item>
  );
}

export function PrivateLinksView() {
  const { isLoading, error, data: links } = useLinksQuery();
  const createLinkMutation = useCreateLinkMutation();
  const isFetchingCount = useIsFetching(["links"]);
  const isMutatingCount = useIsMutating(["links"]);
  const isBusy = isFetchingCount + isMutatingCount > 0;

  if (error) {
    return <span>Error: {error.message}</span>;
  }

  const loadingIcon = <LoadingOutlined style={{ fontSize: 24 }} spin />;
  return (
    <div>
      <p>
        You can create a Zarr link to this annotation/dataset below. The link can be used by other
        tools to access the data in a streaming manner.
        {isBusy && <Spin indicator={loadingIcon} />}
      </p>
      {links.length > 0 && (
        <List
          loading={isLoading}
          itemLayout="horizontal"
          dataSource={links || []}
          renderItem={(linkItem: ZarrPrivateLink) => <LinkListItem linkItem={linkItem} />}
        />
      )}

      <AsyncButton
        type={links.length === 0 ? "primary" : "link"}
        icon={<PlusOutlined />}
        onClick={() => createLinkMutation.mutateAsync("62f3b0d22102004bb5cb5b2e")}
      >
        Create Zarr Link
      </AsyncButton>
    </div>
  );
}
