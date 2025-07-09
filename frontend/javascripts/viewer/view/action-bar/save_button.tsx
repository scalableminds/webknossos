import {
  CheckOutlined,
  ExclamationCircleOutlined,
  HourglassOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { Tooltip } from "antd";
import FastTooltip from "components/fast_tooltip";
import ErrorHandling from "libs/error_handling";
import { useWkSelector } from "libs/react_hooks";
import window from "libs/window";
import _ from "lodash";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { reuseInstanceOnEquality } from "viewer/model/accessors/accessor_helpers";
import { Model } from "viewer/singletons";
import type { SaveState } from "viewer/store";
import ButtonComponent from "viewer/view/components/button_component";

type Props = {
  onClick: (arg0: React.MouseEvent<HTMLButtonElement, MouseEvent>) => Promise<any>;
  className?: string;
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

function SaveButton({ onClick, className }: Props) {
  const { progressInfo, isBusy, queue } = useWkSelector((state) => state.save);
  // For a low action count, the progress info would show only for a very short amount of time.
  // Therefore, the progressFraction is set to null, if the count is low.
  const progressFraction =
    progressInfo.totalActionCount > 5000
      ? progressInfo.processedActionCount / progressInfo.totalActionCount
      : null;
  const [isStateSaved, setIsStateSaved] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [saveInfo, setSaveInfo] = useState({
    outstandingBucketDownloadCount: 0,
    compressingBucketCount: 0,
    waitingForCompressionBucketCount: 0,
  });

  const _forceUpdate = useCallback(() => {
    const isStateSaved = Model.stateSaved();
    const oldestUnsavedTimestamp = getOldestUnsavedTimestamp(queue);

    const unsavedDuration = Math.max(
      oldestUnsavedTimestamp != null ? Date.now() - oldestUnsavedTimestamp : 0,
      Model.getLongestPushQueueWaitTime(),
    );
    const showUnsavedWarning = unsavedDuration > UNSAVED_WARNING_THRESHOLD;

    if (showUnsavedWarning) {
      reportUnsavedDurationThresholdExceeded();
    }

    const getPushQueueStats = reuseInstanceOnEquality(Model.getPushQueueStats);

    const newSaveInfo = getPushQueueStats();
    setIsStateSaved(isStateSaved);
    setShowUnsavedWarning(showUnsavedWarning);
    setSaveInfo(newSaveInfo);
  }, [queue]);

  useEffect(() => {
    // Polling can be removed once VolumeMode saving is reactive
    const savedPollingInterval = window.setInterval(_forceUpdate, SAVE_POLLING_INTERVAL);
    return () => {
      window.clearInterval(savedPollingInterval);
    };
  }, [_forceUpdate]);

  const getSaveButtonIcon = useCallback(() => {
    if (isStateSaved) {
      return <CheckOutlined />;
    } else if (isBusy) {
      return <LoadingOutlined />;
    } else {
      return <HourglassOutlined />;
    }
  }, [isStateSaved, isBusy]);

  const shouldShowProgress = isBusy && progressFraction != null;

  const { outstandingBucketDownloadCount } = saveInfo;

  const totalBucketsToCompress =
    saveInfo.waitingForCompressionBucketCount + saveInfo.compressingBucketCount;
  return (
    <ButtonComponent
      key="save-button"
      type="primary"
      onClick={onClick}
      icon={getSaveButtonIcon()}
      className={className}
      style={{
        background: showUnsavedWarning ? "var(--ant-color-error)" : undefined,
      }}
    >
      <FastTooltip
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
        {shouldShowProgress ? (
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
      </FastTooltip>
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

function getOldestUnsavedTimestamp(saveQueue: SaveState["queue"]): number | null | undefined {
  let oldestUnsavedTimestamp;

  if (saveQueue.length > 0) {
    oldestUnsavedTimestamp = saveQueue[0].timestamp;
  }

  return oldestUnsavedTimestamp;
}

export default SaveButton;
