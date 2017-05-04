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

const { Header, Sider, Content } = Layout;

class TracingLayoutView extends React.PureComponent {

  state = {
    isSettingsCollapsed: true,
    isUserScriptsModalOpen: false,
  }

  componentDidMount() {
    const addScriptLink = document.getElementById("add-script-link");
    if (addScriptLink) {
      addScriptLink.classList.remove("hide");
      addScriptLink.addEventListener("click", () => this.showUserScriptsModal());
    }
    app.oxalis = new OxalisController();
  }

  componentWillUnmount() {
    window.app.oxalis = null;
  }

  showUserScriptsModal = () => {
    this.setState({
      isSettingsCollapsed: this.state.isSettingsCollapsed,
      isUserScriptsModalOpen: true,
    });
  }

  closeUserScriptsModal = () => {
    this.setState({
      isSettingsCollapsed: this.state.isSettingsCollapsed,
      isUserScriptsModalOpen: false,
    });
  }

  handleSettingsCollapse = () => {
    this.setState({
      isSettingsCollapsed: this.state.isSettingsCollapsed,
      isUserScriptsModalOpen: this.state.isUserScriptsModalOpen,
    });
  }

  render() {
    return (
      <LocaleProvider locale={enUS}>
        <Provider store={Store}>
          <Layout>
            <Header>
              <Button
                size="large"
                onClick={this.handleSettingsCollapse} style={{ float: "left", marginTop: "10px" }}
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
              >
                <SettingsView />
              </Sider>
              <Layout className="tracing-layout">
                <Content>
                  <UserScriptsModal
                    visible={this.state.isUserScriptsModalOpen}
                    onClose={this.closeUserScriptsModal}
                  />
                  <TracingView />
                </Content>
                <Sider>
                  <RightMenuView />
                </Sider>
              </Layout>
            </Layout>
          </Layout>
        </Provider>
      </LocaleProvider>
    );
  }
}

export default TracingLayoutView;
