/**
 * tracing_layout_view.js
 * @flow
 */

import React from "react";
import { Provider } from "react-redux";
import app from "app";
import Store from "oxalis/throttled_store";
import OxalisController from "oxalis/controller";
import SettingsView from "oxalis/view/settings/settings_view";
import ActionBarView from "oxalis/view/action_bar_view";
import RightMenuView from "oxalis/view/right_menu_view";
import TracingView from "oxalis/view/tracing_view";
import enUS from "antd/lib/locale-provider/en_US";
import { LocaleProvider, Layout, Icon } from "antd";
import ButtonComponent from "oxalis/view/components/button_component";
import type { SkeletonTracingTypeTracingType } from "oxalis/store";
import type { ControlModeType } from "oxalis/constants";

const { Header, Sider } = Layout;

class TracingLayoutView extends React.PureComponent {
  props: {
    initialTracingType: SkeletonTracingTypeTracingType,
    initialAnnotationId: string,
    initialControlmode: ControlModeType,
  };

  state = {
    isSettingsCollapsed: true,
  };

  componentWillUnmount() {
    window.app.oxalis = null;
  }

  handleSettingsCollapse = () => {
    this.setState({
      isSettingsCollapsed: !this.state.isSettingsCollapsed,
    });
  };

  render() {
    return (
      <LocaleProvider locale={enUS}>
        <Provider store={Store}>
          <div>
            <OxalisController
              initialTracingType={this.props.initialTracingType}
              initialAnnotationId={this.props.initialAnnotationId}
              initialControlmode={this.props.initialControlmode}
              ref={ref => {
                app.oxalis = ref;
              }}
            />

            <Layout className="tracing-layout">
              <Header style={{ position: "fixed", width: "100%", zIndex: 210, minHeight: 48 }}>
                <ButtonComponent
                  size="large"
                  onClick={this.handleSettingsCollapse}
                  style={{ float: "left", marginTop: "10px" }}
                >
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
                <div style={{ zIndex: 200, display: "flex", flex: 1 }}>
                  <div>
                    <TracingView />
                  </div>
                  <div style={{ flex: "1", display: "inline-flex" }}>
                    <RightMenuView />
                  </div>
                </div>
              </Layout>
            </Layout>
          </div>
        </Provider>
      </LocaleProvider>
    );
  }
}

export default TracingLayoutView;
