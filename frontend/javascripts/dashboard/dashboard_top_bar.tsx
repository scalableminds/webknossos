import { UploadOutlined } from "@ant-design/icons";
import { Button, Input, Space } from "antd";
import type { SearchProps } from "antd/es/input";
import { useContext } from "react";
import { useDispatch } from "react-redux";
import { setDropzoneModalVisibilityAction } from "viewer/model/actions/ui_actions";
import { RenderToPortal } from "viewer/view/layouting/portal_utils";
import { ActiveTabContext, RenderingTabContext } from "./dashboard_contexts";

const { Search } = Input;

export function DashboardTopBar({
  isAdminView,
  handleOnSearch,
  handleSearchChanged,
  searchQuery,
  toggleShowArchived,
  shouldShowArchivedAnnotations,
  archiveAll,
}: {
  isAdminView: boolean;
  handleOnSearch: SearchProps["onSearch"];
  handleSearchChanged: (event: React.ChangeEvent<HTMLInputElement>) => void;
  searchQuery: string;
  toggleShowArchived: () => void;
  shouldShowArchivedAnnotations: boolean;
  archiveAll: () => void;
}) {
  const dispatch = useDispatch();
  const activeTab = useContext(ActiveTabContext);
  const renderingTab = useContext(RenderingTabContext);

  const search = (
    <Search
      style={{
        width: 200,
      }}
      onSearch={handleOnSearch}
      onChange={handleSearchChanged}
      value={searchQuery}
    />
  );

  const content = isAdminView ? (
    search
  ) : (
    <Space>
      <Button
        icon={<UploadOutlined />}
        onClick={() => dispatch(setDropzoneModalVisibilityAction(true))}
      >
        Upload Annotation(s)
      </Button>
      <Button onClick={toggleShowArchived}>
        Show {shouldShowArchivedAnnotations ? "Open" : "Archived"} Annotations
      </Button>
      {!shouldShowArchivedAnnotations ? <Button onClick={archiveAll}>Archive All</Button> : null}
      {search}
    </Space>
  );

  return (
    <RenderToPortal portalId="dashboard-TabBarExtraContent">
      {activeTab === renderingTab ? content : null}
    </RenderToPortal>
  );
}
