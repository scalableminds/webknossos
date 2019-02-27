// @flow

function createLayoutHelper(type) {
  return function(...content: Array<*>) {
    return {
      type,
      content,
    };
  };
}

// These functions make the API surface to golden layout a bit more concise.
// For example, instead of writing
//
//   {
//     type: "column",
//     content: [...]
//   }
//
// you can simply write
//
//   Column(...)

export const Column = createLayoutHelper("column");
export const Row = createLayoutHelper("row");
export const Stack = createLayoutHelper("stack");

export function Pane(title: string, portalId: string) {
  return {
    type: "react-component",
    component: "PortalTarget",
    title,
    props: { portalId },
  };
}
