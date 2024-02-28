import { document } from "libs/window";
import * as React from "react";
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
export class PortalTarget extends React.Component<any, any> {
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
// This component is used to render the provided children into a PortalTarget (referenced by id) if that portal exists
export function RenderToPortal({
  children,
  portalId,
}: {
  children: React.ReactNode;
  portalId: string;
}) {
  const portalEl = document.getElementById(getPortalId(portalId));
  return portalEl && ReactDOM.createPortal(children, portalEl);
}
