// @flow

import * as React from "react";
import GoldenLayout from "golden-layout/dist/goldenlayout.js";
import _ from "lodash";
import Constants from "oxalis/constants";
import Toast from "libs/toast";
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

  componentDidUpdate(prevProps: Props<*>) {
    if (prevProps.layoutKey !== this.props.layoutKey) {
      this.rebuildLayout();
    }
  }

  componentWillUnmount() {
    this.unbindListener();
  }

  rebuildLayout() {
    this.gl.destroy();
    this.setupLayout();
  }

  onStateChange() {
    const onLayoutChange = this.props.onLayoutChange;
    if (onLayoutChange != null) {
      onLayoutChange(this.gl.toConfig(), this.props.layoutKey);
    }
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
      try {
        gl.init();
      } catch (exception) {
        // This might happen when the serialized layout config is not compatible with the newest version.
        // However, this should be mitigated by currentLayoutVersion in default_layout_configs.js
        Toast.error("Layout couldn't be restored. The default layout is used instead.");
        resetLayoutEmitter.emit("resetLayout");
        console.error(exception);
        return;
      }
      // Rerender since the portals just became available
      this.forceUpdate();
    }, 10);
    setTimeout(() => {
      // Trigger initial state update so that input catcher can be set up

      this.onStateChange();
    }, 2000);

    gl.on("stateChanged", () => this.onStateChange());
    this.gl = gl;
  }

  render() {
    const layoutContainer = (
      <div key="layoutContainer" id={this.props.id} style={this.props.style} />
    );
    const portals = React.Children.toArray(this.props.children).map(child => (
      <RenderToPortal key={child.props.portalKey} portalId={child.props.portalKey}>
        {child}
      </RenderToPortal>
    ));
    return [layoutContainer, ...portals];
  }
}

export default GoldenLayoutAdapter;
