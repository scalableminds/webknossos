/**
 * tracing_layout_view.js
 * @flow
 */

import * as React from "react";
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

  componentDidMount() {
    function wrapComponent(Component, store) {
      class Wrapped extends React.Component {
        render() {
          return (
            <Provider store={store}>
              <Component {...this.props} />
            </Provider>
          );
        }
      }
      return Wrapped;
    }

    var myLayout = new GoldenLayout(
      {
        content: [
          {
            type: "row",
            content: [
              {
                type: "react-component",
                component: "TracingView",
                title: "Data",
                props: { label: "Tracing View" },
              },
              {
                type: "column",
                content: [
                  {
                    type: "stack",
                    content: [
                      {
                        type: "react-component",
                        component: "DatasetInfoTabView",
                        title: "Dataset Info",
                      },
                      {
                        type: "react-component",
                        component: "TreesTabView",
                        title: "Trees",
                      },
                      {
                        type: "react-component",
                        component: "CommentTabView",
                        title: "Comments",
                      },
                      {
                        type: "react-component",
                        component: "AbstractTreeTabView",
                        title: "Abstract Tree View",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      "#layoutContainer",
    );

    class TestComponent extends React.Component {
      render() {
        return <h1>{this.props.label}</h1>;
      }
    }
    myLayout.registerComponent("test-component", TestComponent);
    myLayout.registerComponent("TracingView", wrapComponent(TracingView, Store));
    myLayout.registerComponent("DatasetInfoTabView", wrapComponent(DatasetInfoTabView, Store));

    myLayout.registerComponent("TreesTabView", wrapComponent(TreesTabView, Store));
    myLayout.registerComponent("CommentTabView", wrapComponent(CommentTabView, Store));
    myLayout.registerComponent("AbstractTreeTabView", wrapComponent(AbstractTreeTabView, Store));

    setTimeout(() => myLayout.init(), 10);
  }

  render() {
    return (
      <div>
        <OxalisController
          initialTracingType={this.props.initialTracingType}
          initialAnnotationId={this.props.initialAnnotationId}
          initialControlmode={this.props.initialControlmode}
        />
        <Layout className="tracing-layout">
          <Header style={{ position: "fixed", width: "100%", zIndex: 210, minHeight: 48 }}>
            <ButtonComponent onClick={this.handleSettingsCollapse}>
              <Icon type={this.state.isSettingsCollapsed ? "menu-unfold" : "menu-fold"} />
              Settings
            </ButtonComponent>
            <ActionBarView />
          </Header>
          <Layout style={{ marginTop: 64 }}>
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
              id="layoutContainer"
              style={{ display: "block", height: "1000px", width: "100%" }}
            />
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
