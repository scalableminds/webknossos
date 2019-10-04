// @flow
import * as React from "react";
import ReactDOM from "react-dom";

import { document } from "libs/window";

// The actual content of a layout pane is a portal target,
// to which is rendered within GoldenLayoutAdapter.
// The actual portal targets are reused to avoid that components
// are re-mounted when the layout changes.
const getPortalId = id => `portal-${id}`;
const portalTargetNodes = {};
function getOrCreatePortalTargetNode(id) {
  if (!portalTargetNodes[id]) {
    const newNode = document.createElement("div");
    newNode.id = getPortalId(id);
    portalTargetNodes[id] = newNode;
  }

  return portalTargetNodes[id];
}

// This is the placeholder component which is registered with and rendered by GoldenLayout
export class PortalTarget extends React.Component<*, *> {
  componentWillUnmount() {
    const child = getOrCreatePortalTargetNode(this.props.portalId);
    child.parentNode.removeChild(child);
  }

  render() {
    const { portalId, style } = this.props;
    return (
      <div
        style={style}
        ref={node => {
          if (!node) {
            return;
          }
          const child = getOrCreatePortalTargetNode(portalId);
          node.appendChild(child);
        }}
      />
    );
  }
}

// This component is used to render the provided children into a PortalTarget (referenced by id) if that portal exists
export function RenderToPortal({ children, portalId }: { children: React.Node, portalId: string }) {
  const portalEl = document.getElementById(getPortalId(portalId));
  return portalEl && ReactDOM.createPortal(children, portalEl);
}
