import Icon from "@ant-design/icons";
import RedoIcon from "@images/icons/icon-redo.svg?react";
import UndoIcon from "@images/icons/icon-undo.svg?react";
import { Space } from "antd";
import { AsyncButton } from "components/async_clickables";
import { useWkSelector } from "libs/react_hooks";
import messages from "messages";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { isConcurrentCollaborationMode } from "viewer/model/accessors/annotation_accessor";
import { dispatchRedoAsync, dispatchUndoAsync } from "viewer/model/actions/save_actions";
import { NARROW_BUTTON_STYLE } from "./tools/tool_helpers";

type Props = {
  hasTracing: boolean;
  isBusy: boolean;
};

function UndoRedoActions({ hasTracing, isBusy }: Props) {
  const dispatch = useDispatch();
  // Undo/redo is not supported in live collaboration (see undo_saga).
  const isLiveCollaboration = useWkSelector(isConcurrentCollaborationMode);

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
        title={isLiveCollaboration ? messages["undo.no_undo_in_live_collab"] : "Undo (Ctrl+Z)"}
        onClick={handleUndo}
        disabled={isBusy || isLiveCollaboration}
        hideContentWhenLoading
        style={NARROW_BUTTON_STYLE}
        icon={<Icon component={UndoIcon} aria-label="undo" />}
      />
      <AsyncButton
        className="undo-redo-button hide-on-small-screen"
        key="redo-button"
        title={isLiveCollaboration ? messages["undo.no_undo_in_live_collab"] : "Redo (Ctrl+Y)"}
        onClick={handleRedo}
        disabled={isBusy || isLiveCollaboration}
        hideContentWhenLoading
        style={NARROW_BUTTON_STYLE}
        icon={<Icon component={RedoIcon} aria-label="redo" />}
      />
    </Space.Compact>
  );
}

export default UndoRedoActions;
