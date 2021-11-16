// @flow

import { Button, Alert, Tabs } from "antd";
import { connect } from "react-redux";
import * as React from "react";

import { setAnnotationAllowUpdateAction } from "oxalis/model/actions/annotation_actions";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import Store, { type OxalisState, type Tracing } from "oxalis/store";
import VersionList, { previewVersion } from "oxalis/view/version_list";
import { CloseOutlined } from "@ant-design/icons";

const { TabPane } = Tabs;

export type Versions = {
  skeleton?: ?number,
  volumes?: { [tracingId: string]: number },
};

type StateProps = {|
  tracing: Tracing,
|};
type OwnProps = {|
  allowUpdate: boolean,
|};
type Props = {| ...StateProps, ...OwnProps |};

type State = {
  activeTracingType: "skeleton" | "volume",
  initialAllowUpdate: boolean,
};

class VersionView extends React.Component<Props, State> {
  state = {
    activeTracingType: this.props.tracing.skeleton != null ? "skeleton" : "volume",
    // Remember whether the tracing could originally be updated
    initialAllowUpdate: this.props.allowUpdate,
  };

  componentWillUnmount() {
    Store.dispatch(setAnnotationAllowUpdateAction(this.state.initialAllowUpdate));
  }

  handleClose = async () => {
    // This will load the newest version of both skeleton and volume tracings
    await previewVersion();
    Store.dispatch(setVersionRestoreVisibilityAction(false));
    Store.dispatch(setAnnotationAllowUpdateAction(this.state.initialAllowUpdate));
  };

  onChangeTab = (activeKey: "skeleton" | "volume") => {
    this.setState({
      activeTracingType: activeKey,
    });
  };

  render() {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ flex: "0 1 auto", padding: "0px 5px" }}>
          <h4 style={{ display: "inline-block" }}>Version History</h4>
          <Button
            className="close-button"
            style={{ float: "right", border: 0 }}
            onClick={this.handleClose}
            shape="circle"
            icon={<CloseOutlined />}
          />
          <div style={{ fontSize: 12, marginBottom: 8 }}>
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
        <div style={{ flex: "1 1 auto", overflowY: "auto", paddingLeft: 2 }}>
          <Tabs onChange={this.onChangeTab} activeKey={this.state.activeTracingType}>
            {this.props.tracing.skeleton != null ? (
              <TabPane tab="Skeleton" key="skeleton">
                <VersionList
                  tracingType="skeleton"
                  tracing={this.props.tracing.skeleton}
                  allowUpdate={this.state.initialAllowUpdate}
                />
              </TabPane>
            ) : null}
            {this.props.tracing.volumes.map((volumeTracing, index) => (
              <TabPane tab={`Volume ${index + 1}`} key={volumeTracing.tracingId}>
                <VersionList
                  tracingType="volume"
                  tracing={volumeTracing}
                  allowUpdate={this.state.initialAllowUpdate}
                />
              </TabPane>
            ))}
          </Tabs>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState): StateProps {
  return {
    tracing: state.tracing,
  };
}

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(VersionView);
