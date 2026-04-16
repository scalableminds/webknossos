import Icon, { DownOutlined } from "@ant-design/icons";
import { Dropdown, Space } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWindowWidth, useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import { useDispatch } from "react-redux";
import Constants, { ControlModeEnum } from "viewer/constants";
import { getDisabledInfoForTools } from "viewer/model/accessors/disabled_tool_accessor";
import { AnnotationTool, Toolkit, Toolkits } from "viewer/model/accessors/tool_accessor";
import { setToolAction } from "viewer/model/actions/ui_actions";
import { NARROW_BUTTON_STYLE, ToolRadioButton } from "./tools/tool_helpers";

export const ToolDropdown = () => {
  const toolkit = useWkSelector((state) => state.userConfiguration.activeToolkit);
  const disabledInfoForTools = useWkSelector(getDisabledInfoForTools);
  const dispatch = useDispatch();
  const windowWidth = useWindowWidth();
  const isWiderScreen = useMemo(() => windowWidth >= Constants.NARROW_SCREEN_WIDTH, [windowWidth]);
  const isViewMode = useWkSelector(
    (state) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  );
  const showAllTools = isWiderScreen || toolkit === Toolkit.READ_ONLY_TOOLS || isViewMode;
  // todo_c
  if (showAllTools) return null;
  return (
    <ToolRadioButton name="More tools" value={null} style={NARROW_BUTTON_STYLE}>
      <Dropdown
        menu={{
          items: Toolkits[toolkit].map((tool) => {
            const isDisabled = disabledInfoForTools[tool.id].isDisabled;
            return {
              key: tool.id,
              disabled: isDisabled,
              onClick: () => dispatch(setToolAction(tool)),
              label: (
                <FastTooltip
                  title={
                    isDisabled
                      ? disabledInfoForTools[tool.id].explanation
                      : AnnotationTool[tool.id].description
                  }
                  placement="left"
                >
                  <Space size="small">
                    {tool.icon ? <Icon component={tool.icon} /> : null}
                    {tool.readableName}
                  </Space>
                </FastTooltip>
              ),
            };
          }),
        }}
      >
        <DownOutlined />
      </Dropdown>
    </ToolRadioButton>
  );
};
