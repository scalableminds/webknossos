// @flow

/* eslint-disable no-eval, no-alert */
import React from "react";
import { Modal, Input, Select, Spin } from "antd";
import Request from "libs/request";
import { fetchGistContent } from "libs/gist";
import messages from "messages";
import type { ScriptType } from "oxalis/store";

type UserScriptsModalViewPropsType = {
  onOK: Function,
  isVisible: boolean,
};

class UserScriptsModalView extends React.PureComponent {
  props: UserScriptsModalViewPropsType;

  state: {
    code: string,
    isCodeChanged: boolean,
    scripts: Array<ScriptType>,
    selectedScript: ?string,
    isLoading: boolean,
  } = {
    code: "",
    isCodeChanged: false,
    scripts: [],
    // Needs to be undefined so the placeholder is displayed in the beginning
    selectedScript: undefined,
    isLoading: true,
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
      isCodeChanged: true,
    });
  };

  handleScriptChange = async (scriptId: string) => {
    const script = this.state.scripts.find(s => s.id === scriptId);
    if (script == null) return;
    if (!this.state.isCodeChanged) {
      this.loadScript(script);
    } else {
      Modal.confirm({
        content: messages["add_script.confirm_change"],
        onOk: () => this.loadScript(script),
      });
    }
  };

  loadScript = async (script: ScriptType) => {
    this.setState({ isLoading: true });
    const content = await fetchGistContent(script.gist, script.name);
    this.setState({
      isLoading: false,
      selectedScript: script.id,
      code: content,
      isCodeChanged: false,
    });
  };

  handleClick = () => {
    try {
      eval(this.state.code);
      // close modal if the script executed successfully
      return this.props.onOK();
    } catch (error) {
      console.error(error);
      return alert(error);
    }
  };

  render() {
    return (
      <Modal
        visible={this.props.isVisible}
        title="Add User Script"
        okText="Add"
        cancelText="Close"
        onOk={this.handleClick}
        onCancel={this.props.onOK}
      >
        <Spin spinning={this.state.isLoading}>
          <Select
            value={this.state.isCodeChanged ? "Modified Script" : this.state.selectedScript}
            style={{ width: 200, marginBottom: 10 }}
            onChange={this.handleScriptChange}
            placeholder="Select an existing user script"
          >
            {this.state.scripts.map(script =>
              <Select.Option key={script.id} value={script.id}>
                {script.name}
              </Select.Option>,
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
