// @flow

import * as React from "react";
import GoldenLayout from "golden-layout/dist/goldenlayout";
import _ from "lodash";
import Constants from "oxalis/constants";
import Toast from "libs/toast";
import window from "libs/window";
import { PortalTarget, RenderToPortal } from "./portal_utils";
import { layoutEmitter } from "./layout_persistence";

type Props<KeyType> = {
  id: string,
  layoutKey: KeyType,
  layoutConfigGetter: (layoutKey: KeyType) => Object,
  onLayoutChange?: (config: Object, layoutKey: string) => void,
  children: React.Node,
  style: Object,
};

const getGroundTruthLayoutRect = () => {
  const mainContainer = document.querySelector(".ant-layout .ant-layout-has-sider");
  if (!mainContainer) {
    return { width: 1000, height: 1000 };
  }
  const { clientWidth: width, clientHeight: height } = mainContainer;
  return { width, height };
};

const monkeypatchGLSizeGetter = gl => {
  const _oldWidth = gl.container.width;
  gl.container.width = value => {
    if (value) {
      return _oldWidth.call(gl, value);
    } else {
      const { width } = getGroundTruthLayoutRect();
      return width * window.scale;
    }
  };
  const _oldHeight = gl.container.height;
  gl.container.height = value => {
    if (value) {
      return _oldHeight.call(gl, value);
    } else {
      const { height } = getGroundTruthLayoutRect();
      return height * window.scale;
    }
  };
};

const updateSizeForGl = gl => {
  const container = document.querySelector("#layoutContainer");
  if (!container) {
    return;
  }
  const { width, height } = getGroundTruthLayoutRect();

  container.style.width = `${Math.floor(width * window.scale)}px`;
  container.style.height = `${Math.floor(height * window.scale)}px`;

  gl.updateSize(width * window.scale, height * window.scale);
};

export class GoldenLayoutAdapter extends React.PureComponent<Props<*>, *> {
  gl: GoldenLayout;
  unbindListeners: Array<() => void>;

  componentDidMount() {
    this.setupLayout();
  }

  componentDidUpdate(prevProps: Props<*>) {
    if (prevProps.layoutKey !== this.props.layoutKey) {
      this.rebuildLayout();
    }
  }

  componentWillUnmount() {
    this.unbindListeners.forEach(unbind => unbind());
  }

  rebuildLayout() {
    this.gl.destroy();
    this.setupLayout();
  }

  onStateChange() {
    const { onLayoutChange } = this.props;
    if (onLayoutChange != null) {
      onLayoutChange(this.gl.toConfig(), this.props.layoutKey);
    }
  }

  setupLayout() {
    const gl = new GoldenLayout(
      this.props.layoutConfigGetter(this.props.layoutKey),
      `#${this.props.id}`,
    );
    this.gl = gl;
    gl.registerComponent("PortalTarget", PortalTarget);

    window.scale = window.scale || 1;
    const updateSize = () => updateSizeForGl(gl);
    const updateSizeDebounced = _.debounce(updateSize, Constants.RESIZE_THROTTLE_TIME);
    window.addEventListener("resize", updateSize);
    const unbindResizeListener = () => window.removeEventListener("resize", updateSize);
    const unbindResetListener = layoutEmitter.on("resetLayout", () => {
      window.scale = 1;
      this.rebuildLayout();
    });
    const unbindChangedScaleListener = layoutEmitter.on("changedScale", updateSizeDebounced);

    gl.on("stateChanged", () => this.onStateChange());

    this.unbindListeners = [unbindResetListener, unbindChangedScaleListener, unbindResizeListener];

    updateSize(gl);
    // The timeout is necessary since react cannot deal with react.render calls (which goldenlayout executes)
    // while being in the middle of a react lifecycle (componentDidMount)
    setTimeout(() => {
      try {
        gl.init();
      } catch (exception) {
        // This might happen when the serialized layout config is not compatible with the newest version.
        // However, this should be mitigated by currentLayoutVersion in default_layout_configs.js
        Toast.error("Layout couldn't be restored. The default layout is used instead.");
        layoutEmitter.emit("resetLayout");
        console.error(exception);
        return;
      }
      // Rerender since the portals just became available
      this.forceUpdate();
      // Trigger initial state update so that the size of the input catchers are set up correctly
      this.onStateChange();
      // Monkeypatch the gl size getters so that the layout can be larger then the viewport (k/l scaling)
      monkeypatchGLSizeGetter(gl);
      // Ensure that the size is correct
      updateSize(gl);
    }, 10);
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

// Warning: Don't use a default export for this component. Otherwise, when webpack is run in prod mode,
// UglifyJS will break this component by re-mounting it on every state change of the parent
export default {};
