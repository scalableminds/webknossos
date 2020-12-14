// @flow

import GoldenLayout from "golden-layout/dist/goldenlayout";
import * as React from "react";
import _ from "lodash";

import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { setStoredLayoutsAction } from "oxalis/model/actions/ui_actions";
import Constants from "oxalis/constants";
import Store from "oxalis/store";
import Toast from "libs/toast";
import window, { document } from "libs/window";
import { InputKeyboardNoLoop } from "libs/input";

import { PortalTarget, RenderToPortal } from "./portal_utils";
import { layoutEmitter, getLayoutConfig } from "./layout_persistence";
import { resetDefaultLayouts, getGroundTruthLayoutRect } from "./default_layout_configs";

type Props<KeyType> = {
  id: string,
  layoutKey: KeyType,
  activeLayoutName: string,
  onLayoutChange?: (config: Object, layoutKey: string) => void,
  children: React.Node,
  style: Object,
};

export const getDesiredLayoutRect = () => {
  const { layoutScaleValue } = Store.getState().userConfiguration;
  const { width, height } = getGroundTruthLayoutRect();
  return {
    width: width * layoutScaleValue,
    height: height * layoutScaleValue,
  };
};

const monkeypatchGLSizeGetter = gl => {
  const _oldWidth = gl.container.width;
  gl.container.width = value => {
    if (value) {
      return _oldWidth.call(gl, value);
    } else {
      const { width } = getGroundTruthLayoutRect();
      return width * Store.getState().userConfiguration.layoutScaleValue;
    }
  };
  const _oldHeight = gl.container.height;
  gl.container.height = value => {
    if (value) {
      return _oldHeight.call(gl, value);
    } else {
      const { height } = getGroundTruthLayoutRect();
      return height * Store.getState().userConfiguration.layoutScaleValue;
    }
  };
};

const updateSizeForGl = gl => {
  const container = document.querySelector("#layoutContainer");
  if (!container) {
    return;
  }
  const { width, height } = getGroundTruthLayoutRect();
  const layoutScale = Store.getState().userConfiguration.layoutScaleValue;
  container.style.width = `${Math.floor(width * layoutScale)}px`;
  container.style.height = `${Math.floor(height * layoutScale)}px`;

  gl.updateSize(width * layoutScale, height * layoutScale);
};

export class GoldenLayoutAdapter extends React.PureComponent<Props<*>, *> {
  gl: typeof GoldenLayout;
  maximizedItem: ?Object = null;
  unbindListeners: Array<() => void> = [];

  componentDidMount() {
    this.setupLayout();
  }

  componentDidUpdate(prevProps: Props<*>) {
    if (
      prevProps.layoutKey !== this.props.layoutKey ||
      prevProps.activeLayoutName !== this.props.activeLayoutName
    ) {
      this.rebuildLayout();
    }
  }

  componentWillUnmount() {
    this.unbind();
  }

  unbind() {
    this.unbindListeners.forEach(unbind => unbind());
    this.unbindListeners = [];
  }

  rebuildLayout(newConfig = null) {
    this.unbind();
    this.gl.destroy();
    this.setupLayout(newConfig);
  }

  onStateChange() {
    const { onLayoutChange } = this.props;
    if (onLayoutChange != null && this.gl.isInitialised) {
      onLayoutChange(this.gl.toConfig(), this.props.activeLayoutName);
      // Only when the maximized item changed, adjust css classes to not show hidden gl items.
      if (this.maximizedItem !== this.gl._maximisedItem) {
        // Gl needs a forced update when returning from maximized viewing
        // mode to render stacked components correctly.
        const needsUpdatedSize = this.gl._maximisedItem === null && this.maximizedItem != null;
        this.maximizedItem = this.gl._maximisedItem;
        const allGlHeaderElements = document.getElementsByClassName("lm_item");
        for (const element of allGlHeaderElements) {
          if (this.maximizedItem) {
            // Show only the maximized item and do not hide the gl root component.
            if (
              !element.classList.contains("lm_maximised") &&
              !element.classList.contains("lm_root")
            ) {
              element.classList.add("hidden-gl-item");
            }
          } else {
            // If there is no maximized component, remove the css class to show everything as usual.
            element.classList.remove("hidden-gl-item");
          }
        }
        // Force gl to update again when returning from maximized viewing mode.
        if (needsUpdatedSize) {
          updateSizeForGl(this.gl);
        }
      }
    }
  }

