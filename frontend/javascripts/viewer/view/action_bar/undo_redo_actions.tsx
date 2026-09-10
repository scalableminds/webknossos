import Icon from "@ant-design/icons";
import RedoIcon from "@images/icons/icon-redo.svg?react";
import UndoIcon from "@images/icons/icon-undo.svg?react";
import { Space } from "antd";
import { AsyncButton } from "components/async_clickables";
import { hasUrlParam } from "libs/utils";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { dispatchRedoAsync, dispatchUndoAsync } from "viewer/model/actions/save_actions";
import { NARROW_BUTTON_STYLE } from "./tools/tool_helpers";

type Props = {
  hasTracing: boolean;
  isBusy: boolean;
};

function UndoRedoActions({ hasTracing, isBusy }: Props) {
  const dispatch = useDispatch();
  // A BigWarp-style alignment worker's iframe is by construction narrower than
  // "hide-on-small-screen"'s 1200px breakpoint (two of them share the window), so redo
  // would be permanently unreachable there. Its toolbar is stripped down to just the
  // landmark-clicking essentials though, so there is plenty of room for both buttons.
  // See BIGWARP_ALIGNMENT_PLAN.md §0.20.
  const isBigWarpWorker = hasUrlParam("bigwarpWorker");

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
        className={`undo-redo-button${isBigWarpWorker ? "" : " hide-on-small-screen"}`}
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
