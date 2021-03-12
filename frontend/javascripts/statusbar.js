// @flow
import { Layout } from "antd";
import { connect } from "react-redux";
import React from "react";

import { type OxalisState } from "oxalis/store";

const { Footer } = Layout;

type OwnProps = {||};
type StateProps = {|
  isInAnnotationView: boolean,
|};
type Props = {| ...OwnProps, ...StateProps |};

export const statusbarHeight = 18;

// The user should click somewhere else to close that menu like it's done in most OS menus, anyway. 10 seconds.

function Statusbar({ isInAnnotationView }: Props) {
  const statusbarStyle: Object = {
    padding: 0,
    overflowX: "auto",
    position: "fixed",
    bottom: 0,
    width: "100%",
    zIndex: 1000,
    fontSize: 10,
    height: statusbarHeight,
    display: "flex",
    alignItems: "center",
    color: "rgba(255, 255, 255, 0.67)",
    background: "#001529",
    whiteSpace: "nowrap",
    paddingLeft: 5,
  };

  const collapseAllNavItems = isInAnnotationView;

  return (
    <Footer style={statusbarStyle} className={collapseAllNavItems ? "collapsed-nav-footer" : ""}>
      Status Bar
    </Footer>
  );
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  isInAnnotationView: state.uiInformation.isInAnnotationView,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(Statusbar);
