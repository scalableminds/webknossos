import type { Rule } from "antd/es/form";
import type { APIDataLayer } from "types/api_types";

export const colorLayerMustNotBeUint24Rule = {
  validator: (_: Rule, value: APIDataLayer) => {
    if (value && value.elementClass === "uint24") {
      return Promise.reject(
        new Error(
          "The selected layer of type uint24 is not supported. Please select a different one.",
        ),
      );
    }
    return Promise.resolve();
  },
};
