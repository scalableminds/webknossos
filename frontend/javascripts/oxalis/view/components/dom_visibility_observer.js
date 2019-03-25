// @flow
import * as React from "react";

// This component uses an IntersectionObserver to find out if the element with the id targetId
// is visible in the current viewport or not. It then calls its children render function with that value.
// This allows to not render performance-heavy components or to disable shortcuts if their golden layout tab is not visible.

type Props = {
  targetId: string,
  children: (isVisibleInDom: boolean) => React.Node,
};

type State = {
  isVisibleInDom: boolean,
};

export default class DomVisibilityObserver extends React.Component<Props, State> {
  observer: ?IntersectionObserver;
  target: ?HTMLElement;
  timeoutId: ?TimeoutID;

  state = {
    isVisibleInDom: true,
  };

  componentDidMount() {
    // Not supported in Safari as of now (see https://caniuse.com/#search=intersectionobserver)
    if (
      "IntersectionObserver" in window &&
      "IntersectionObserverEntry" in window &&
      "isIntersecting" in window.IntersectionObserverEntry.prototype
    ) {
      this.attachObserver();
    }
  }

  componentWillUnmount() {
    if (this.observer != null && this.target != null) this.observer.unobserve(this.target);
    if (this.timeoutId != null) clearTimeout(this.timeoutId);
  }

  attachObserver = () => {
    const target = document.getElementById(this.props.targetId);
    if (target != null) {
      const callback = interactionEntries =>
        this.setState({ isVisibleInDom: interactionEntries[0].isIntersecting });
      this.observer = new IntersectionObserver(callback, {});
      this.observer.observe(target);
      this.target = target;
    } else {
      this.timeoutId = setTimeout(this.attachObserver, 1000);
    }
  };

  render() {
    return this.props.children(this.state.isVisibleInDom);
  }
}
