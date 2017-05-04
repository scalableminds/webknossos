/**
 * tracing_layout_view.js
 * @flow
 */

import React from "react";
import { Provider } from "react-redux";
import app from "app";
import Store from "oxalis/throttled_store";
import OxalisController from "oxalis/controller";
import Constants, { ControlModeEnum } from "oxalis/constants";
import SettingsView from "oxalis/view/settings/settings_view";
import ActionBarView from "oxalis/view/action_bar_view";
import RightMenuView from "oxalis/view/right_menu_view";
import TracingView from "oxalis/view/tracing_view";
import enUS from "antd/lib/locale-provider/en_US";
import { LocaleProvider, Layout, Button, Icon } from "antd";

const { Header, Sider, Content } = Layout;

class TracingLayoutView extends React.PureComponent {

  state = {
    settingsCollapsed: true,
  }

  componentDidMount() {
    // $(window).on("resize", this.resizeRightMenu.bind(this));
    const addScriptLink = document.getElementById("add-script-link");
    if (addScriptLink) {
      addScriptLink.classList.remove("hide");
      addScriptLink.addEventListener("click", this.showUserScriptsModal.bind(this));
    }

    // this.listenTo(app.vent, "planes:resize", this.resizeRightMenu);
    app.oxalis = new OxalisController();
  }

  componentWillUnmount() {
    window.app.oxalis = null;
  }

  // resizeRightMenu() {
  //   if (this.isSkeletonMode()) {
  //     const menuPosition = this.ui.rightMenu.position();
  //     const slidingCanvasOffset = this.ui.slidingCanvas.position().left;

  //     const newWidth = window.innerWidth - menuPosition.left - slidingCanvasOffset - MARGIN;

  //     if (menuPosition.left < window.innerWidth && newWidth > 350) {
  //       this.ui.rightMenu.width(newWidth);
  //     }
  //   }
  // }

      // this.maybeShowNewTaskTypeModal();


  showUserScriptsModal = (event: SyntheticInputEvent) => {
    event.preventDefault();
    // const modalView = new UserScriptsModalView();
    // this.showChildView("modalWrapper", modalView);
    // return modalView.show();
    throw Error("TODO");
  }

  isSkeletonMode() {
    return Constants.MODES_SKELETON.includes(store.getState().temporaryConfiguration.viewMode) && Model.controlMode !== Constants.CONTROL_MODE_VIEW;
  }

  handleSettingsCollapse = () => {
    this.setState({
      settingsCollapsed: !this.state.settingsCollapsed,
    });
  }

  // this.maybeShowNewTaskTypeModal();

  showUserScriptsModal(event: Event): void {
    event.preventDefault();
    // const modalView = new UserScriptsModalView();
    // this.showChildView("modalWrapper", modalView);
    // return modalView.show();
    throw Error("TODO");
  }

  isSkeletonMode() {
    const temporaryConfiguration = Store.getState().temporaryConfiguration;
    return Constants.MODES_SKELETON.includes(temporaryConfiguration.viewMode) && temporaryConfiguration.controlMode !== ControlModeEnum.VIEW;
  }

  render() {
    // if (!this.model.settings.advancedOptionsAllowed) {

    return (
      <LocaleProvider locale={enUS}>
        <Provider store={Store}>
          <Layout>
            <Header>
              <Button
                size="large"
                onClick={this.handleSettingsCollapse} style={{ float: "left", marginTop: "10px" }}
              >
                <Icon type={this.state.settingsCollapsed ? "menu-unfold" : "menu-fold"} />
                Settings
              </Button>
              <ActionBarView />
            </Header>
            <Layout>
              <Sider
                collapsible
                trigger={null}
                collapsed={this.state.settingsCollapsed}
                collapsedWidth={0}
                width={350}
              >
                <SettingsView />
              </Sider>
              <Layout>
                <Content>
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
