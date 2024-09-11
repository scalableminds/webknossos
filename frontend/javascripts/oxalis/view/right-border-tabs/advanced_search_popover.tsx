import { Input, Tooltip, Popover, Space, type InputRef } from "antd";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import * as React from "react";
import memoizeOne from "memoize-one";
import ButtonComponent from "oxalis/view/components/button_component";
import Shortcut from "libs/shortcut_component";
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import { mod } from "libs/utils";

type Props<S> = {
  data: S[];
  searchKey: keyof S | ((item: S) => string);
  onSelect: (arg0: S) => void;
  children: React.ReactNode;
  provideShortcut?: boolean;
  targetId: string;
};

type State = {
  isVisible: boolean;
  searchQuery: string;
  currentPosition: number | null | undefined;
};

export default class AdvancedSearchPopover<
  S extends Record<string, any>,
> extends React.PureComponent<Props<S>, State> {
  state: State = {
    isVisible: false,
    searchQuery: "",
    currentPosition: null,
  };

  getAvailableOptions = memoizeOne(
    (data: S[], searchQuery: string, searchKey: Props<S>["searchKey"]): S[] => {
      const searchKeyFn =
        typeof searchKey === "string"
          ? (element: S) => element[searchKey]
          : (searchKey as (s: S) => string);
      return searchQuery !== ""
        ? data.filter(
            (datum) => searchKeyFn(datum).toLowerCase().indexOf(searchQuery.toLowerCase()) > -1,
          )
        : [];
    },
  );

  selectNextOptionWithOffset = (offset: number) => {
    const { data, searchKey } = this.props;
    const { searchQuery } = this.state;
    let { currentPosition } = this.state;
    const availableOptions = this.getAvailableOptions(data, searchQuery, searchKey);
    const numberOfAvailableOptions = availableOptions.length;

    if (numberOfAvailableOptions === 0) {
      return;
    }

    if (currentPosition == null) {
      // If there was no previous currentPosition for the current search query,
      // set currentPosition to an initial value.
      currentPosition = offset >= 0 ? -1 : numberOfAvailableOptions;
    }

    // It can happen that currentPosition > availableOptions.length if trees are deleted.
    // In that case taking the min ensures that the last available option is treated as
    // selected and then the offset is added.
    currentPosition = Math.min(currentPosition, numberOfAvailableOptions - 1);
    currentPosition = mod(currentPosition + offset, numberOfAvailableOptions);
    this.setState({
      currentPosition,
    });
    this.props.onSelect(availableOptions[currentPosition]);
  };

  selectNextOption = () => {
    this.selectNextOptionWithOffset(1);
  };

  selectPreviousOption = () => {
    this.selectNextOptionWithOffset(-1);
  };

  openSearchPopover = () => {
    this.setState({
      isVisible: true,
    });
  };

  closeSearchPopover = () => {
    this.setState({
      isVisible: false,
    });
  };

  autoFocus = (inputElement: InputRef) => {
    if (inputElement) {
      setTimeout(() => inputElement.focus(), 0);
    }
  };

  render() {
    const { data, searchKey, provideShortcut, children, targetId } = this.props;
    const { searchQuery, isVisible } = this.state;
    let { currentPosition } = this.state;
    const availableOptions = this.getAvailableOptions(data, searchQuery, searchKey);
    const numberOfAvailableOptions = availableOptions.length;
    // Ensure that currentPosition to not higher than numberOfAvailableOptions.
    currentPosition =
      currentPosition == null ? -1 : Math.min(currentPosition, numberOfAvailableOptions - 1);
    const hasNoResults = numberOfAvailableOptions === 0;
    const hasMultipleResults = numberOfAvailableOptions > 1;
    const additionalInputStyle =
      hasNoResults && searchQuery !== ""
        ? {
            color: "red",
          }
        : {};
    return (
      <React.Fragment>
        {provideShortcut ? (
          <DomVisibilityObserver targetId={targetId}>
            {(isVisibleInDom) =>
              isVisibleInDom && (
                <Shortcut
                  supportInputElements
                  keys="ctrl + shift + f"
                  onTrigger={this.openSearchPopover}
                />
              )
            }
          </DomVisibilityObserver>
        ) : null}
        <Popover
          title="Search"
          trigger="click"
          placement="left"
          overlayClassName="search-input-popover"
          open={isVisible}
          onOpenChange={(newVisibility) =>
            newVisibility ? this.openSearchPopover() : this.closeSearchPopover()
          }
          content={
            // Only render search components when the popover is visible
            // This ensures that the component is completely re-mounted when
            // the popover is opened. Thus unnecessary computations are avoided.
            isVisible && (
              <React.Fragment>
                <Shortcut supportInputElements keys="escape" onTrigger={this.closeSearchPopover} />
                <Space.Compact
                  style={{
                    width: 450,
                  }}
                  className="compact-items compact-icons"
                >
                  <Input
                    style={{
                      width: "calc(100% - 100px)",
                      ...additionalInputStyle,
                    }}
                    value={searchQuery}
                    placeholder="Enter your search keywords"
                    onPressEnter={(event) => {
                      if (event.shiftKey) {
                        this.selectPreviousOption();
                      } else {
                        this.selectNextOption();
                      }
                    }}
                    onChange={(evt) =>
                      this.setState({
                        searchQuery: evt.target.value,
                        currentPosition: null,
                      })
                    }
                    addonAfter={`${currentPosition + 1}/${numberOfAvailableOptions}`}
                    ref={this.autoFocus}
                    autoFocus
                  />
                  <Tooltip title="Previous (shift+enter)">
                    <ButtonComponent
                      style={{
                        width: 40,
                      }}
                      onClick={this.selectPreviousOption}
                      disabled={!hasMultipleResults}
                    >
                      <UpOutlined />
                    </ButtonComponent>
                  </Tooltip>
                  <Tooltip title="Next (enter)">
                    <ButtonComponent
                      style={{
                        width: 40,
                      }}
                      onClick={this.selectNextOption}
                      disabled={!hasMultipleResults}
                    >
                      <DownOutlined />
                    </ButtonComponent>
                  </Tooltip>
                </Space.Compact>
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
