import React from "react";
import ReactDOM from "react-dom";
import { document } from "libs/window";
import { Provider } from "react-redux";

type DestroyFunction = () => void; // The returned promise gets resolved once the element is destroyed.

export default function renderIndependently(
  getComponent: (arg0: DestroyFunction) => React.ReactElement<React.ComponentProps<any>, any>,
): Promise<void> {
  return new Promise((resolve) => {
    import("oxalis/throttled_store").then((_Store) => {
      const Store = _Store.default;
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

      ReactDOM.render(
        // @ts-ignore
        <Provider store={Store}>{getComponent(destroy)}</Provider>,
        div,
      );
    });
  });
}
