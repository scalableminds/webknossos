import { Checkbox, Modal } from "antd";
import type { CheckboxChangeEvent } from "antd/lib/checkbox";
import messages from "messages";
import type React from "react";
import { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";

type Props = {
  onOk: (...args: Array<any>) => any;
  destroy?: (...args: Array<any>) => any;
};

const TreeRemovalModal: React.FC<Props> = ({ onOk, destroy }) => {
  const [shouldNotWarnAgain, setShouldNotWarnAgain] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const dispatch = useDispatch();

  const handleCheckboxChange = useCallback((event: CheckboxChangeEvent) => {
    setShouldNotWarnAgain(event.target.checked);
  }, []);

  const hide = useCallback(() => {
    setIsOpen(false);
    if (destroy) destroy();
  }, [destroy]);

  const handleOk = useCallback(() => {
    dispatch(updateUserSettingAction("hideTreeRemovalWarning", shouldNotWarnAgain));
    onOk();
    hide();
  }, [shouldNotWarnAgain, onOk, hide, dispatch]);

  return (
    <Modal title={messages["tracing.delete_tree"]} onOk={handleOk} onCancel={hide} open={isOpen}>
      <Checkbox onChange={handleCheckboxChange} checked={shouldNotWarnAgain}>
        Do not warn me again. (Remember, accidentally deleted trees can always be restored using the
        Undo functionality (Ctrl/Cmd + Z)).
      </Checkbox>
    </Modal>
  );
};

export default TreeRemovalModal;
