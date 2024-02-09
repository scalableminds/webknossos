import { connect } from "react-redux";
import React from "react";
import _ from "lodash";
import Store, { SaveState } from "oxalis/store";
import type { OxalisState, IsBusyInfo } from "oxalis/store";
import { isBusy } from "oxalis/model/accessors/save_accessor";
import ButtonComponent from "oxalis/view/components/button_component";
import { Model } from "oxalis/singletons";
import window from "libs/window";
import { Tooltip } from "antd";
import {
  CheckOutlined,
  ExclamationCircleOutlined,
  HourglassOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import ErrorHandling from "libs/error_handling";
import * as Utils from "libs/utils";
type OwnProps = {
  onClick: (arg0: React.MouseEvent<HTMLButtonElement, MouseEvent>) => Promise<any>;
  className?: string;
};
type StateProps = {
  progressFraction: number | null | undefined;
  isBusyInfo: IsBusyInfo;
};
type Props = OwnProps & StateProps;
type State = {
  isStateSaved: boolean;
  showUnsavedWarning: boolean;
  saveInfo: {
    outstandingBucketDownloadCount: number;
    compressingBucketCount: number;
    waitingForCompressionBucketCount: number;
  };
};
const SAVE_POLLING_INTERVAL = 1000; // 1s

const UNSAVED_WARNING_THRESHOLD = 2 * 60 * 1000; // 2 min

const REPORT_THROTTLE_THRESHOLD = 10 * 60 * 1000; // 10 min

const reportUnsavedDurationThresholdExceeded = _.throttle(() => {
  ErrorHandling.notify(
    new Error(
      `Warning: Saving lag detected. Some changes are unsaved and older than ${Math.ceil(
        UNSAVED_WARNING_THRESHOLD / 1000 / 60,
      )} minutes.`,
    ),
  );
}, REPORT_THROTTLE_THRESHOLD);

class SaveButton extends React.PureComponent<Props, State> {
  savedPollingInterval: number = 0;
  state: State = {
    isStateSaved: false,
    showUnsavedWarning: false,
    saveInfo: {
      outstandingBucketDownloadCount: 0,
      compressingBucketCount: 0,
      waitingForCompressionBucketCount: 0,
    },
  };

  componentDidMount() {
    // Polling can be removed once VolumeMode saving is reactive
    this.savedPollingInterval = window.setInterval(this._forceUpdate, SAVE_POLLING_INTERVAL);
  }

  componentWillUnmount() {
    window.clearInterval(this.savedPollingInterval);
  }

  _forceUpdate = () => {
    const isStateSaved = Model.stateSaved();
    const oldestUnsavedTimestamp = getOldestUnsavedTimestamp(Store.getState().save.queue);

    const unsavedDuration = Math.max(
      oldestUnsavedTimestamp != null ? Date.now() - oldestUnsavedTimestamp : 0,
      Model.getLongestPushQueueWaitTime(),
    );
    const showUnsavedWarning = unsavedDuration > UNSAVED_WARNING_THRESHOLD;

    if (showUnsavedWarning) {
      reportUnsavedDurationThresholdExceeded();
    }

    const {
      compressingBucketCount,
      waitingForCompressionBucketCount,
      outstandingBucketDownloadCount,
    } = Model.getPushQueueStats();
    this.setState({
      isStateSaved,
      showUnsavedWarning,
      saveInfo: {
        outstandingBucketDownloadCount,
        compressingBucketCount,
        waitingForCompressionBucketCount,
      },
    });
  };

  getSaveButtonIcon() {
    if (this.state.isStateSaved) {
      return <CheckOutlined />;
    } else if (isBusy(this.props.isBusyInfo)) {
      return <LoadingOutlined />;
    } else {
      return <HourglassOutlined />;
    }
  }

  shouldShowProgress(): boolean {
    return isBusy(this.props.isBusyInfo) && this.props.progressFraction != null;
  }

  render() {
    const { progressFraction } = this.props;
    const { showUnsavedWarning } = this.state;
    const { outstandingBucketDownloadCount } = this.state.saveInfo;

    const totalBucketsToCompress =
      this.state.saveInfo.waitingForCompressionBucketCount +
      this.state.saveInfo.compressingBucketCount;
    return (
      <ButtonComponent
        key="save-button"
        type="primary"
        onClick={this.props.onClick}
        icon={this.getSaveButtonIcon()}
        className={this.props.className}
        style={{
          background: showUnsavedWarning ? "var(--ant-color-error)" : undefined,
        }}
      >
        <Tooltip
          title={
            // Downloading the buckets often takes longer and the progress
            // is visible (as the count will decrease continually).
            // If lots of buckets need compression, this can also take a bit.
            // Don't show both labels at the same time, because the compression
            // usually can only start after the download is finished.
            outstandingBucketDownloadCount > 0
              ? `${outstandingBucketDownloadCount} items remaining to download...`
              : totalBucketsToCompress > 0
              ? `${totalBucketsToCompress} items remaining to compress...`
              : null
          }
        >
          {this.shouldShowProgress() ? (
            <span
              style={{
                marginLeft: 8,
              }}
            >
              {Math.floor((progressFraction || 0) * 100)} %
            </span>
          ) : (
            <span className="hide-on-small-screen">Save</span>
          )}
        </Tooltip>
        {showUnsavedWarning ? (
          <Tooltip
            open
            title={`There are unsaved changes which are older than ${Math.ceil(
              UNSAVED_WARNING_THRESHOLD / 1000 / 60,
            )} minutes. Please ensure that your Internet connection works and wait until this warning disappears.`}
            placement="bottom"
          >
            <ExclamationCircleOutlined />
          </Tooltip>
        ) : null}
      </ButtonComponent>
    );
  }
}

function getOldestUnsavedTimestamp(saveQueue: SaveState["queue"]): number | null | undefined {
  let oldestUnsavedTimestamp;

  if (saveQueue.skeleton.length > 0) {
    oldestUnsavedTimestamp = saveQueue.skeleton[0].timestamp;
  }

  for (const volumeQueue of Utils.values(saveQueue.volumes)) {
    if (volumeQueue.length > 0) {
      const oldestVolumeTimestamp = volumeQueue[0].timestamp;
      oldestUnsavedTimestamp = Math.min(
        oldestUnsavedTimestamp != null ? oldestUnsavedTimestamp : Infinity,
        oldestVolumeTimestamp,
      );
    }
  }

  return oldestUnsavedTimestamp;
}

function mapStateToProps(state: OxalisState): StateProps {
  const { progressInfo, isBusyInfo } = state.save;
  return {
    isBusyInfo,
    // For a low action count, the progress info would show only for a very short amount of time.
    // Therefore, the progressFraction is set to null, if the count is low.
    progressFraction:
      progressInfo.totalActionCount > 5000
        ? progressInfo.processedActionCount / progressInfo.totalActionCount
        : null,
  };
}

const connector = connect(mapStateToProps);
export default connector(SaveButton);
