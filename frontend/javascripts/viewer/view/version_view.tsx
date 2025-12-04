import { CloseOutlined } from "@ant-design/icons";
import { Alert, Button } from "antd";
import * as React from "react";
import VersionList, { handleCloseRestoreView } from "viewer/view/version_list";

export type Versions = {
  skeleton?: number | null | undefined;
  volumes?: Record<string, number>;
};

function VersionView() {
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
          onClick={handleCloseRestoreView}
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
        <VersionList />
      </div>
    </div>
  );
}

export default VersionView;
