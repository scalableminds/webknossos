// @flow

import * as React from "react";
import { Modal, Button } from "antd";
import { transferTask } from "admin/admin_rest_api";
import type { APIAnnotationType } from "admin/api_flow_types";
import { handleGenericError } from "libs/error_handling";
import UserSelectionComponent from "admin/user/user_selection_component";

type Props = {
  onChange: (updatedAnnotation: APIAnnotationType) => void,
  annotationId: ?string,
  onCancel: Function,
  visible: boolean,
  userId: ?string,
};

type State = {
  currentUserIdValue: string,
};

class TransferTaskModal extends React.PureComponent<Props, State> {
  state = {
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
      handleGenericError(error);
    }
  }

  handleSelectChange = (userId: string) => {
    this.setState({ currentUserIdValue: userId });
  };

  render() {
    if (!this.props.visible) {
      return null;
    }

    return (
      <Modal
        title="Transfer a Task"
        visible={this.props.visible}
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
            <UserSelectionComponent
              loggedInUserListed="false"
              handleSelection={this.handleSelectChange}
              userId={this.props.userId}
            />
          </div>
        </div>
      </Modal>
    );
  }
}

export default TransferTaskModal;
