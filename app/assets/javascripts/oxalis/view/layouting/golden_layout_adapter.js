// @flow

import * as React from "react";
import GoldenLayout from "golden-layout/dist/goldenlayout.js";
import _ from "lodash";
import Constants from "oxalis/constants";
import Toast from "libs/toast";
import window from "libs/window";
import { PortalTarget, RenderToPortal } from "./portal_utils.js";
import { layoutEmitter } from "./layout_persistence";

type Props<KeyType> = {
  id: string,
  layoutKey: KeyType,
  layoutConfigGetter: (layoutKey: KeyType) => Object,
  onLayoutChange?: (config: Object, layoutKey: string) => void,
  children: React.Node,
  style: Object,
};

export class GoldenLayoutAdapter extends React.PureComponent<Props<*>, *> {
  gl: GoldenLayout;
  unbindListener: Function;

  componentDidMount() {
    this.setupLayout();
    window.scale = window.scale || 1;

    const getGroundTruthRect = () => {
      const mainContainer = document.querySelector(".ant-layout .ant-layout-has-sider");
      if (!mainContainer) {
        return { width: 1000, height: 1000 };
      }
      const { clientWidth: width, clientHeight: height } = mainContainer;
      return { width, height };
    };

    setTimeout(() => {
      const _oldWidth = this.gl.container.width;
      this.gl.container.width = value => {
        if (value) {
          console.log("set width: value", value);
          return _oldWidth.call(this.gl, value);
        } else {
          const { width } = getGroundTruthRect();
          console.log("got width", width * window.scale);
          return width * window.scale;
        }
      };
      const _oldHeight = this.gl.container.height;
      this.gl.container.height = value => {
        if (value) {
          return _oldHeight.call(this.gl, value);
        } else {
          const { height } = getGroundTruthRect();
          return height * window.scale;
        }
      };
    }, 10);
    const updateSize = () => {
      const container = document.querySelector("#layoutContainer");
      if (!container) {
        return;
      }
      const { width, height } = getGroundTruthRect();

      container.style.width = `${Math.floor(width * window.scale)}px`;
      container.style.height = `${Math.floor(height * window.scale)}px`;

      this.gl.updateSize(width * window.scale, height * window.scale);
      console.log("updateSize", width * window.scale, height * window.scale);
    };
    const updateSizeDebounced = _.debounce(updateSize, Constants.RESIZE_THROTTLE_TIME);
    window.addEventListener("resize", updateSize);
    layoutEmitter.on("changedScale", updateSizeDebounced);

    const setDummySize = () => {
      const container = document.querySelector("#layoutContainer");
      if (!container) {
        return;
      }
      const width = 1000;
      const height = 1000;

      container.style.width = `${Math.floor(width * window.scale)}px`;
      container.style.height = `${Math.floor(height * window.scale)}px`;

      this.gl.updateSize(width * window.scale, height * window.scale);
      console.log("setDummySize", width * window.scale, height * window.scale);
    };

    setDummySize();

    setTimeout(updateSize, 100);

    this.unbindListener = layoutEmitter.on("resetLayout", () => {
      window.scale = 1;
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
      // layoutEmitter.emit("changedScale");
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
        layoutEmitter.emit("resetLayout");
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

// Warning: Don't use a default export for this component. Otherwise, when webpack is run in prod mode,
// UglifyJS will break this component be re-mounting it on every state change of the parent
export default {};
