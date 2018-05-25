// @flow
import _ from "lodash";
import * as React from "react";
import { AutoComplete, Popover } from "antd";
import type { TreeMapType } from "oxalis/store";

const Option = AutoComplete.Option;

type Props = {
  maxSearchResults: number,
  trees: TreeMapType,
  onSelect: number => void,
  children: *,
};

export default class TreeSearchPopover extends React.PureComponent<Props, *> {
  autoComplete: ?AutoComplete<*>;

  constructor() {
    super();
    this.state = {
      isVisible: false,
      searchQuery: "",
    };
  }

  render() {
    const filterOption = (inputValue, option) => option.props.text.indexOf(inputValue) > -1;
    const filterTree = tree => tree.name.indexOf(this.state.searchQuery) > -1;

    return (
      <Popover
        title="Search Trees"
        trigger="click"
        placement="rightTop"
        visible={this.state.isVisible}
        mouseLeaveDelay={1}
        onVisibleChange={isVisible => {
          // Workaround: Wait a bit when hiding the popover, so that clicking
          // an option will be accepted as a select event.
          setTimeout(() => this.setState({ isVisible }), isVisible ? 0 : 100);
        }}
        content={
          // Only render autocomplete when the popover is visible
          // This ensures that the component is completely re-mounted when
          // the popover is opened. Thus, autoFocus works and unnecessary
          // computations are avoided.
          this.state.isVisible && (
            <AutoComplete
              autoFocus
              onSearch={searchQuery => this.setState({ searchQuery })}
              dataSource={_.values(this.props.trees)
                .filter(filterTree)
                .slice(0, this.props.maxSearchResults)
                .map(tree => (
                  <Option key={tree.treeId} text={tree.name}>
                    {tree.name}
                  </Option>
                ))}
              style={{ width: "500px" }}
              ref={autoComplete => {
                this.autoComplete = autoComplete;
              }}
              onSelect={(value, option) => {
                console.log("onSelect", value, option);
                this.props.onSelect(option.key);
                this.setState({ isVisible: false });
                if (this.autoComplete) this.autoComplete.blur();
              }}
              placeholder="Input here to search trees"
              filterOption={filterOption}
            />
          )
        }
      >
        {this.props.children}
      </Popover>
    );
  }
}
