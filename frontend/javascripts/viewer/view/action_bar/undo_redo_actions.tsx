import Icon from "@ant-design/icons";
import RedoIcon from "@images/icons/icon-redo.svg?react";
import UndoIcon from "@images/icons/icon-undo.svg?react";
import { Space } from "antd";
import classnames from "classnames";
import { AsyncButton } from "components/async_clickables";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { dispatchRedoAsync, dispatchUndoAsync } from "viewer/model/actions/save_actions";
import { isBigWarpWorker } from "viewer/view/align_datasets/bigwarp_protocol";
import { NARROW_BUTTON_STYLE } from "./tools/tool_helpers";

type Props = {
  hasTracing: boolean;
  isBusy: boolean;
};

function UndoRedoActions({ hasTracing, isBusy }: Props) {
  const dispatch = useDispatch();
  // The dataset alignment workers are always narrow (two of them share the window), but
  // their toolbar is small enough to fit the redo button.
  const hideRedoOnSmallScreen = !isBigWarpWorker();

  const handleUndo = useCallback(() => dispatchUndoAsync(dispatch), [dispatch]);
  const handleRedo = useCallback(() => dispatchRedoAsync(dispatch), [dispatch]);

  if (!hasTracing) {
    return null;
  }

  return (
    <Space.Compact>
      <AsyncButton
        className="undo-redo-button"
        key="undo-button"
        title="Undo (Ctrl+Z)"
        onClick={handleUndo}
        disabled={isBusy}
        hideContentWhenLoading
        style={NARROW_BUTTON_STYLE}
        icon={<Icon component={UndoIcon} aria-label="undo" />}
      />
      <AsyncButton
        className={classnames("undo-redo-button", {
          "hide-on-small-screen": hideRedoOnSmallScreen,
        })}
        key="redo-button"
        title="Redo (Ctrl+Y)"
        onClick={handleRedo}
        disabled={isBusy}
        hideContentWhenLoading
        style={NARROW_BUTTON_STYLE}
        icon={<Icon component={RedoIcon} aria-label="redo" />}
      />
    </Space.Compact>
  );
}

export default UndoRedoActions;
