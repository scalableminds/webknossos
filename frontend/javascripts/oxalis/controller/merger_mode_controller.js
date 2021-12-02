// @flow

import { connect } from "react-redux";
import React, { PureComponent } from "react";
import _ from "lodash";

import type { OxalisState } from "oxalis/store";
import { enableMergerMode, disableMergerMode } from "oxalis/merger_mode";

import MergerModeModalView from "oxalis/view/merger_mode_modal_view";

type MergerModeControllerProps = {
  isMergerModeEnabled: boolean,
};

type State = {
  isMergerModeModalVisible: boolean,
  isMergerModeModalClosable: boolean,
  mergerModeProgress: number,
  // The component remembers for which segmentation layer,
  // the merger mode was enabled. This information is used
  // when disabling the merger mode again.
  segmentationLayerName: ?string,
};

class MergerModeController extends PureComponent<MergerModeControllerProps, State> {
  state = {
    isMergerModeModalVisible: false,
    isMergerModeModalClosable: false,
    mergerModeProgress: 0,
    segmentationLayerName: null,
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
      const segmentationLayerName = await enableMergerMode(onUpdateProgress);
      this.setState({ segmentationLayerName });
      // The modal is only closeable after the merger mode is fully enabled
      // and finished preprocessing
      this.setState({ isMergerModeModalClosable: true });
    } else {
      this.setState({
        isMergerModeModalVisible: false,
        isMergerModeModalClosable: false,
      });
      disableMergerMode(this.state.segmentationLayerName);
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
