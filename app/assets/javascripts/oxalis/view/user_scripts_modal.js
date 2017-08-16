// @flow

/* eslint-disable no-eval, no-alert */
import React from "react";
import { Modal, Input, Select, Spin } from "antd";
import Request from "libs/request";
import { fetchGistContent } from "libs/gist";

type UserScriptsModalViewPropsType = {
  onClose: Function,
  visible: boolean
};

class UserScriptsModalView extends React.PureComponent {
  props: UserScriptsModalViewPropsType;

  state = {
    code: "",
    isCodeChanged: false,
    scripts: [],
    // Needs to be undefined so the placeholder is displayed in the beginning
    selectedScript: undefined,
    isLoading: true
  };

  componentWillMount() {
    Request.receiveJSON("/api/scripts").then(scripts => {
      this.setState({ isLoading: false });
      if (scripts.length) {
        this.setState({ scripts });
      }
    });
  }

  handleCodeChange = (event: SyntheticInputEvent) => {
    this.setState({
      code: event.target.value,
      isCodeChanged: true
    });
  };

  handleScriptChange = async (scriptId: string) => {
    const script = this.state.scripts.find(s => s.id === scriptId);
    if (script == null) return;
    if (
      !this.state.isCodeChanged ||
      confirm("This will replace the code you've written. Continue?")
    ) {
      this.setState({ isLoading: true });
      const content = await fetchGistContent(script.gist, script.name);
      this.setState({
        isLoading: false,
        selectedScript: scriptId,
        code: content,
        isCodeChanged: false
      });
    }
  };

  handleClick = () => {
    try {
      eval(this.state.code);
      // close modal if the script executed successfully
      return this.props.onClose();
    } catch (error) {
      console.error(error);
      return alert(error);
    }
  };

  render() {
    return (
      <Modal
        visible={this.props.visible}
        title="Add user script"
        okText="Add"
        cancelText="Close"
        onOk={this.handleClick}
        onCancel={this.props.onClose}
      >
        <Spin spinning={this.state.isLoading}>
          <Select
            value={this.state.selectedScript}
            style={{ width: 200, "margin-bottom": 10 }}
            onChange={this.handleScriptChange}
            placeholder="Select an existing user script"
          >
            {this.state.scripts.map(script =>
              <Select.Option key={script.id} value={script.id}>
                {script.name}
              </Select.Option>
            )}
          </Select>
          <Input
            type="textarea"
            rows={15}
            onChange={this.handleCodeChange}
            value={this.state.code}
          />
        </Spin>
      </Modal>
    );
  }
}

export default UserScriptsModalView;
