import Icon from "@ant-design/icons";
import RedoIcon from "@images/icons/icon-redo.svg?react";
import UndoIcon from "@images/icons/icon-undo.svg?react";
import { Space } from "antd";
import { AsyncButton } from "components/async_clickables";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { dispatchRedoAsync, dispatchUndoAsync } from "viewer/model/actions/save_actions";

type Props = {
  hasTracing: boolean;
  isBusy: boolean;
};

function UndoRedoActions({ hasTracing, isBusy }: Props) {
  const dispatch = useDispatch();

  const handleUndo = useCallback(() => dispatchUndoAsync(dispatch), [dispatch]);
  const handleRedo = useCallback(() => dispatchRedoAsync(dispatch), [dispatch]);

  if (!hasTracing) {
    return null;
  }

  return (
    <Space.Compact>
      <AsyncButton
        className="narrow undo-redo-button"
        key="undo-button"
        title="Undo (Ctrl+Z)"
        onClick={handleUndo}
        disabled={isBusy}
        hideContentWhenLoading
        icon={<Icon component={UndoIcon} aria-label="undo" />}
      />
      <AsyncButton
        className="narrow undo-redo-button hide-on-small-screen"
        key="redo-button"
        title="Redo (Ctrl+Y)"
        onClick={handleRedo}
        disabled={isBusy}
        hideContentWhenLoading
        icon={<Icon component={RedoIcon} aria-label="redo" />}
      />
    </Space.Compact>
  );
}

export default UndoRedoActions;
