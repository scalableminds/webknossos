/**
 * tracing_layout_view.js
 * @flow
 */

import * as React from "react";
import Maybe from "data.maybe";
import OxalisController from "oxalis/controller";
import SettingsView from "oxalis/view/settings/settings_view";
import ActionBarView from "oxalis/view/action_bar_view";
import TracingView from "oxalis/view/tracing_view";
import { Layout, Icon } from "antd";
import { location } from "libs/window";
import { withRouter } from "react-router-dom";
import ButtonComponent from "oxalis/view/components/button_component";
import { connect } from "react-redux";
import CommentTabView from "oxalis/view/right-menu/comment_tab/comment_tab_view";
import AbstractTreeTabView from "oxalis/view/right-menu/abstract_tree_tab_view";
import TreesTabView from "oxalis/view/right-menu/trees_tab_view";
import MappingInfoView from "oxalis/view/right-menu/mapping_info_view";
import DatasetInfoTabView from "oxalis/view/right-menu/dataset_info_tab_view";
import InputCatcher from "oxalis/view/input_catcher";
import { OrthoViews } from "oxalis/constants";
import type { OxalisState, TracingTypeTracingType } from "oxalis/store";
import type { ControlModeType, ModeType } from "oxalis/constants";
import RecordingSwitch from "oxalis/view/recording_switch";
import TDViewControls from "oxalis/view/td_view_controls";
import GoldenLayoutAdapter from "./golden_layout_adapter";
import { getLayoutConfig, storeLayoutConfig } from "./layout_persistence";
import { determineLayout } from "./default_layout_configs";

const { Header, Sider } = Layout;

type StateProps = {
  viewMode: ModeType,
};

type Props = StateProps & {
  initialTracingType: TracingTypeTracingType,
  initialAnnotationId: string,
  initialControlmode: ControlModeType,
};

type State = {
  isSettingsCollapsed: boolean,
};

const canvasAndLayoutContainerID = "canvasAndLayoutContainer";
export function getDesiredCanvasSize(): Maybe<[number, number]> {
  const canvasAndLayoutContainer = document.getElementById(canvasAndLayoutContainerID);
  if (canvasAndLayoutContainer) {
    const { width, height } = canvasAndLayoutContainer.getBoundingClientRect();
    return Maybe.Just([width, height]);
  }
  return Maybe.Nothing();
}

class TracingLayoutView extends React.PureComponent<Props, State> {
  state = {
    isSettingsCollapsed: true,
  };

  componentWillUnmount() {
    // do a complete page refresh to make sure all tracing data is garbage
    // collected and all events are canceled, etc.
    location.reload();
  }

  handleSettingsCollapse = () => {
    this.setState({
      isSettingsCollapsed: !this.state.isSettingsCollapsed,
    });
  };

  render() {
    const layoutType = determineLayout(this.props.initialControlmode, this.props.viewMode);

    return (
      <div>
        <OxalisController
          initialTracingType={this.props.initialTracingType}
          initialAnnotationId={this.props.initialAnnotationId}
          initialControlmode={this.props.initialControlmode}
        />

        <Layout className="tracing-layout">
          <Header style={{ flex: "0 1 auto", zIndex: 210, minHeight: 48 }}>
            <ButtonComponent onClick={this.handleSettingsCollapse}>
              <Icon type={this.state.isSettingsCollapsed ? "menu-unfold" : "menu-fold"} />
              <span className="hide-on-small-screen">Settings</span>
            </ButtonComponent>
            <ActionBarView />
          </Header>
          <Layout style={{ display: "flex" }}>
            <Sider
              collapsible
              trigger={null}
              collapsed={this.state.isSettingsCollapsed}
              collapsedWidth={0}
              width={350}
              style={{ zIndex: 100 }}
            >
              <SettingsView />
            </Sider>

            <div
              id={canvasAndLayoutContainerID}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: "1 1 auto",
                position: "relative",
              }}
            >
              <TracingView />
              <GoldenLayoutAdapter
                id="layoutContainer"
                style={{ display: "block", height: "100%", width: "100%", flex: "1 1 auto" }}
                layoutKey={layoutType}
                layoutConfigGetter={getLayoutConfig}
                onLayoutChange={(layoutConfig, layoutKey) => {
                  window.needsRerender = true;
                  storeLayoutConfig(layoutConfig, layoutKey);
                }}
              >
                {/*
                   * All possible layout panes are passed here. Depending on the actual layout,
                   *  the components are rendered or not.
                   */}
                <InputCatcher viewportID={OrthoViews.PLANE_XY} key="xy" portalKey="xy" />
                <InputCatcher viewportID={OrthoViews.PLANE_YZ} key="yz" portalKey="yz" />
                <InputCatcher viewportID={OrthoViews.PLANE_XZ} key="xz" portalKey="xz" />
                <InputCatcher viewportID={OrthoViews.TDView} key="td" portalKey="td">
                  <TDViewControls />
                </InputCatcher>

                <InputCatcher
                  viewportID="arbitraryViewport"
                  key="arbitraryViewport"
                  portalKey="arbitraryViewport"
                >
                  <RecordingSwitch />
                </InputCatcher>

                <DatasetInfoTabView key="DatasetInfoTabView" portalKey="DatasetInfoTabView" />
                <TreesTabView key="TreesTabView" portalKey="TreesTabView" />
                <CommentTabView key="CommentTabView" portalKey="CommentTabView" />
                <AbstractTreeTabView key="AbstractTreeTabView" portalKey="AbstractTreeTabView" />
                <MappingInfoView key="MappingInfoView" portalKey="MappingInfoView" />
              </GoldenLayoutAdapter>
            </div>
          </Layout>
        </Layout>
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState): StateProps {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
  };
}

export default connect(mapStateToProps)(withRouter(TracingLayoutView));
