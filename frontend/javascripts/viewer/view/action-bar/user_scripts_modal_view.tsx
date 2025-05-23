/* eslint-disable no-eval */
import { Input, Modal, Select, Spin } from "antd";
import { handleGenericError } from "libs/error_handling";
import { fetchGistContent } from "libs/gist";
import { makeComponentLazy } from "libs/react_helpers";
import Request from "libs/request";
import { alert } from "libs/window";
import messages from "messages";
import * as React from "react";
import type { Script } from "viewer/store";

const { TextArea } = Input;

type UserScriptsModalViewProps = {
  onOK: (...args: Array<any>) => any;
  isOpen: boolean;
};
type State = {
  code: string;
  isCodeChanged: boolean;
  scripts: Array<Script>;
  selectedScript: string | null | undefined;
  isLoading: boolean;
};

class _UserScriptsModalView extends React.PureComponent<UserScriptsModalViewProps, State> {
  state: State = {
    code: "",
    isCodeChanged: false,
    scripts: [],
    // Needs to be undefined so the placeholder is displayed in the beginning
    selectedScript: undefined,
    isLoading: true,
  };

  componentDidMount() {
    this.fetchData();
  }

  fetchData() {
    Request.receiveJSON("/api/scripts", {
      showErrorToast: false,
    })
      .then((scripts) => {
        this.setState({
          isLoading: false,
        });

        if (scripts.length) {
          this.setState({
            scripts,
          });
        }
      })
      .catch((e) => {
        console.error(e);
        this.setState({
          isLoading: false,
        });
      });
  }

  handleCodeChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    this.setState({
      code: event.target.value,
      isCodeChanged: true,
    });
  };

  handleScriptChange = async (scriptId: string) => {
    const script = this.state.scripts.find((s) => s.id === scriptId);
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

  loadScript = async (script: Script) => {
    try {
      this.setState({
        isLoading: true,
      });
      const content = await fetchGistContent(script.gist, script.name);
      this.setState({
        selectedScript: script.id,
        code: content,
        isCodeChanged: false,
      });
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      this.setState({
        isLoading: false,
      });
    }
  };

  handleClick = () => {
    try {
      // biome-ignore lint/security/noGlobalEval: Loads a user provided frontend API script.
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
        open={this.props.isOpen}
        title="Add User Script"
        okText="Add"
        cancelText="Close"
        onOk={this.handleClick}
        onCancel={this.props.onOK}
      >
        <Spin spinning={this.state.isLoading}>
          <Select
            value={this.state.isCodeChanged ? "Modified Script" : this.state.selectedScript}
            style={{
              width: 200,
              marginBottom: 10,
            }}
            onChange={this.handleScriptChange}
            placeholder="Select an existing user script"
            options={this.state.scripts.map((script) => ({
              value: script.id,
              label: script.name,
            }))}
          />
          <TextArea
            rows={15}
            onChange={this.handleCodeChange}
            value={this.state.code}
            placeholder="Choose an existing user script from the dropdown above or add WEBKNOSSOS frontend script code here"
          />
        </Spin>
      </Modal>
    );
  }
}

const UserScriptsModalView = makeComponentLazy(_UserScriptsModalView);

export default UserScriptsModalView;
