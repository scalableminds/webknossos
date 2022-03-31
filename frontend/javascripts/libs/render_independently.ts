import ReactDOM from "react-dom";
import { document } from "libs/window";
type DestroyFunction = () => void; // The returned promise gets resolved once the element is destroyed.

export default function renderIndependently(
  getComponent: (arg0: DestroyFunction) => React.ReactElement<React.ComponentProps<any>, any>,
): Promise<void> {
  return new Promise((resolve) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'createElement' does not exist on type 'D... Remove this comment to see the full error message
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
