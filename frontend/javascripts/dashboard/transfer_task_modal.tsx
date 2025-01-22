import { transferTask } from "admin/api/tasks";
import UserSelectionComponent from "admin/user/user_selection_component";
import { Button, Modal } from "antd";
import { handleGenericError } from "libs/error_handling";
import * as React from "react";
import type { APIAnnotation } from "types/api_flow_types";

type Props = {
  onChange: (updatedAnnotation: APIAnnotation) => void;
  annotationId: string | null | undefined;
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
};
type State = {
  currentUserIdValue: string;
};

class TransferTaskModal extends React.PureComponent<Props, State> {
  state: State = {
    currentUserIdValue: "",
  };

  async transfer() {
    const annotationId = this.props.annotationId;

    if (!annotationId) {
      throw new Error("No annotation id provided");
    }

    try {
      const updatedAnnotation = await transferTask(annotationId, this.state.currentUserIdValue);
      this.props.onChange(updatedAnnotation);
    } catch (error) {
      handleGenericError(error as Error);
    }
  }

  handleSelectChange = (userId: string) => {
    this.setState({
      currentUserIdValue: userId,
    });
  };

  render() {
    if (!this.props.isOpen) {
      return null;
    }

    return (
      <Modal
        title="Transfer a Task"
        open={this.props.isOpen}
        onCancel={this.props.onCancel}
        footer={
          <div>
            <Button
              type="primary"
              onClick={() => this.transfer()}
              disabled={this.state.currentUserIdValue === ""}
            >
              Transfer
            </Button>
            <Button onClick={() => this.props.onCancel()}>Close</Button>
          </div>
        }
      >
        <div className="control-group">
          <div className="form-group">
            <UserSelectionComponent handleSelection={this.handleSelectChange} />
          </div>
        </div>
      </Modal>
    );
  }
}

export default TransferTaskModal;
