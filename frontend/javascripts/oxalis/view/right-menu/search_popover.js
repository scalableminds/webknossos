// @flow
import { AutoComplete, Popover } from "antd";
import * as React from "react";
import _ from "lodash";

import Shortcut from "libs/shortcut_component";

const { Option } = AutoComplete;

type Props<S> = {
  maxSearchResults: number,
  data: { +[number]: S } | Array<S>,
  searchKey: $Keys<S>,
  idKey: $Keys<S>,
  onSelect: number => void,
  children: React.Node,
  provideShortcut?: boolean,
};

type State = {
  isVisible: boolean,
  searchQuery: string,
};

export default class SearchPopover<S: Object> extends React.PureComponent<Props<S>, State> {
  constructor() {
    super();
    this.state = {
      isVisible: false,
      searchQuery: "",
    };
  }

  render() {
    const filterOption = (inputValue, option) => option.props.text.indexOf(inputValue) > -1;
    const filterData = datum => datum[this.props.searchKey].indexOf(this.state.searchQuery) > -1;

    return (
      <React.Fragment>
        {this.props.provideShortcut ? (
          <Shortcut
            supportInputElements
            keys="ctrl + shift + f"
            onTrigger={() => {
              this.setState({ isVisible: true });
            }}
          />
        ) : null}
        <Popover
          title="Search"
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
                  dataSource={_.values(this.props.data)
                    .filter(filterData)
                    .slice(0, this.props.maxSearchResults)
                    .map(datum => (
                      <Option key={datum[this.props.idKey]} text={datum[this.props.searchKey]}>
                        {datum[this.props.searchKey]}
                      </Option>
                    ))}
                  style={{ width: "500px" }}
                  onSelect={(value, option) => {
                    this.props.onSelect(option.key);
                    this.setState({ isVisible: false });
                  }}
                  placeholder="Input here to search"
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
