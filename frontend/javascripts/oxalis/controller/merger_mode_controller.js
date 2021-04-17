// @flow

import { connect } from "react-redux";
import React, { PureComponent } from "react";
import _ from "lodash";

import type { OxalisState } from "oxalis/store";
import { enableMergerMode, disableMergerMode } from "oxalis/merger_mode";

import MergerModeModalView from "oxalis/view/left-border-tabs/merger_mode_modal_view";

type MergerModeControllerProps = {
  isMergerModeEnabled: boolean,
};

type State = {
  isMergerModeModalVisible: boolean,
  isMergerModeModalClosable: boolean,
  mergerModeProgress: number,
};

class MergerModeController extends PureComponent<MergerModeControllerProps, State> {
  state = {
    isMergerModeModalVisible: false,
    isMergerModeModalClosable: false,
    mergerModeProgress: 0,
  };

  componentDidMount() {
    if (this.props.isMergerModeEnabled) this.handleMergerModeChange(true);
  }

  componentDidUpdate(prevProps: MergerModeControllerProps) {
    if (prevProps.isMergerModeEnabled !== this.props.isMergerModeEnabled) {
      this.handleMergerModeChange(this.props.isMergerModeEnabled);
    }
  }

  handleMergerModeChange = async (active: boolean) => {
    if (active) {
      this.setState({
        isMergerModeModalVisible: true,
        isMergerModeModalClosable: false,
        mergerModeProgress: 0,
      });
      const onUpdateProgress = mergerModeProgress => this.setState({ mergerModeProgress });
      await enableMergerMode(onUpdateProgress);
      // The modal is only closeable after the merger mode is fully enabled
      // and finished preprocessing
      this.setState({ isMergerModeModalClosable: true });
    } else {
      this.setState({
        isMergerModeModalVisible: false,
        isMergerModeModalClosable: false,
      });
      disableMergerMode();
    }
  };

  render() {
    const { isMergerModeModalVisible, isMergerModeModalClosable } = this.state;
    return (
      <React.Fragment>
        {isMergerModeModalVisible ? (
          <MergerModeModalView
            isCloseable={isMergerModeModalClosable}
            onClose={() => this.setState({ isMergerModeModalVisible: false })}
            progress={this.state.mergerModeProgress}
          />
        ) : null}
      </React.Fragment>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  isMergerModeEnabled: state.temporaryConfiguration.isMergerModeEnabled,
});

export default connect<MergerModeControllerProps, {||}, _, _, _, _>(mapStateToProps)(
  MergerModeController,
);
