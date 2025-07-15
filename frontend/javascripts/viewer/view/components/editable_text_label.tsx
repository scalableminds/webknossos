import { CheckOutlined, EditOutlined } from "@ant-design/icons";
import { Input, type InputProps, Space } from "antd";
import FastTooltip from "components/fast_tooltip";
import Markdown from "libs/markdown_adapter";
import Toast from "libs/toast";
import type React from "react";
import { useEffect, useState } from "react";
import { MarkdownModal } from "viewer/view/components/markdown_modal";
import type { ValidationResult } from "../left-border-tabs/modals/add_volume_layer_modal";

type Rule = {
  message?: string;
  type?: string;
  min?: number;
  validator?: (arg0: string) => ValidationResult;
};
export type EditableTextLabelProp = {
  value: string;
  onChange: (newValue: string) => any;
  rules?: Rule[];
  rows?: number;
  markdown?: boolean;
  label: string;
  margin?: number | string;
  onClick?: () => void;
  disableEditing?: boolean;
  hideEditIcon?: boolean;
  onContextMenu?: () => void;
  width?: string | number;
  iconClassName?: string;
  isInvalid?: boolean | null | undefined;
  trimValue?: boolean | null | undefined;
  onRenameStart?: (() => void) | undefined;
  onRenameEnd?: (() => void) | undefined;
};
function EditableTextLabel(props: EditableTextLabelProp) {
  const {
    value: propValue,
    onChange,
    rules = [],
    rows = 1,
    markdown,
    label,
    margin,
    onClick,
    disableEditing,
    hideEditIcon,
    onContextMenu,
    width,
    iconClassName,
    isInvalid = false,
    trimValue = false,
    onRenameStart,
    onRenameEnd,
  } = props;

  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(propValue);

  useEffect(() => {
    setValue(propValue);
  }, [propValue]);

  const handleInputChangeFromEvent = (
    event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    setValue(event.target.value);
  };

  const handleInputChange = (newValue: string) => {
    setValue(newValue);
  };

  const validateFields = () => {
    if (!rules) {
      return true;
    }
    const allRulesValid = rules.every((rule) => {
      if (rule.type === "email") {
        const re =
          /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        const isValid = re.test(value);
        if (!isValid) {
          Toast.error(rule.message);
          return false;
        }
      } else if (rule.validator != null) {
        const validationResult = rule.validator(value);
        if (!validationResult.isValid) {
          Toast.error(validationResult.message);
          return false;
        }
      } else if (rule.min != null) {
        if (value.length < rule.min) {
          Toast.error(`Length must at least be ${rule.min}.`);
          return false;
        }
      }
      return true;
    });
    return allRulesValid;
  };

  const handleOnChange = () => {
    const validateAndUpdateValue = () => {
      if (validateFields()) {
        onChange(value);
        setIsEditing(false);
        if (onRenameEnd) {
          onRenameEnd();
        }
      }
    };
    if (trimValue) {
      setValue((prevValue) => prevValue.trim());
      // afterwards validate
      validateAndUpdateValue();
    } else {
      validateAndUpdateValue();
    }
  };

  const onRename = (evt: React.MouseEvent) => {
    if (disableEditing) {
      return;
    }
    evt.stopPropagation();
    setIsEditing(true);
    if (onRenameStart) {
      onRenameStart();
    }
  };

  const iconStyle = {
    cursor: "pointer",
    marginLeft: 5,
  };
  const currentMargin = margin != null ? margin : "0 10px";
  const inputComponentProps: InputProps = {
    value: value,
    onChange: handleInputChangeFromEvent,
    onPressEnter: handleOnChange,
    style: {
      width: width != null ? width : "calc(100% - 24px)",
      margin: currentMargin,
    },
    size: "small",
    autoFocus: true,
  };
  const isInvalidStyleMaybe = isInvalid ? { color: "var(--ant-color-error)" } : {};

  if (isEditing) {
    return rows === 1 ? (
      <Space.Compact block>
        <Input {...inputComponentProps} onBlur={() => handleOnChange()} />
        <FastTooltip key="save" title={`Save ${label}`} placement="bottom">
          <CheckOutlined
            style={iconStyle}
            onClick={(evt) => {
              evt.stopPropagation();
              handleOnChange();
            }}
          />
        </FastTooltip>
      </Space.Compact>
    ) : (
      <MarkdownModal
        source={value}
        isOpen={isEditing}
        onChange={handleInputChange}
        onOk={handleOnChange}
        label={label}
      />
    );
  } else {
    return (
      <div
        style={{
          margin: currentMargin,
          display: "inline-flex",
          alignItems: "center",
        }}
        className={onClick != null ? "clickable-text" : undefined}
        onClick={onClick}
        onDoubleClick={onRename}
        onContextMenu={onContextMenu}
      >
        {markdown ? (
          <span style={isInvalidStyleMaybe}>
            <Markdown className="flex-item">{value}</Markdown>
          </span>
        ) : (
          <span style={isInvalidStyleMaybe}>{value}</span>
        )}
        {disableEditing || hideEditIcon ? null : (
          <FastTooltip key="edit" title={`Edit ${label}`} placement="bottom">
            <EditOutlined
              className={iconClassName + " " + (markdown ? "flex-item" : "")}
              style={{
                ...iconStyle,
                display: "inline",
                whiteSpace: "nowrap",
              }}
              onClick={onRename}
            />
          </FastTooltip>
        )}
      </div>
    );
  }
}

export default EditableTextLabel;
