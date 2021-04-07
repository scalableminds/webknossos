// @flow
import { Button } from "antd";
import * as React from "react";

export default function LinkButton(props: Object) {
  return <Button type="link" {...props} className="link-button" />;
}