  attachMaximizeListener() {
    const toggleMaximize = () => {
      // Only maximize the element the mouse is over
      const hoveredComponents = this.gl.root.getItemsByFilter(
        item => item.isComponent && item.element[0].matches(":hover"),
      );
      if (hoveredComponents.length > 0) {
        const hoveredItem = hoveredComponents[0];
        // Maximize the container of the item not only the item itself, otherwise the header is not visible
        hoveredItem.parent.toggleMaximise();
      }
    };

    const keyboardNoLoop = new InputKeyboardNoLoop(
      { ".": toggleMaximize },
      { supportInputElements: false },
    );
    return () => keyboardNoLoop.destroy();
  }

  setupLayout(newConfig = null) {
    const activeLayout =
      newConfig || getLayoutConfig(this.props.layoutKey, this.props.activeLayoutName);
    const gl = new GoldenLayout(activeLayout, `#${this.props.id}`);
    this.gl = gl;
    gl.registerComponent("PortalTarget", PortalTarget);

    const updateSize = () => updateSizeForGl(gl);
    const updateSizeDebounced = _.debounce(updateSize, Constants.RESIZE_THROTTLE_TIME / 5);
    window.addEventListener("resize", updateSize);
    const unbindResizeListener = () => window.removeEventListener("resize", updateSize);
    const unbindResetListener = layoutEmitter.on("resetLayout", () => {
      resetDefaultLayouts();
      this.rebuildLayout();
    });
    const unbindHighlightListener = layoutEmitter.on("highlightTab", () => {
      const config = this.gl.toConfig();
      console.log(config);
      // console.log(this.gl.getComponent("Trees"));
      // console.log(this.gl.getComponent("Tree"));
      const findTabToHighlight = currentContainer => {
        if (currentContainer.type === "component") {
          return;
        }
        const indexOfTabToHighlight = currentContainer.content.findIndex(childContent => {
          const a = childContent.type === "component" && childContent.title === "Trees";
          return a;
        });
        if (indexOfTabToHighlight >= 0) {
          console.log("found at", indexOfTabToHighlight);
          if (currentContainer.type === "stack") {
            // We can only bring forth a tab within a stack, not within a row.
            currentContainer.activeItemIndex = indexOfTabToHighlight;
          }
        } else if (currentContainer.type !== "component") {
          currentContainer.content.forEach(childContent => findTabToHighlight(childContent));
        }
      };
      findTabToHighlight(config);
      this.rebuildLayout(config);
    });
    const unbindChangedScaleListener = listenToStoreProperty(
      store => store.userConfiguration.layoutScaleValue,
      () => {
        updateSizeDebounced();
      },
      true,
    );
    const unbindMaximizeListener = this.attachMaximizeListener();

    gl.on("stateChanged", () => this.onStateChange());

    this.unbindListeners = [
      unbindResetListener,
      unbindChangedScaleListener,
      unbindResizeListener,
      unbindMaximizeListener,
      unbindHighlightListener,
    ];

    updateSize();
    // The timeout is necessary since react cannot deal with react.render calls (which goldenlayout executes)
    // while being in the middle of a react lifecycle (componentDidMount)
    setTimeout(() => {
      try {
        gl.init();
      } catch (exception) {
        // This might happen when the serialized layout config is not compatible with the newest version.
        // However, this should be mitigated by currentLayoutVersion in default_layout_configs.js
        Toast.error("Layout couldn't be restored. The default layout is used instead.");
        Store.dispatch(setStoredLayoutsAction({}));
        layoutEmitter.emit("resetLayout");
        return;
      }
      // Rerender since the portals just became available
      this.forceUpdate();
      // Trigger initial state update so that the size of the input catchers are set up correctly
      this.onStateChange();
      // Monkeypatch the gl size getters so that the layout can be larger then the viewport (k/l scaling)
      monkeypatchGLSizeGetter(gl);
      // Ensure that the size is correct
      updateSize();
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
