import { transferTask } from "admin/api/tasks";
import UserSelectionComponent from "admin/user/user_selection_component";
import { Alert, Modal } from "antd";
import { handleGenericError } from "libs/error_handling";
import type React from "react";
import { memo, useCallback, useState } from "react";
import type { APIAnnotation, APIUser } from "types/api_types";

type Props = {
  onChange: (updatedAnnotation: APIAnnotation) => void;
  annotationId: string | null | undefined;
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
};

const TransferTaskModal: React.FC<Props> = ({ isOpen, onCancel, annotationId, onChange }) => {
  const [currentUserIdValue, setCurrentUserIdValue] = useState("");
  const [selectedUser, setSelectedUser] = useState<APIUser | undefined>(undefined);

  const handleSelectChange = useCallback((userId: string, user: APIUser | undefined) => {
    setCurrentUserIdValue(userId);
    setSelectedUser(user);
  }, []);

  const transfer = useCallback(async () => {
    if (!annotationId) {
      throw new Error("No annotation id provided");
    }

    try {
      const updatedAnnotation = await transferTask(annotationId, currentUserIdValue);
      onChange(updatedAnnotation);
      setCurrentUserIdValue("");
      setSelectedUser(undefined);
    } catch (error) {
      handleGenericError(error as Error);
    }
  }, [annotationId, currentUserIdValue, onChange]);

  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      title="Transfer a Task"
      open={isOpen}
      onCancel={onCancel}
      onOk={transfer}
      okText="Transfer"
      okButtonProps={{ disabled: currentUserIdValue === "" }}
      cancelText="Close"
    >
      <div className="control-group">
        <div className="form-group">
          <UserSelectionComponent handleSelection={handleSelectChange} includeDeactivatedUsers />
        </div>
        {selectedUser != null && !selectedUser.isActive ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
            title="The selected user is deactivated."
            description="Deactivated users cannot log in, so they won't be able to work on this task unless their account is activated again."
          />
        ) : null}
      </div>
    </Modal>
  );
};

export default memo(TransferTaskModal);
