import { document } from "libs/window";
import type React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import GlobalThemeProvider from "theme";

type DestroyFunction = () => void; // The returned promise gets resolved once the element is destroyed.

export default function renderIndependently(
  getComponent: (arg0: DestroyFunction) => React.ReactElement<React.ComponentProps<any>, any>,
): Promise<void> {
  return new Promise((resolve) => {
    // Avoid circular imports
    import("viewer/throttled_store").then((_Store) => {
      const Store = _Store.default;
      const div = document.createElement("div");
      const react_root = createRoot(div);

      if (!document.body) {
        resolve();
        return;
      }

      document.body.appendChild(div);

      function destroy() {
        react_root.unmount();

        if (div.parentNode) {
          div.parentNode.removeChild(div);
        }

        resolve();
      }

      react_root.render(
        // @ts-ignore
        <Provider store={Store}>
          <GlobalThemeProvider isMainProvider={false}>{getComponent(destroy)}</GlobalThemeProvider>
        </Provider>,
      );
    });
  });
}
