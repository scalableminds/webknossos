// @flow

import React from "react";

import window from "libs/window";

export default class DisableGenericDnd extends React.Component<{}> {
  componentDidMount() {
    window.addEventListener("dragover", this.preventDefault, false);
    window.addEventListener("drop", this.preventDefault, false);
  }

  componentWillUnmount() {
    window.removeEventListener("dragover", this.preventDefault);
    window.removeEventListener("drop", this.preventDefault);
  }

  preventDefault = (e: Event) => {
    e.preventDefault();
  };

  render() {
    return null;
  }
}
