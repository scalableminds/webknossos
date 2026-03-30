import { document } from "libs/window";
import type React from "react";
import { Component } from "react";
import ReactDOM from "react-dom";

// The actual content of a layout pane is a portal target,
// to which is rendered within GoldenLayoutAdapter.
// The actual portal targets are reused to avoid that components
// are re-mounted when the layout changes.
const getPortalId = (id: string) => `portal-${id}`;

const portalTargetNodes: Record<string, HTMLElement> = {};

function getOrCreatePortalTargetNode(id: string) {
  if (!portalTargetNodes[id]) {
    const newNode = document.createElement("div");
    newNode.id = getPortalId(id);
    portalTargetNodes[id] = newNode;
  }

  return portalTargetNodes[id];
}

// This is the placeholder component to which can be rendered from somewhere else
// via RenderToPortal.
export class PortalTarget extends Component<any, any> {
  componentWillUnmount() {
    const child = getOrCreatePortalTargetNode(this.props.portalId);
    if (child.parentNode != null) {
      child.parentNode.removeChild(child);
    }
  }

  render() {
    const { portalId, style } = this.props;
    return (
      <div
        style={style}
        ref={(node) => {
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
// This component is used to render the provided children into a PortalTarget (referenced by id).
// We use getOrCreatePortalTargetNode instead of document.getElementById to avoid a race condition:
// if this component renders before PortalTarget has mounted and appended the node to the DOM,
// getElementById returns null and nothing renders. Since RenderToPortal has no way to observe
// DOM changes, it would stay blank until an unrelated re-render. Using the cached node directly
// works because React portals render into detached nodes — the content becomes visible as soon
// as PortalTarget appends the node to the DOM.
export function RenderToPortal({
  children,
  portalId,
}: {
  children: React.ReactNode;
  portalId: string;
}) {
  const portalEl = getOrCreatePortalTargetNode(portalId);
  return ReactDOM.createPortal(children, portalEl);
}
