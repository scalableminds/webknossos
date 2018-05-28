// @flow
import _ from "lodash";

export function TypedTemplate<T>(str: string): T => string {
  return _.template(str);
}

export default {};
