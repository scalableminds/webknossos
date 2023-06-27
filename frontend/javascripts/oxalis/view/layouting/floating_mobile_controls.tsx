import { CaretDownOutlined, CaretUpOutlined } from "@ant-design/icons";
import { Button, Space } from "antd";
import * as MoveHandlers from "oxalis/controller/combinations/move_handlers";
import { layoutEmitter } from "oxalis/view/layouting/layout_persistence";
import * as React from "react";

const useRepeatedButtonTrigger = (triggerCallback: () => void, repeatDelay: number = 150) => {
  const [isPressed, setIsPressed] = React.useState(false);

  React.useEffect(() => {
    let timerId: NodeJS.Timeout;

    if (isPressed) {
      const trigger = () => {
        timerId = setTimeout(() => {
          triggerCallback();
          trigger();
        }, repeatDelay);
      };

      trigger();
    }

    return () => {
      clearTimeout(timerId);
    };
  }, [isPressed, triggerCallback]);

  const onTouchStart = () => {
    setIsPressed(true);
  };

  const onTouchEnd = () => {
    setIsPressed(false);
  };

  return { onClick: triggerCallback, onTouchStart, onTouchEnd };
};

const moveForward = () => {
  return MoveHandlers.moveW(1, true);
};
const moveBackward = () => MoveHandlers.moveW(-1, true);

export function FloatingMobileControls() {
  const moveForwardProps = useRepeatedButtonTrigger(moveForward);
  const moveBackwardProps = useRepeatedButtonTrigger(moveBackward);

  return (
    <div style={{ position: "absolute", left: 72, bottom: 72, zIndex: 100000 }}>
      <Space>
        <Button
          size="large"
          type="primary"
          shape="circle"
          style={{ width: 80, height: 80 }}
          onClick={() => layoutEmitter.emit("toggleBorder", "left")}
          icon={
            <img
              alt="Toggle left sidebar"
              src="/assets/images/icon-sidebar-hide-left-bright.svg"
              style={{ filter: "brightness(10)", transform: "scale(2)" }}
            />
          }
        />
        <Button
          size="large"
          type="primary"
          shape="circle"
          style={{ width: 80, height: 80 }}
          onClick={() => layoutEmitter.emit("toggleBorder", "right")}
          icon={
            <img
              alt="Toggle right sidebar"
              src="/assets/images/icon-sidebar-hide-right-bright.svg"
              style={{ filter: "brightness(10)", transform: "scale(2)" }}
            />
          }
        />
        <Button
          size="large"
          type="primary"
          shape="circle"
          style={{ width: 80, height: 80 }}
          icon={<CaretUpOutlined style={{ transform: "scale(2)" }} />}
          {...moveForwardProps}
        />
        <Button
          size="large"
          type="primary"
          shape="circle"
          style={{ width: 80, height: 80 }}
          icon={<CaretDownOutlined style={{ transform: "scale(2)" }} />}
          {...moveBackwardProps}
        />
        <Button
          size="large"
          type="primary"
          shape="circle"
          style={{ width: 80, height: 80 }}
          onClick={() => layoutEmitter.emit("toggleMaximize")}
          icon={
            <div
              style={{
                background:
                  "transparent url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAUCAYAAABiS3YzAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAABYlAAAWJQFJUiTwAAAAB3RJTUUH3wsOCAciLIHE4wAAAEdJREFUOMvtkksOADAERGl6b5x8eoBqo6E7b+kzJiBqqmEvaGaINIsIhydFRG8185RQVTD7RgC87yTrdPw4VIvWMzMf0DQ7CzmmFh3I1FWCAAAAAElFTkSuQmCC) no-repeat center",
                height: "100%",
                filter: "brightness(1000)",
                transform: "scale(2)",
              }}
            />
          }
        />
      </Space>
    </div>
  );
}
