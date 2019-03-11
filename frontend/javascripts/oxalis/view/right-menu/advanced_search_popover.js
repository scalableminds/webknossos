// @flow
import { Icon, Input, Tooltip, Popover } from "antd";
import * as React from "react";
import _ from "lodash";
import ButtonComponent from "oxalis/view/components/button_component";

import Shortcut from "libs/shortcut_component";

const InputGroup = Input.Group;

type Props<S> = {
  data: { +[number]: S } | Array<S>,
  searchKey: $Keys<S>,
  idKey: $Keys<S>,
  onSelect: number => void,
  children: *,
  provideShortcut?: boolean,
};

type State = {
  isVisible: boolean,
  searchQuery: string,
};

export default class AdvancedSearchPopover<S: Object> extends React.PureComponent<Props<S>, State> {
  constructor(props: Props<S>) {
    super();
    this.state = {
      isVisible: false,
      searchQuery: "",
    };
    this.availableOptions = props.data;
  }

  availableOptions: { +[number]: S } | Array<S> = [];
  currentPosition: number = 0;

  selectNextOptionWithOffset = (offset: number) => {
    const lengthOfAvailableOptions = _.values(this.availableOptions).length;
    if (lengthOfAvailableOptions === 0) {
      return;
    }
    this.currentPosition = (this.currentPosition + offset) % lengthOfAvailableOptions;
    if (this.currentPosition < 0) {
      this.currentPosition = lengthOfAvailableOptions + this.currentPosition;
    }
    this.props.onSelect(_.values(this.availableOptions)[this.currentPosition][this.props.idKey]);
  };

  selectNextOption = () => {
    this.selectNextOptionWithOffset(1);
  };

  selectPreviousOption = () => {
    this.selectNextOptionWithOffset(-1);
  };

  onQueryChanged = (searchQuery: string) => {
    this.setState({ searchQuery });
    this.availableOptions = _.values(this.props.data).filter(
      datum => datum[this.props.searchKey].toLowerCase().indexOf(searchQuery.toLowerCase()) > -1,
    );
    this.currentPosition = -1;
  };

  openSearchPopover = () => {
    this.setState({ isVisible: true });
  };

  closeSearchPopover = () => {
    this.setState({ isVisible: false });
  };

  render = () => (
    <React.Fragment>
      {this.props.provideShortcut ? (
        <Shortcut supportInputElements keys="ctrl + shift + f" onTrigger={this.openSearchPopover} />
      ) : null}
      <Popover
        title="Search"
        trigger="click"
        placement="rightTop"
        visible={this.state.isVisible}
        mouseLeaveDelay={10}
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
                  style={
                    _.values(this.availableOptions).length > 0
                      ? { width: "calc(100% - 150px)" }
                      : { width: "calc(100% - 150px)", color: "red" }
                  }
                  value={this.state.searchQuery}
                  placeholder="Enter your search keywords"
                  onPressEnter={this.selectNextOption}
                  onChange={evt => this.onQueryChanged(evt.target.value)}
                  autoFocus
                />
                <Tooltip title="Previous">
                  <ButtonComponent style={{ width: 50 }} onClick={this.selectPreviousOption}>
                    <Icon type="up" />
                  </ButtonComponent>
                </Tooltip>
                <Tooltip title="Next">
                  <ButtonComponent style={{ width: 50 }} onClick={this.selectNextOption}>
                    <Icon type="down" />
                  </ButtonComponent>
                </Tooltip>
                <Tooltip title="Close">
                  <ButtonComponent style={{ width: 50 }} onClick={this.closeSearchPopover}>
                    <Icon type="close" />
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
