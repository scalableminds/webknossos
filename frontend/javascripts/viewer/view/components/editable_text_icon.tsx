import { Button, Input } from "antd";
import type React from "react";
import { useState } from "react";

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
      className="small-add-button"
      onClick={() => setIsEditing(true)}
    >
      {props.label}
    </Button>
  );
}

export default EditableTextIcon;
