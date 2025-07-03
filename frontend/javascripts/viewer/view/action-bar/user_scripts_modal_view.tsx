/* eslint-disable no-eval */
import { Input, Modal, Select, Spin } from "antd";
import { handleGenericError } from "libs/error_handling";
import { fetchGistContent } from "libs/gist";
import { makeComponentLazy, useGuardedFetch } from "libs/react_helpers";
import Request from "libs/request";
import { alert } from "libs/window";
import messages from "messages";
import type React from "react";
import { memo, useCallback, useState } from "react";
import type { Script } from "viewer/store";

const { TextArea } = Input;

type UserScriptsModalViewProps = {
  onOK: (...args: Array<any>) => any;
  isOpen: boolean;
};

const _UserScriptsModalView: React.FC<UserScriptsModalViewProps> = ({ onOK, isOpen }) => {
  const [code, setCode] = useState("");
  const [isCodeChanged, setIsCodeChanged] = useState(false);
  // Needs to be undefined so the placeholder is displayed in the beginning
  const [selectedScript, setSelectedScript] = useState<string | null | undefined>(undefined);
  const [isLoadingScriptContent, setIsLoadingScriptContent] = useState(false);

  const [scripts, isLoadingScripts] = useGuardedFetch<Script[]>(
    () => Request.receiveJSON("/api/scripts", { showErrorToast: false }),
    [],
    [],
    "Could not load user scripts.",
  );

  const handleCodeChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCode(event.target.value);
    setIsCodeChanged(true);
  }, []);

  const loadScript = useCallback(async (script: Script) => {
    try {
      setIsLoadingScriptContent(true);
      const content = await fetchGistContent(script.gist, script.name);
      setSelectedScript(script.id);
      setCode(content);
      setIsCodeChanged(false);
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      setIsLoadingScriptContent(false);
    }
  }, []);

  const handleScriptChange = useCallback(
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

  const handleClick = useCallback(() => {
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

  const isLoading = isLoadingScripts || isLoadingScriptContent;

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

const UserScriptsModalView = makeComponentLazy(memo(_UserScriptsModalView));

export default UserScriptsModalView;
