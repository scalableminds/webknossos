/**
 * tracing_layout_view.js
 * @flow
 */

import * as React from "react";
import ReactDOM from "react-dom";
import OxalisController from "oxalis/controller";
import SettingsView from "oxalis/view/settings/settings_view";
import ActionBarView from "oxalis/view/action_bar_view";
import RightMenuView from "oxalis/view/right_menu_view";
import TracingView from "oxalis/view/tracing_view";
import { Layout, Icon, Row, Grid } from "antd";
import { location } from "libs/window";
import { withRouter } from "react-router-dom";
import ButtonComponent from "oxalis/view/components/button_component";
import { Provider, connect } from "react-redux";
import CommentTabView from "oxalis/view/right-menu/comment_tab/comment_tab_view";
import AbstractTreeTabView from "oxalis/view/right-menu/abstract_tree_tab_view";
import TreesTabView from "oxalis/view/right-menu/trees_tab_view";
import MappingInfoView from "oxalis/view/right-menu/mapping_info_view";
import DatasetInfoTabView from "oxalis/view/right-menu/dataset_info_tab_view";
import InputCatchers from "oxalis/view/input_catchers";

import Store from "oxalis/store";
import type { PlaneLayoutType, TracingTypeTracingType } from "oxalis/store";
import type { ControlModeType } from "oxalis/constants";

import GoldenLayout from "golden-layout/dist/goldenlayout.js";
import "golden-layout/src/css/goldenlayout-base.css";
import "golden-layout/src/css/goldenlayout-light-theme.css";

const { Header, Sider } = Layout;

type StateProps = {
  activePlaneLayout: PlaneLayoutType,
};

type Props = {
  ...StateProps,
  initialTracingType: TracingTypeTracingType,
  initialAnnotationId: string,
  initialControlmode: ControlModeType,
};

type State = {
  isSettingsCollapsed: boolean,
};

// Renders the provided children into a portal (referenced by id) if that portal exists
function RenderToPortal({ children, portalId }) {
  const portalEl = document.getElementById(`myPortal-${portalId}`);
  return portalEl && ReactDOM.createPortal(children, portalEl);
}

class PortalTarget extends React.Component {
  render() {
    return <div id={`myPortal-${this.props.portalId}`} />;
  }
}

const DefaultLayoutConfig = {
  settings: {
    showPopoutIcon: false,
    showCloseIcon: false,
    showMaximiseIcon: false,
  },
  content: [
    {
      type: "row",
      content: [
        {
          type: "row",
          content: [
            {
              type: "column",
              content: [
                {
                  type: "react-component",
                  component: "PortalTarget",
                  title: "Data",
                  props: { portalId: "xy" },
                },
                {
                  type: "react-component",
                  component: "PortalTarget",
                  title: "Data",
                  props: { portalId: "xz" },
                },
              ],
            },
            {
              type: "column",
              content: [
                {
                  type: "react-component",
                  component: "PortalTarget",
                  title: "Data",
                  props: { portalId: "yz" },
                },
                {
                  type: "react-component",
                  component: "PortalTarget",
                  title: "Data",
                  props: { portalId: "td" },
                },
              ],
            },
          ],
        },
        {
          type: "column",
          content: [
            {
              type: "stack",
              content: [
                {
                  type: "react-component",
                  component: "PortalTarget",
                  title: "Dataset Info",
                  props: { portalId: 1 },
                },
                {
                  type: "react-component",
                  component: "PortalTarget",
                  title: "Trees",
                  props: { portalId: 2 },
                },
                {
                  type: "react-component",
                  component: "PortalTarget",
                  title: "Comments",
                  props: { portalId: 3 },
                },
                {
                  type: "react-component",
                  component: "PortalTarget",
                  title: "Abstract Tree View",
                  props: { portalId: 4 },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

class GoldenLayoutWrapper extends React.Component<*, *> {
  componentDidMount() {
    const myLayout = new GoldenLayout(this.props.layoutConfig, "#layoutContainer");
    window.myLayout = myLayout;

    myLayout.registerComponent("PortalTarget", PortalTarget);

    // The timeout is necessary since react cannot deal with react.render calls (which goldenlayout executes)
    // while being in the middle of a react lifecycle (componentDidMount)
    setTimeout(() => {
      myLayout.init();
      this.forceUpdate();
    }, 10);

    const persistLayoutDebounced = _.debounce(() => {
      localStorage.setItem("golden-wk-layout", JSON.stringify(myLayout.toConfig()));
    }, 2000);

    myLayout.eventHub.on("stateChanged", () => {
      window.needsRerender = true;
    });
  }

  render() {
    console.log("this.props.children", this.props.children);
    return [
      <div
        key="layoutContainer"
        id="layoutContainer"
        style={{ display: "block", height: "100%", width: "100%", flex: "1 1 auto" }}
      />,
    ].concat(
      this.props.children.map(child => (
        <RenderToPortal key={child.key} portalId={child.key}>
          {child}
        </RenderToPortal>
      )),
    );
  }
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
    const serializedLayoutConfig = JSON.parse(localStorage.getItem("golden-wk-layout"));

    return (
      <div>
        {
          <OxalisController
            initialTracingType={this.props.initialTracingType}
            initialAnnotationId={this.props.initialAnnotationId}
            initialControlmode={this.props.initialControlmode}
          />
        }
        <Layout className="tracing-layout">
          <Header style={{ flex: "0 1 auto", zIndex: 210, minHeight: 48 }}>
            <ButtonComponent onClick={this.handleSettingsCollapse}>
              <Icon type={this.state.isSettingsCollapsed ? "menu-unfold" : "menu-fold"} />
              Settings
            </ButtonComponent>
            <ActionBarView />
          </Header>
          <Layout style={{ marginTop: 64 }} style={{ display: "flex" }}>
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
              id="canvasAndLayoutContainer"
              style={{ display: "flex", flexDirection: "column", flex: "1 1 auto" }}
            >
              <TracingView renderCanvas={true} />

              <GoldenLayoutWrapper layoutConfig={!serializedLayoutConfig || DefaultLayoutConfig}>
                <InputCatchers planeID="xy" key="xy" />
                <InputCatchers planeID="yz" key="yz" />
                <InputCatchers planeID="xz" key="xz" />
                <InputCatchers planeID="td" key="td" />
                <DatasetInfoTabView key={1} />
                <TreesTabView key={2} />
                <CommentTabView key={3} />
                <AbstractTreeTabView key={4} />
              </GoldenLayoutWrapper>
            </div>
          </Layout>
        </Layout>
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState): StateProps {
  return {
    activePlaneLayout: state.viewModeData.plane.activeLayout,
  };
}

export default connect(mapStateToProps)(withRouter(TracingLayoutView));
