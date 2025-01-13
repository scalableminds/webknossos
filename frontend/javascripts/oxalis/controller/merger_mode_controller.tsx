import { disableMergerMode, enableMergerMode } from "oxalis/merger_mode";
import type { OxalisState } from "oxalis/store";
import MergerModeModalView from "oxalis/view/merger_mode_modal_view";
import { PureComponent } from "react";
import { connect } from "react-redux";
type MergerModeControllerProps = {
  isMergerModeEnabled: boolean;
};
type State = {
  isMergerModeModalVisible: boolean;
  isMergerModeModalClosable: boolean;
  mergerModeProgress: number;
  // The component remembers for which segmentation layer,
  // the merger mode was enabled. This information is used
  // when disabling the merger mode again.
  segmentationLayerName: string | null | undefined;
};

class MergerModeController extends PureComponent<MergerModeControllerProps, State> {
  state: State = {
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

      // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'mergerModeProgress' implicitly has an '... Remove this comment to see the full error message
      const onUpdateProgress = (mergerModeProgress) =>
        this.setState({
          mergerModeProgress,
        });

      const segmentationLayerName = await enableMergerMode(onUpdateProgress);
      this.setState({
        segmentationLayerName,
      });
      // The modal is only closeable after the merger mode is fully enabled
      // and finished preprocessing
      this.setState({
        isMergerModeModalClosable: true,
      });
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

    if (!isMergerModeModalVisible) return null;

    return (
      <MergerModeModalView
        isCloseable={isMergerModeModalClosable}
        onClose={() =>
          this.setState({
            isMergerModeModalVisible: false,
          })
        }
        progress={this.state.mergerModeProgress}
      />
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  isMergerModeEnabled: state.temporaryConfiguration.isMergerModeEnabled,
});

const connector = connect(mapStateToProps);
export default connector(MergerModeController);
