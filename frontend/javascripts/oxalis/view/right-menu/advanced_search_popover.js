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
  currentPosition: ?number,
};

export default class AdvancedSearchPopover<S: Object> extends React.PureComponent<Props<S>, State> {
  state = {
    isVisible: false,
    searchQuery: "",
    currentPosition: null,
  };

  availableOptions: Array<S> = [];

  selectNextOptionWithOffset = (offset: number) => {
    let { currentPosition } = this.state;
    const numberOfAvailableOptions = this.availableOptions.length;
    if (numberOfAvailableOptions === 0) {
      return;
    }
    if (currentPosition == null) {
      // If there was no previous currentPosition for the current search query,
      // set currentPosition to an inital value.
      currentPosition = offset >= 0 ? -1 : numberOfAvailableOptions;
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

  getAvailableOptionsFrom = memoizeOne(
    (data: Array<S>, searchQuery: string, searchKey: $Keys<S>): Array<S> =>
      searchQuery !== ""
        ? data.filter(
            datum => datum[searchKey].toLowerCase().indexOf(searchQuery.toLowerCase()) > -1,
          )
        : [],
  );

  openSearchPopover = () => {
    this.setState({ isVisible: true });
  };

  closeSearchPopover = () => {
    this.setState({ isVisible: false });
  };

  render() {
    const { data, searchKey, provideShortcut, children } = this.props;
    const { searchQuery, isVisible } = this.state;
    let { currentPosition } = this.state;
    currentPosition = currentPosition == null ? -1 : currentPosition;
    this.availableOptions = this.getAvailableOptionsFrom(data, searchQuery, searchKey);
    const numberOfAvailableOptions = this.availableOptions.length;
    const hasNoResults = numberOfAvailableOptions === 0;
    const hasMultipleResults = numberOfAvailableOptions > 1;
    const additionalInputStyle = hasNoResults && searchQuery !== "" ? { color: "red" } : {};
    return (
      <React.Fragment>
        {provideShortcut ? (
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
          visible={isVisible}
          onVisibleChange={newVisibility =>
            newVisibility ? this.openSearchPopover() : this.closeSearchPopover()
          }
          content={
            // Only render search components when the popover is visible
            // This ensures that the component is completely re-mounted when
            // the popover is opened. Thus unnecessary computations are avoided.
            isVisible && (
              <React.Fragment>
                <Shortcut supportInputElements keys="escape" onTrigger={this.closeSearchPopover} />
                <InputGroup compact style={{ width: 450 }}>
                  <Input
                    style={{ width: "calc(100% - 100px)", ...additionalInputStyle }}
                    value={searchQuery}
                    placeholder="Enter your search keywords"
                    onPressEnter={this.selectNextOption}
                    onChange={evt =>
                      this.setState({ searchQuery: evt.target.value, currentPosition: null })
                    }
                    addonAfter={`${currentPosition + 1}/${numberOfAvailableOptions}`}
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
          {children}
        </Popover>
      </React.Fragment>
    );
  }
}
