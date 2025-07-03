import { transferTask } from "admin/api/tasks";
import UserSelectionComponent from "admin/user/user_selection_component";
import { Button, Modal } from "antd";
import { handleGenericError } from "libs/error_handling";
import type React from "react";
import { memo, useCallback, useState } from "react";
import type { APIAnnotation } from "types/api_types";

type Props = {
  onChange: (updatedAnnotation: APIAnnotation) => void;
  annotationId: string | null | undefined;
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
};

const TransferTaskModal: React.FC<Props> = ({ isOpen, onCancel, annotationId, onChange }) => {
  const [currentUserIdValue, setCurrentUserIdValue] = useState("");

  const handleSelectChange = useCallback((userId: string) => {
    setCurrentUserIdValue(userId);
  }, []);

  const transfer = useCallback(async () => {
    if (!annotationId) {
      throw new Error("No annotation id provided");
    }

    try {
      const updatedAnnotation = await transferTask(annotationId, currentUserIdValue);
      onChange(updatedAnnotation);
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
      footer={
        <div>
          <Button type="primary" onClick={transfer} disabled={currentUserIdValue === ""}>
            Transfer
          </Button>
          <Button onClick={onCancel}>Close</Button>
        </div>
      }
    >
      <div className="control-group">
        <div className="form-group">
          <UserSelectionComponent handleSelection={handleSelectChange} />
        </div>
      </div>
    </Modal>
  );
};

export default memo(TransferTaskModal);
