// @flow

import * as React from "react";
import GoldenLayout from "golden-layout/dist/goldenlayout.js";
import _ from "lodash";
import Constants from "oxalis/constants";
import { PortalTarget, RenderToPortal } from "./portal_utils.js";
import { resetLayoutEmitter } from "./layout_persistence";

type Props<KeyType> = {
  id: string,
  layoutKey: KeyType,
  layoutConfigGetter: (layoutKey: KeyType) => Object,
  onLayoutChange?: (config: Object, layoutKey: string) => void,
  children: React.Node,
  style: Object,
};

class GoldenLayoutAdapter extends React.Component<Props<*>, *> {
  gl: GoldenLayout;
  unbindListener: Function;

  componentDidMount() {
    this.setupLayout();

    const updateSizeDebounced = _.debounce(
      () => this.gl.updateSize(),
      Constants.RESIZE_THROTTLE_TIME,
    );
    window.addEventListener("resize", updateSizeDebounced);

    this.unbindListener = resetLayoutEmitter.on("resetLayout", () => {
      this.rebuildLayout();
    });
  }

  componentWillUnmount() {
    this.unbindListener();
  }

  componentDidUpdate(prevProps: Props<*>) {
    if (prevProps.layoutKey !== this.props.layoutKey) {
      this.rebuildLayout();
    }
  }

  rebuildLayout() {
    this.gl.destroy();
    this.setupLayout();
  }

  setupLayout() {
    const gl = new GoldenLayout(
      this.props.layoutConfigGetter(this.props.layoutKey),
      `#${this.props.id}`,
    );
    gl.registerComponent("PortalTarget", PortalTarget);

    // The timeout is necessary since react cannot deal with react.render calls (which goldenlayout executes)
    // while being in the middle of a react lifecycle (componentDidMount)
    setTimeout(() => {
      gl.init();
      // Rerender since the portals just became available
      this.forceUpdate();
    }, 10);

    gl.on("stateChanged", () => {
      const onLayoutChange = this.props.onLayoutChange;
      if (onLayoutChange != null) {
        onLayoutChange(gl.toConfig(), this.props.layoutKey);
      }
    });
    this.gl = gl;
  }

  render() {
    return [<div key="layoutContainer" id={this.props.id} style={this.props.style} />].concat(
      React.Children.toArray(this.props.children).map(child => (
        <RenderToPortal key={child.props.portalKey} portalId={child.props.portalKey}>
          {child}
        </RenderToPortal>
      )),
    );
  }
}

export default GoldenLayoutAdapter;
