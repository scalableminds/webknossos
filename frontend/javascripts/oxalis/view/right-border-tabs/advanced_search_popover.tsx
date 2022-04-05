import { Input, Tooltip, Popover } from "antd";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import * as React from "react";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'memo... Remove this comment to see the full error message
import memoizeOne from "memoize-one";
import ButtonComponent from "oxalis/view/components/button_component";
import Shortcut from "libs/shortcut_component";
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import { mod } from "libs/utils";
const InputGroup = Input.Group;
type Props<S> = {
  data: Array<S>;
  searchKey: keyof S;
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
  state = {
    isVisible: false,
    searchQuery: "",
    currentPosition: null,
  };
  getAvailableOptions = memoizeOne(
    (data: Array<S>, searchQuery: string, searchKey: keyof S): Array<S> =>
      searchQuery !== ""
        ? data.filter(
            (datum) => datum[searchKey].toLowerCase().indexOf(searchQuery.toLowerCase()) > -1,
          )
        : [],
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
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type 'null'.
    currentPosition = Math.min(currentPosition, numberOfAvailableOptions - 1);
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type 'null'.
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

  render() {
    const { data, searchKey, provideShortcut, children, targetId } = this.props;
    const { searchQuery, isVisible } = this.state;
    let { currentPosition } = this.state;
    const availableOptions = this.getAvailableOptions(data, searchQuery, searchKey);
    const numberOfAvailableOptions = availableOptions.length;
    // Ensure that currentPosition to not higher than numberOfAvailableOptions.
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type 'null'.
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
          visible={isVisible}
          onVisibleChange={(newVisibility) =>
            newVisibility ? this.openSearchPopover() : this.closeSearchPopover()
          }
          content={
            // Only render search components when the popover is visible
            // This ensures that the component is completely re-mounted when
            // the popover is opened. Thus unnecessary computations are avoided.
            isVisible && (
              <React.Fragment>
                <Shortcut supportInputElements keys="escape" onTrigger={this.closeSearchPopover} />
                <InputGroup
                  compact
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
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    addonAfter={`${currentPosition + 1}/${numberOfAvailableOptions}`}
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
