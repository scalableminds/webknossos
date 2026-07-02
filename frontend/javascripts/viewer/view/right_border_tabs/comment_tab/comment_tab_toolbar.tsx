import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  EditOutlined,
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
import InputComponent from "viewer/view/components/input_component";
import { SortByEnum } from "viewer/view/right_border_tabs/comment_tab/comment_sorting";
import AdvancedSearchPopover from "../advanced_search_popover";

type Props = {
  commentTabId: string;
  searchData: CommentType[];
  onSearchSelect: (comment: CommentType) => void;
  onPreviousComment: () => void;
  onNextComment: () => void;
  activeCommentContent: string | undefined;
  isEditingDisabled: boolean;
  isEditingDisabledMessage: string;
  allowUpdate: boolean;
  onChangeInput: (commentText: string, insertLineBreaks?: boolean) => void;
  onOpenMarkdownModal: () => void;
  isMultilineComment: boolean;
  sortBy: SortByEnum;
  isSortedAscending: boolean;
  onChangeSorting: (info: { key: any }) => void;
  onToggleSortingDirection: () => void;
  onToggleExpandAllTrees: () => void;
};

function getSortDropdown(
  sortBy: SortByEnum,
  onChangeSorting: (info: { key: any }) => void,
): MenuProps {
  return {
    selectedKeys: [sortBy],
    onClick: onChangeSorting,
    items: [
      { key: SortByEnum.NAME, label: "by name" },
      { key: SortByEnum.ID, label: "by creation time" },
      {
        key: SortByEnum.NATURAL,
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

export default function CommentTabToolbar({
  commentTabId,
  searchData,
  onSearchSelect,
  onPreviousComment,
  onNextComment,
  activeCommentContent,
  isEditingDisabled,
  isEditingDisabledMessage,
  allowUpdate,
  onChangeInput,
  onOpenMarkdownModal,
  isMultilineComment,
  sortBy,
  isSortedAscending,
  onChangeSorting,
  onToggleSortingDirection,
  onToggleExpandAllTrees,
}: Props) {
  return (
    <Space>
      <AdvancedSearchPopover
        onSelect={onSearchSelect}
        data={searchData}
        searchKey="content"
        provideShortcut
        targetId={commentTabId}
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
        onClick={onPreviousComment}
        icon={<ArrowLeftOutlined />}
        variant="text"
        color="default"
      />
      <InputComponent
        value={activeCommentContent}
        disabled={isEditingDisabled}
        title={allowUpdate ? undefined : isEditingDisabledMessage}
        onChange={(evt: React.ChangeEvent<HTMLInputElement>) =>
          onChangeInput(evt.target.value, true)
        }
        onPressEnter={(evt: React.KeyboardEvent<HTMLInputElement>) =>
          (evt.target as HTMLElement).blur()
        }
        placeholder="Add comment"
      />
      <ButtonComponent
        onClick={onOpenMarkdownModal}
        disabled={isEditingDisabled}
        title={
          allowUpdate ? "Open dialog to edit comment in multi-line mode" : isEditingDisabledMessage
        }
        type={isMultilineComment ? "primary" : "default"}
        icon={<EditOutlined />}
        variant="text"
        color="default"
      />
      <ButtonComponent
        title="Jump to next comment"
        onClick={onNextComment}
        icon={<ArrowRightOutlined />}
        variant="text"
        color="default"
      />
      <Dropdown menu={getSortDropdown(sortBy, onChangeSorting)} trigger={["click"]}>
        <ButtonComponent
          title="Sort"
          onClick={onToggleSortingDirection}
          icon={isSortedAscending ? <SortAscendingOutlined /> : <SortDescendingOutlined />}
          variant="text"
          color="default"
        />
      </Dropdown>
      <ButtonComponent
        onClick={onToggleExpandAllTrees}
        icon={<ShrinkOutlined />}
        title="Collapse or expand groups"
        variant="text"
        color="default"
      />
    </Space>
  );
}
