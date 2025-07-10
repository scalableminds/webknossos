import { AsyncButton } from "components/async_clickables";
import * as React from "react";
import { dispatchRedoAsync, dispatchUndoAsync } from "viewer/model/actions/save_actions";
import Store from "viewer/store";

const handleUndo = () => dispatchUndoAsync(Store.dispatch);
const handleRedo = () => dispatchRedoAsync(Store.dispatch);

type Props = {
    hasTracing: boolean;
    isBusy: boolean;
}

function UndoRedoActions({ hasTracing, isBusy }: Props) {
    if (!hasTracing) {
        return null;
    }

    return (
        <>
            <AsyncButton
                className="narrow undo-redo-button"
                key="undo-button"
                title="Undo (Ctrl+Z)"
                onClick={handleUndo}
                disabled={isBusy}
                hideContentWhenLoading
            >
                <i className="fas fa-undo" aria-hidden="true" />
            </AsyncButton>
            <AsyncButton
                className="narrow undo-redo-button hide-on-small-screen"
                key="redo-button"
                title="Redo (Ctrl+Y)"
                onClick={handleRedo}
                disabled={isBusy}
                hideContentWhenLoading
            >
                <i className="fas fa-redo" aria-hidden="true" />
            </AsyncButton>
        </>
    );
}

export default UndoRedoActions;
