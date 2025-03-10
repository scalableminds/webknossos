import { Button, type ButtonProps } from "antd";

// This component should be used instead of <a href="#" onClick={} />.
// One advantage of this component is that clicking the link button won't scroll
// up (which would happen with <a ... /> if not handled otherwise)

export default function LinkButton(props: ButtonProps) {
  return <Button type="link" {...props} className="link-button" />;
}
