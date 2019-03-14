// @flow
import { Icon, Input, Tooltip, Popover } from "antd";
import * as React from "react";
import memoizeOne from "memoize-one";
import ButtonComponent from "oxalis/view/components/button_component";

import Shortcut from "libs/shortcut_component";

const InputGroup = Input.Group;

type Props<S> = {
  data: Array<S>,
  searchKey: $Keys<S>,
  onSelect: S => void,
  children: React.Node,
  provideShortcut?: boolean,
};

type State = {
  isVisible: boolean,
  searchQuery: string,
  currentPosition: number,
};

export default class AdvancedSearchPopover<S: Object> extends React.PureComponent<Props<S>, State> {
  state = {
    isVisible: false,
    searchQuery: "",
    currentPosition: -1,
  };

  availableOptions: Array<S> = [];

  selectNextOptionWithOffset = (offset: number) => {
    let { currentPosition } = this.state;
    const numberOfAvailableOptions = this.availableOptions.length;
    if (numberOfAvailableOptions === 0) {
      return;
    }
    currentPosition = (currentPosition + offset) % numberOfAvailableOptions;
    if (currentPosition < 0) {
      currentPosition = numberOfAvailableOptions + currentPosition;
    }
    this.setState({ currentPosition });
    this.props.onSelect(this.availableOptions[currentPosition]);
  };

  selectNextOption = () => {
    this.selectNextOptionWithOffset(1);
  };

  selectPreviousOption = () => {
    this.selectNextOptionWithOffset(-1);
  };

  onSearchQueryChanged = (searchQuery: string) => {
    this.setState({ searchQuery, currentPosition: -1 });
  };

  getAvailableOptionsFrom = memoizeOne((data: Array<S>, searchQuery: string, searchKey: $Keys<S>) =>
    searchQuery !== ""
      ? data.filter(datum => datum[searchKey].toLowerCase().indexOf(searchQuery.toLowerCase()) > -1)
      : [],
  );

  openSearchPopover = () => {
    this.setState({ isVisible: true });
  };

  closeSearchPopover = () => {
    this.setState({ isVisible: false });
  };

  render() {
    this.availableOptions = this.getAvailableOptionsFrom(
      this.props.data,
      this.state.searchQuery,
      this.props.searchKey,
    );
    const numberOfAvailableOptions = this.availableOptions.length;
    const hasNoResults = numberOfAvailableOptions === 0;
    const hasMultipleResults = numberOfAvailableOptions > 1;
    const additionalInputStyle =
      hasNoResults && this.state.searchQuery !== "" ? { color: "red" } : {};
    return (
      <React.Fragment>
        {this.props.provideShortcut ? (
          <Shortcut
            supportInputElements
            keys="ctrl + shift + f"
            onTrigger={this.openSearchPopover}
          />
        ) : null}
        <Popover
          title="Search"
          trigger="click"
          placement="rightTop"
          overlayClassName="search-input-popover"
          visible={this.state.isVisible}
          onVisibleChange={isVisible =>
            isVisible ? this.openSearchPopover() : this.closeSearchPopover()
          }
          content={
            // Only render search components when the popover is visible
            // This ensures that the component is completely re-mounted when
            // the popover is opened. Thus unnecessary computations are avoided.
            this.state.isVisible && (
              <React.Fragment>
                <Shortcut supportInputElements keys="escape" onTrigger={this.closeSearchPopover} />
                <InputGroup compact style={{ width: 450 }}>
                  <Input
                    style={{ width: "calc(100% - 100px)", ...additionalInputStyle }}
                    value={this.state.searchQuery}
                    placeholder="Enter your search keywords"
                    onPressEnter={this.selectNextOption}
                    onChange={evt => this.onSearchQueryChanged(evt.target.value)}
                    addonAfter={`${this.state.currentPosition + 1}/${numberOfAvailableOptions}`}
                    autoFocus
                  />
                  <Tooltip title="Previous">
                    <ButtonComponent
                      style={{ width: 50 }}
                      onClick={this.selectPreviousOption}
                      disabled={!hasMultipleResults}
                    >
                      <Icon type="up" />
                    </ButtonComponent>
                  </Tooltip>
                  <Tooltip title="Next">
                    <ButtonComponent
                      style={{ width: 50 }}
                      onClick={this.selectNextOption}
                      disabled={!hasMultipleResults}
                    >
                      <Icon type="down" />
                    </ButtonComponent>
                  </Tooltip>
                </InputGroup>
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
