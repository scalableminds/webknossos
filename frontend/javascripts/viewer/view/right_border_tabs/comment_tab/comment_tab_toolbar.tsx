import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  InfoCircleOutlined,
  SearchOutlined,
  ShrinkOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
} from "@ant-design/icons";
import { Dropdown, type MenuProps, Space, Tooltip } from "antd";
import messages from "messages";
import type React from "react";
import type { CommentType } from "viewer/model/types/tree_types";
import ButtonComponent from "viewer/view/components/button_component";
import AdvancedSearchPopover from "../advanced_search_popover";
import { type CommentSorting, CommentSortMode } from "./comment_tab_types";

type CommentTabToolbarProps = {
  targetId: string;
  sorting: CommentSorting;
  sortedComments: CommentType[];
  // The comment editor (input + markdown button), rendered between the navigation buttons.
  editor: React.ReactNode;
  onChangeSortMode: (mode: CommentSortMode) => void;
  onToggleSortDirection: () => void;
  onPreviousComment: () => void;
  onNextComment: () => void;
  onToggleExpandAll: () => void;
  onSelectComment: (comment: CommentType) => void;
};

function buildSortMenu(
  sorting: CommentSorting,
  onChangeSortMode: CommentTabToolbarProps["onChangeSortMode"],
): MenuProps {
  return {
    selectedKeys: [sorting.mode],
    onClick: ({ key }) => onChangeSortMode(key as CommentSortMode),
    items: [
      { key: CommentSortMode.NAME, label: "by name" },
      { key: CommentSortMode.ID, label: "by creation time" },
      {
        key: CommentSortMode.NATURAL,
        label: (
          <>
            by name (natural sort)
            <Tooltip title={messages["tracing.natural_sorting"]} placement="bottomLeft">
              {" "}
              <InfoCircleOutlined />
            </Tooltip>
          </>
        ),
      },
    ],
  };
}

export function CommentTabToolbar(props: CommentTabToolbarProps) {
  const { sorting } = props;

  return (
    <Space>
      <AdvancedSearchPopover
        onSelect={props.onSelectComment}
        data={props.sortedComments}
        searchKey="content"
        provideShortcut
        targetId={props.targetId}
      >
        <ButtonComponent
          icon={<SearchOutlined />}
          title="Open search via CTRL + Shift + F"
          variant="text"
          color="default"
        />
      </AdvancedSearchPopover>
      <ButtonComponent
        title="Jump to previous comment"
        onClick={props.onPreviousComment}
        icon={<ArrowLeftOutlined />}
        variant="text"
        color="default"
      />
      {props.editor}
      <ButtonComponent
        title="Jump to next comment"
        onClick={props.onNextComment}
        icon={<ArrowRightOutlined />}
        variant="text"
        color="default"
      />
      <Dropdown menu={buildSortMenu(sorting, props.onChangeSortMode)} trigger={["click"]}>
        <ButtonComponent
          title="Sort"
          onClick={props.onToggleSortDirection}
          icon={sorting.isAscending ? <SortAscendingOutlined /> : <SortDescendingOutlined />}
          variant="text"
          color="default"
        />
      </Dropdown>
      <ButtonComponent
        onClick={props.onToggleExpandAll}
        icon={<ShrinkOutlined />}
        title="Collapse or expand groups"
        variant="text"
        color="default"
      />
    </Space>
  );
}
