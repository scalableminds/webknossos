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
import { Layout, Icon } from "antd";
import { location } from "libs/window";
import ButtonComponent from "oxalis/view/components/button_component";
import type { TracingTypeTracingType } from "oxalis/store";
import type { ControlModeType } from "oxalis/constants";
import Toast from "libs/toast";
import messages from "messages";

const { Header, Sider } = Layout;

type Props = {
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

  componentDidCatch() {
    Toast.error(messages["react.rendering_error"]);
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
          <Layout style={{ marginTop: 64, height: "calc(100% - 64px)" }}>
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
    );
  }
}

export default TracingLayoutView;
