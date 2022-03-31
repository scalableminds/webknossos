// @flow
import React from "react";
import window from "libs/window";
export default class DisableGenericDnd extends React.Component<{}> {
  componentDidMount() {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'addEventListener' does not exist on type... Remove this comment to see the full error message
    window.addEventListener("dragover", this.preventDefault, false);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'addEventListener' does not exist on type... Remove this comment to see the full error message
    window.addEventListener("drop", this.preventDefault, false);
  }

  componentWillUnmount() {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeEventListener' does not exist on t... Remove this comment to see the full error message
    window.removeEventListener("dragover", this.preventDefault);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeEventListener' does not exist on t... Remove this comment to see the full error message
    window.removeEventListener("drop", this.preventDefault);
  }

  preventDefault = (e: Event) => {
    e.preventDefault();
  };

  render() {
    return null;
  }
}
