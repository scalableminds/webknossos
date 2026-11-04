import { UserAddOutlined } from "@ant-design/icons";
import { Button, Space } from "antd";
import { AsyncButton } from "components/async_clickables";
import { ActiveTabContext, RenderingTabContext } from "dashboard/dashboard_contexts";
import { useContext } from "react";
import { RenderToPortal } from "viewer/view/layouting/portal_utils";

export function TaskListTopBar({
  confirmGetNewTask,
  isAdminView,
  userId,
  toggleShowFinished,
  showFinishedTasks,
}: {
  confirmGetNewTask: () => Promise<void>;
  isAdminView: boolean;
  userId: string | null | undefined;
  toggleShowFinished: () => void;
  showFinishedTasks: boolean;
}) {
  const activeTab = useContext(ActiveTabContext);
  const renderingTab = useContext(RenderingTabContext);

  const content = (
    <Space wrap>
      <AsyncButton
        type="primary"
        icon={<UserAddOutlined />}
        onClick={confirmGetNewTask}
        disabled={isAdminView && userId != null}
      >
        Get a New Task
      </AsyncButton>
      <Button onClick={toggleShowFinished}>
        Show {showFinishedTasks ? "Unfinished" : "Finished"} Tasks Only
      </Button>
    </Space>
  );

  return (
    <RenderToPortal portalId="dashboard-TabBarExtraContent">
      {activeTab === renderingTab ? content : null}
    </RenderToPortal>
  );
}
