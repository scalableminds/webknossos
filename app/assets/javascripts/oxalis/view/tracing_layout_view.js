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
import UserScriptsModal from "oxalis/view/user_scripts_modal";
import enUS from "antd/lib/locale-provider/en_US";
import { LocaleProvider, Layout, Button, Icon } from "antd";
import type { SkeletonTracingTypeTracingType } from "oxalis/store";
import type { ControlModeType } from "oxalis/constants";

const { Header, Sider } = Layout;

class TracingLayoutView extends React.PureComponent {
  props: {
    initialTracingType: SkeletonTracingTypeTracingType,
    initialTracingId: string,
    initialControlmode: ControlModeType,
  };

  state = {
    isSettingsCollapsed: true,
    isUserScriptsModalOpen: false,
  };

  componentDidMount() {
    const addScriptLink = document.getElementById("add-script-link");
    if (addScriptLink) {
      addScriptLink.classList.remove("hide");
      addScriptLink.addEventListener("click", () => this.showUserScriptsModal());
    }
  }

  componentWillUnmount() {
    window.app.oxalis = null;
  }

  showUserScriptsModal = () => {
    this.setState({
      isUserScriptsModalOpen: true,
    });
  };

  closeUserScriptsModal = () => {
    this.setState({
      isUserScriptsModalOpen: false,
    });
  };

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
              initialTracingId={this.props.initialTracingId}
              initialControlmode={this.props.initialControlmode}
              ref={ref => {
                app.oxalis = ref;
              }}
            />

            <Layout className="tracing-layout">
              <Header>
                <Button
                  size="large"
                  onClick={this.handleSettingsCollapse}
                  style={{ float: "left", marginTop: "10px" }}
                >
                  <Icon type={this.state.isSettingsCollapsed ? "menu-unfold" : "menu-fold"} />
                  Settings
                </Button>
                <ActionBarView />
              </Header>
              <Layout>
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
                    <UserScriptsModal
                      visible={this.state.isUserScriptsModalOpen}
                      onClose={this.closeUserScriptsModal}
                    />
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
