import React from "react";
import {
  createPrivateLink,
  deletePrivateLink,
  getPrivateLinks,
  updatePrivateLink,
} from "admin/admin_rest_api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Tooltip,
} from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { ZarrPrivateLink } from "types/api_flow_types";
import { AsyncButton, AsyncIconButton } from "components/async_clickables";
import moment from "moment";

function useLinksQuery() {
  return useQuery(["links"], getPrivateLinks, {
    initialData: [],
    refetchOnWindowFocus: false,
  });
}

function useCreateLinkMutation() {
  const queryClient = useQueryClient();

  return useMutation(createPrivateLink, {
    onSuccess: (newLink) => {
      queryClient.setQueryData(["links"], (oldItems: ZarrPrivateLink[] | undefined) =>
        (oldItems || []).concat([newLink]),
      );
    },
  });
}

function useUpdatePrivateLink() {
  const queryClient = useQueryClient();

  return useMutation(updatePrivateLink, {
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
    onError: (err, newTodo, context) => {
      Toast.error(`${err}`);
      if (context) {
        queryClient.setQueryData(["links"], context.previousLinks);
      }
    },
  });
}

function useDeleteLinkMutation() {
  const queryClient = useQueryClient();

  return useMutation(deletePrivateLink, {
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
    onError: (err, newTodo, context) => {
      Toast.error(`${err}`);
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
    console.log(date, dateString);
  };

  const handleExpiryMenuClick = ({ key }) => {
    console.log("key", key);
    // if (key === 1) {

    // }
    //
    const someDate = moment().add(24, "hours");
    console.log("someDate");

    const expirationDateTime = new Date();

    updateMutation.mutate({ ...linkItem, expirationDateTime: Number(expirationDateTime) });
  };
  const expiryMenu = (
    <Menu
      onClick={handleExpiryMenuClick}
      items={[
        {
          label: "24 hours",
          key: "1",
        },
        {
          label: "1 week",
          key: "2",
        },
        {
          label: "6 months",
          key: "3",
        },
        {
          label: "1 year",
          key: "4",
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
              {linkItem.expirationDateTime}
              <Popover
                content={<DatePicker onChange={onChange} />}
                title="Set an expiration date"
                trigger="click"
              >
                <EditOutlined />
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

  if (error) {
    return <span>Error: {error.message}</span>;
  }

  return (
    <div>
      <p>
        You can create a Zarr link to this annotation/dataset below. The link can be used by other
        tools to access the data in a streaming manner.
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
