// @flow

import ReactDOM from "react-dom";

import { document } from "libs/window";

type DestroyFunction = () => void;

// The returned promise gets resolved once the element is destroyed.
export default function renderIndependently(
  getComponent: DestroyFunction => React$Element<*>,
): Promise<void> {
  return new Promise(resolve => {
    const div = document.createElement("div");
    if (!document.body) {
      resolve();
      return;
    }
    document.body.appendChild(div);
    function destroy() {
      const unmountResult = ReactDOM.unmountComponentAtNode(div);
      if (unmountResult && div.parentNode) {
        div.parentNode.removeChild(div);
      }
      resolve();
    }

    ReactDOM.render(getComponent(destroy), div);
  });
}
