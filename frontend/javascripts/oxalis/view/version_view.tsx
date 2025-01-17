import { CloseOutlined } from "@ant-design/icons";
import { Alert, Button } from "antd";
import { useWillUnmount } from "beautiful-react-hooks";
import { setAnnotationAllowUpdateAction } from "oxalis/model/actions/annotation_actions";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import VersionList, { previewVersion } from "oxalis/view/version_list";
import * as React from "react";
import { useEffect } from "react";
import { useSelector } from "react-redux";

export type Versions = {
  skeleton?: number | null | undefined;
  volumes?: Record<string, number>;
};

function VersionView() {
  const initialAllowUpdate = useSelector(
    (state: OxalisState) => state.tracing.restrictions.initialAllowUpdate,
  );
  useEffect(() => {
    Store.dispatch(setAnnotationAllowUpdateAction(false));
  }, []);

  useWillUnmount(() => {
    Store.dispatch(setAnnotationAllowUpdateAction(initialAllowUpdate));
  });

  const handleClose = async () => {
    // This will load the newest version of both skeleton and volume tracings
    await previewVersion();
    Store.dispatch(setVersionRestoreVisibilityAction(false));
    Store.dispatch(setAnnotationAllowUpdateAction(initialAllowUpdate));
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div
        style={{
          flex: "0 1 auto",
          padding: "0px 5px",
        }}
      >
        <h4
          style={{
            display: "inline-block",
            marginLeft: 4,
          }}
        >
          Version History
        </h4>
        <Button
          className="close-button"
          style={{
            float: "right",
            border: 0,
          }}
          onClick={handleClose}
          shape="circle"
          icon={<CloseOutlined />}
        />
        <div
          style={{
            fontSize: 12,
            marginBottom: 8,
          }}
        >
          <Alert
            type="info"
            message={
              <React.Fragment>
                You are currently previewing older versions of this annotation. Either restore a
                version by selecting it or close this view to continue annotating. The shown
                annotation is in <b>read-only</b> mode as long as this view is opened.
              </React.Fragment>
            }
          />
        </div>
      </div>
      <div
        style={{
          flex: "1 1 auto",
          overflowY: "auto",
          paddingLeft: 2,
        }}
      >
        <VersionList allowUpdate={initialAllowUpdate} />
      </div>
    </div>
  );
}

export default VersionView;
