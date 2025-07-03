import { Button, Input } from "antd";
import React, { useState } from "react";

type Props = {
  icon: React.ReactElement;
  label?: string;
  onChange: (value: string, event: React.SyntheticEvent<HTMLInputElement>) => void;
};

function EditableTextIcon(props: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
  };

  const handleInputSubmit = (event: React.FormEvent<HTMLInputElement>) => {
    if (value !== "") {
      props.onChange(value, event);
    }

    setIsEditing(false);
    setValue("");
  };

  if (isEditing) {
    return (
      <Input
        value={value}
        onChange={handleInputChange}
        onPressEnter={handleInputSubmit}
        onBlur={handleInputSubmit}
        style={{
          width: 75,
        }}
        size="small"
        autoFocus
      />
    );
  }

  return (
    <Button
      size="small"
      icon={props.icon}
      style={{
        height: 22,
        width: props.label ? "initial" : 22,
        fontSize: "12px",
        color: "#7c7c7c",
      }}
      onClick={() => setIsEditing(true)}
    >
      {props.label ? <span style={{ marginLeft: 0 }}>{props.label}</span> : null}
    </Button>
  );
}

export default EditableTextIcon;
