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
import VersionView from "oxalis/view/version_view";
import { Layout, Icon } from "antd";
import { location } from "libs/window";
import { withRouter } from "react-router-dom";
import Toast from "libs/toast";
import messages from "messages";
import ButtonComponent from "oxalis/view/components/button_component";
import { connect } from "react-redux";
import CommentTabView from "oxalis/view/right-menu/comment_tab/comment_tab_view";
import AbstractTreeTabView from "oxalis/view/right-menu/abstract_tree_tab_view";
import TreesTabView, { importNmls } from "oxalis/view/right-menu/trees_tab_view";
import MappingInfoView from "oxalis/view/right-menu/mapping_info_view";
import DatasetInfoTabView from "oxalis/view/right-menu/dataset_info_tab_view";
import InputCatcher, { recalculateInputCatcherSizes } from "oxalis/view/input_catcher";
import { ArbitraryViewport, OrthoViews } from "oxalis/constants";
import type { OxalisState, TracingTypeTracing } from "oxalis/store";
import type { ControlMode, Mode } from "oxalis/constants";
import RecordingSwitch from "oxalis/view/recording_switch";
import TDViewControls from "oxalis/view/td_view_controls";
import NmlUploadZoneContainer from "oxalis/view/nml_upload_zone_container";
import { GoldenLayoutAdapter } from "./golden_layout_adapter";
import { getLayoutConfig, storeLayoutConfig } from "./layout_persistence";
import { determineLayout } from "./default_layout_configs";

const { Header, Sider } = Layout;

type StateProps = {
  viewMode: Mode,
  displayScalebars: boolean,
  isUpdateTracingAllowed: boolean,
  showVersionRestore: boolean,
};

type Props = StateProps & {
  initialTracingType: TracingTypeTracing,
  initialAnnotationId: string,
  initialControlmode: ControlMode,
};

type State = {
  isSettingsCollapsed: boolean,
};

const canvasAndLayoutContainerID = "canvasAndLayoutContainer";
export function getDesiredCanvasSize(): Maybe<[number, number]> {
  // const canvasAndLayoutContainer = document.getElementById(canvasAndLayoutContainerID);
  const canvasAndLayoutContainer = document.querySelector("#layoutContainer");

  if (canvasAndLayoutContainer) {
    const { scrollWidth, scrollHeight } = canvasAndLayoutContainer;
    return Maybe.Just([scrollWidth, scrollHeight]);
  }
  return Maybe.Nothing();
}

const GOLDEN_LAYOUT_ADAPTER_STYLE = {
  display: "block",
  height: "100%",
  width: "100%",
  flex: "1 1 auto",
};

class TracingLayoutView extends React.PureComponent<Props, State> {
  state = {
    isSettingsCollapsed: true,
  };

  componentDidCatch() {
    Toast.error(messages["react.rendering_error"]);
  }

  componentWillUnmount() {
    // do a complete page refresh to make sure all tracing data is garbage
    // collected and all events are canceled, etc.
    location.reload();
  }

  handleSettingsCollapse = () => {
    this.setState(prevState => ({
      isSettingsCollapsed: !prevState.isSettingsCollapsed,
    }));
  };

  onLayoutChange = (layoutConfig, layoutKey) => {
    recalculateInputCatcherSizes();
    window.needsRerender = true;
    storeLayoutConfig(layoutConfig, layoutKey);
  };

  render() {
    const layoutType = determineLayout(this.props.initialControlmode, this.props.viewMode);
    const { displayScalebars } = this.props;

    return (
      <NmlUploadZoneContainer onImport={importNmls} isAllowed={this.props.isUpdateTracingAllowed}>
        <OxalisController
          initialTracingType={this.props.initialTracingType}
          initialAnnotationId={this.props.initialAnnotationId}
          initialControlmode={this.props.initialControlmode}
        />

        <Layout className="tracing-layout">
          <Header style={{ flex: "0 1 auto", zIndex: 210, minHeight: 46 }}>
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

            <div id={canvasAndLayoutContainerID} style={{ position: "relative" }}>
              <TracingView />
              <GoldenLayoutAdapter
                id="layoutContainer"
                style={GOLDEN_LAYOUT_ADAPTER_STYLE}
                layoutKey={layoutType}
                layoutConfigGetter={getLayoutConfig}
                onLayoutChange={this.onLayoutChange}
              >
                {/*
                   * All possible layout panes are passed here. Depending on the actual layout,
                   *  the components are rendered or not.
                   */}
                <InputCatcher
                  viewportID={OrthoViews.PLANE_XY}
                  key="xy"
                  portalKey="xy"
                  displayScalebars={displayScalebars}
                />
                <InputCatcher
                  viewportID={OrthoViews.PLANE_YZ}
                  key="yz"
                  portalKey="yz"
                  displayScalebars={displayScalebars}
                />
                <InputCatcher
                  viewportID={OrthoViews.PLANE_XZ}
                  key="xz"
                  portalKey="xz"
                  displayScalebars={displayScalebars}
                />
                <InputCatcher viewportID={OrthoViews.TDView} key="td" portalKey="td">
                  <TDViewControls />
                </InputCatcher>

                <InputCatcher
                  viewportID={ArbitraryViewport}
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
            {this.props.showVersionRestore ? (
              <Sider id="version-restore-sider" width={400}>
                <VersionView />
              </Sider>
            ) : null}
          </Layout>
        </Layout>
      </NmlUploadZoneContainer>
    );
  }
}

function mapStateToProps(state: OxalisState): StateProps {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
    displayScalebars: state.userConfiguration.displayScalebars,
    isUpdateTracingAllowed: state.tracing.restrictions.allowUpdate,
    showVersionRestore: state.uiInformation.showVersionRestore,
  };
}

export default connect(mapStateToProps)(withRouter(TracingLayoutView));
