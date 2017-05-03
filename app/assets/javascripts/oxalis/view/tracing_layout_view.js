/**
 * tracing_layout_view.js
 * @flow
 */

import _ from "lodash";
import $ from "jquery";
import React from "react";
import { render } from "react-dom";
import { Provider } from "react-redux";
import app from "app";
import store from "oxalis/throttled_store";
import OxalisController from "oxalis/controller";

import Constants from "oxalis/constants";
import Modal from "oxalis/view/modal";
import Utils from "libs/utils";
import SettingsView from "oxalis/view/settings/settings_view";
import ActionBarView from "oxalis/view/action_bar_view";
import RightMenuView from "oxalis/view/right_menu_view";
import UserScriptsModalView from "oxalis/view/user_scripts_modal";
import TracingView from "oxalis/view/tracing_view";
import enUS from "antd/lib/locale-provider/en_US";
import { LocaleProvider, Layout} from "antd";

const MARGIN = 40;
const { Header, Sider, Content } = Layout;

class TracingLayoutView extends React.PureComponent {

  componentDidMount() {
    $(window).on("resize", this.resizeRightMenu.bind(this));
    const addScriptLink = document.getElementById("add-script-link");
    if (addScriptLink) {
      addScriptLink.classList.remove("hide");
      addScriptLink.addEventListener("click", this.showUserScriptsModal);
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

  render() {
    // if (!this.model.settings.advancedOptionsAllowed) {

    /*
          <div className="text-nowrap">
      <div id="action-bar"></div>
      <div id="sliding-canvas">
        <div id="settings-menu-wrapper" className="navmenu-fixed-left offcanvas">
        </div>
      </div>
      <div id="right-menu">
      </div>
      <div id="modal" className="modal fade" tabIndex="-1" role="dialog" />
      <div className="modal-wrapper" />
    </div>
    */
    return render(
      <LocaleProvider locale={enUS}>
        <Provider store={store}>
          <Layout>
            <Sider>
              <SettingsView />
            </Sider>
            <Layout>
              <Header>
                <ActionBarView />
              </Header>
              <Content>
                <TracingView />
              </Content>
              <Sider>
                <RightMenuView />
              </Sider>
            </Layout>
          </Layout>
        </Provider>
      </LocaleProvider>,
      document.getElementById("main-container"),
    );
  }
    // this.maybeShowNewTaskTypeModal();


  showUserScriptsModal = (event: SyntheticInputEvent) => {
    event.preventDefault();
    // const modalView = new UserScriptsModalView();
    // this.showChildView("modalWrapper", modalView);
    // return modalView.show();
    throw Error("TODO");
  }

  isTracingMode() {
    return Model.controlMode !== Constants.CONTROL_MODE_VIEW;
  }

  isSkeletonMode() {
    return Constants.MODES_SKELETON.includes(store.getState().viewMode) && this.isTracingMode();
  }

}

export default TracingLayoutView;
