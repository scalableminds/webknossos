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

const _UserScriptsModalView: React.FC<UserScriptsModalViewProps> = ({ onOK, isOpen }) => {
  const [code, setCode] = React.useState("");
  const [isCodeChanged, setIsCodeChanged] = React.useState(false);
  const [scripts, setScripts] = React.useState<Script[]>([]);
  const [selectedScript, setSelectedScript] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    Request.receiveJSON("/api/scripts", {
      showErrorToast: false,
    })
      .then((scripts) => {
        setIsLoading(false);

        if (scripts.length) {
          setScripts(scripts);
        }
      })
      .catch((e) => {
        console.error(e);
        setIsLoading(false);
      });
  }, []);

  const handleCodeChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCode(event.target.value);
    setIsCodeChanged(true);
  }, []);

  const loadScript = React.useCallback(async (script: Script) => {
    try {
      setIsLoading(true);
      const content = await fetchGistContent(script.gist, script.name);
      setSelectedScript(script.id);
      setCode(content);
      setIsCodeChanged(false);
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleScriptChange = React.useCallback(
    async (scriptId: string) => {
      const script = scripts.find((s) => s.id === scriptId);
      if (script == null) return;

      if (!isCodeChanged) {
        void loadScript(script);
      } else {
        Modal.confirm({
          content: messages["add_script.confirm_change"],
          onOk: () => loadScript(script),
        });
      }
    },
    [scripts, isCodeChanged, loadScript],
  );

  const handleClick = React.useCallback(() => {
    try {
      // biome-ignore lint/security/noGlobalEval: Loads a user provided frontend API script.
      eval(code);
      // close modal if the script executed successfully
      return onOK();
    } catch (error) {
      console.error(error);
      return alert(error);
    }
  }, [code, onOK]);

  return (
    <Modal
      open={isOpen}
      title="Add User Script"
      okText="Add"
      cancelText="Close"
      onOk={handleClick}
      onCancel={onOK}
    >
      <Spin spinning={isLoading}>
        <Select
          value={isCodeChanged ? "Modified Script" : selectedScript}
          style={{
            width: 200,
            marginBottom: 10,
          }}
          onChange={handleScriptChange}
          placeholder="Select an existing user script"
          options={scripts.map((script) => ({
            value: script.id,
            label: script.name,
          }))}
        />
        <TextArea
          rows={15}
          onChange={handleCodeChange}
          value={code}
          placeholder="Choose an existing user script from the dropdown above or add WEBKNOSSOS frontend script code here"
        />
      </Spin>
    </Modal>
  );
};

const UserScriptsModalView = makeComponentLazy(React.memo(_UserScriptsModalView));

export default UserScriptsModalView;
