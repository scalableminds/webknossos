// @flow

import ReactDOM from "react-dom";
import * as React from "react";

type DestroyFunction = () => void;

export default function renderIndependently(getComponent: DestroyFunction => React$Element<*>) {
  let div = document.createElement("div");
  if (!document.body) {
    return;
  }
  document.body.appendChild(div);
  function destroy() {
    const unmountResult = ReactDOM.unmountComponentAtNode(div);
    if (unmountResult && div.parentNode) {
      div.parentNode.removeChild(div);
    }
  }

  ReactDOM.render(getComponent(destroy), div);
}
