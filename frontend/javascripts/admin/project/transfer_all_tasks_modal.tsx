import { getUsers } from "admin/admin_rest_api";
import { getUsersWithActiveTasks, transferActiveTasksOfProject } from "admin/api/tasks";
import UserSelectionComponent from "admin/user/user_selection_component";
import { Modal, Spin, Table } from "antd";
import { handleGenericError } from "libs/error_handling";
import { useFetch } from "libs/react_helpers";
import Toast from "libs/toast";
import _ from "lodash";
import messages from "messages";
import { useState } from "react";
import type { APIActiveUser, APIProject, APIUser } from "types/api_flow_types";

type Props = {
  project: APIProject | null | undefined;
  onCancel: () => void;
  onComplete: () => void;
};

function TransferAllTasksModal({ project, onCancel, onComplete }: Props) {
  const [selectedUser, setSelectedUser] = useState<APIUser | undefined>(undefined);
  const [usersWithActiveTasks, setUsersWithActiveTasks] = useState<APIActiveUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const users = useFetch(
    async () => {
      try {
        const users = await getUsers();
        const activeUsers = users.filter((u) => u.isActive);
        const usersWithActiveTasks = project ? await getUsersWithActiveTasks(project.id) : [];

        const sortedUsers = _.sortBy(activeUsers, "lastName");

        setUsersWithActiveTasks(usersWithActiveTasks);
        return sortedUsers;
      } catch (error) {
        handleGenericError(error as Error);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [],
    [],
  );

  async function transferAllActiveTasks() {
    if (!selectedUser || !project) {
      return;
    }

    try {
      await transferActiveTasksOfProject(project.id, selectedUser.id);

      if (selectedUser) {
        Toast.success(
          `${messages["project.successful_active_tasks_transfer"]} ${selectedUser.lastName}, ${selectedUser.firstName}`,
        );
      }

      onComplete();
    } catch (_e) {
      Toast.error(messages["project.unsuccessful_active_tasks_transfer"]);
    }
  }

  function renderTableContent() {
    const activeUsersWithKey = usersWithActiveTasks.map((activeUser) => ({
      email: activeUser.email,
      firstName: activeUser.firstName,
      lastName: activeUser.lastName,
      activeTasks: activeUser.activeTasks,
      key: activeUser.email,
    }));

    const columns = [
      {
        title: "User",
        dataIndex: "email",
        render: (email: string, record: APIActiveUser) =>
          `${record.lastName}, ${record.firstName} (${email})`,
        key: "email",
      },
      {
        title: "Number of Active Tasks",
        dataIndex: "activeTasks",
        key: "activeTasks",
      },
    ];

    return (
      <Table
        columns={columns}
        dataSource={activeUsersWithKey}
        rowKey="email"
        pagination={false}
        size="small"
      />
    );
  }

  function handleSelectChange(userId: string) {
    setSelectedUser(users.find((user) => user.id === userId));
  }

  if (!project) {
    return (
      <Modal title="Error" open onOk={onCancel} onCancel={onCancel}>
        <p>{messages["project.none_selected"]}</p>
      </Modal>
    );
  } else {
    const title = `All users with active tasks for ${project.name}`;
    return (
      <Modal
        title={title}
        open
        onCancel={onCancel}
        onOk={transferAllActiveTasks}
        okText="Transfer all tasks"
        okButtonProps={{ disabled: !selectedUser }}
        cancelText="Close"
      >
        <div>
          {isLoading ? <Spin size="large" /> : renderTableContent()}
          <br />
          <br />
        </div>
        Select a user to transfer the tasks to:
        <div className="control-group">
          <div className="form-group">
            <UserSelectionComponent handleSelection={handleSelectChange} />
          </div>
        </div>
      </Modal>
    );
  }
}

export default TransferAllTasksModal;
