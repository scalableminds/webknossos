// @flow

import * as React from "react";
import ReactDOM from "react-dom";
import GoldenLayout from "golden-layout/dist/goldenlayout.js";
import "golden-layout/src/css/goldenlayout-base.css";
import "golden-layout/src/css/goldenlayout-light-theme.css";

// This is the placeholder component which is registered with and rendered by GoldenLayout
class PortalTarget extends React.Component<*, *> {
  render() {
    return <div id={`portal-${this.props.portalId}`} />;
  }
}

// This component is used to render the provided children into a PortalTarget (referenced by id) if that portal exists
function RenderToPortal({ children, portalId }) {
  const portalEl = document.getElementById(`portal-${portalId}`);
  return portalEl && ReactDOM.createPortal(children, portalEl);
}

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

  componentDidMount() {
    this.setupLayout();
  }

  componentDidUpdate(prevProps: Props<*>, prevState: Props<*>) {
    if (prevProps.layoutKey !== this.props.layoutKey) {
      console.log("destroy");
      this.gl.destroy();
      this.setupLayout();
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
      gl.init();
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
      React.Children.toArray(this.props.children).map(child => {
        return (
          <RenderToPortal key={child.props.portalKey} portalId={child.props.portalKey}>
            {child}
          </RenderToPortal>
        );
      }),
    );
  }
}

export default GoldenLayoutAdapter;
