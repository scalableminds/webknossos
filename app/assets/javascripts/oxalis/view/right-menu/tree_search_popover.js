// @flow
import _ from "lodash";
import * as React from "react";
import { AutoComplete, Popover } from "antd";
import type { TreeMapType } from "oxalis/store";
import Shortcut from "libs/shortcut_component";

const Option = AutoComplete.Option;

type Props = {
  maxSearchResults: number,
  trees: TreeMapType,
  onSelect: number => void,
  children: *,
};

export default class TreeSearchPopover extends React.PureComponent<Props, *> {
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
      <React.Fragment>
        <Shortcut
          supportInputElements
          keys="ctrl + shift + f"
          onTrigger={() => {
            this.setState({ isVisible: true });
          }}
        />
        <Popover
          title="Search Trees"
          trigger="click"
          placement="rightTop"
          visible={this.state.isVisible}
          mouseLeaveDelay={10}
          onVisibleChange={isVisible => {
            // Workaround: Wait a bit when hiding the popover, so that clicking
            // an option will be accepted as a select event.
            setTimeout(() => this.setState({ isVisible }), isVisible ? 0 : 300);
          }}
          content={
            // Only render autocomplete when the popover is visible
            // This ensures that the component is completely re-mounted when
            // the popover is opened. Thus, autoFocus works and unnecessary
            // computations are avoided.
            this.state.isVisible && (
              <React.Fragment>
                <Shortcut
                  supportInputElements
                  keys="escape"
                  onTrigger={() => {
                    this.setState({ isVisible: false });
                  }}
                />
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
                  onSelect={(value, option) => {
                    this.props.onSelect(option.key);
                    this.setState({ isVisible: false });
                  }}
                  placeholder="Input here to search trees"
                  filterOption={filterOption}
                />
              </React.Fragment>
            )
          }
        >
          {this.props.children}
        </Popover>
      </React.Fragment>
    );
  }
}
