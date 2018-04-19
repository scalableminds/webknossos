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
import { connect } from "react-redux";
import type { PlaneLayoutType, TracingTypeTracingType } from "oxalis/store";
import type { ControlModeType } from "oxalis/constants";

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

  render() {
    // const newLayout = (
    //   <div>
    //     <Row>
    //       <Col>
    //         <TracingView />
    //       </Col>
    //     </Row>
    //     <Row>
    //       <Col>
    //         <RightMenuView />
    //       </Col>
    //     </Row>
    //   </div>
    // );

    // .wrapper {
    //   display: flex;
    //   height: 100vh;
    // }

    // nav {
    //   flex: 0 0 auto;
    // }

    // section {
    //   flex: 1 1 auto;
    //   overflow: auto;
    // }

    const isClassicMode = this.props.activePlaneLayout === "two-rows-two-columns";
    return <div />;
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
              style={{
                zIndex: 200,
                display: "flex",
                flexDirection: isClassicMode ? "row" : "column",
                height: "calc(100vh - 135px)",
              }}
            >
              <div style={{ flex: "1 1 auto", overflow: "auto" }}>
                <TracingView />
              </div>
              <div
                style={{
                  flex: "1 1 auto",
                  height: isClassicMode ? "100%" : "40%",
                  display: "flex",
                  overflow: "hidden",
                }}
              >
                <RightMenuView />
              </div>
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
