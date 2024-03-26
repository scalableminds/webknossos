import Toast from "libs/toast";
import React from "react";

import { Button, Modal, Progress, Spin, Typography } from "antd";
import { connect, useDispatch } from "react-redux";
import type { OxalisState } from "oxalis/store";
import { setSkeletonSAMModalAction } from "oxalis/model/actions/ui_actions";
const { Text } = Typography;

type Props = {
  skeletonSAMProgressPercentage: number | null;
};

function SkeletonQuickSelectModal({ skeletonSAMProgressPercentage }: Props) {
  const dispatch = useDispatch();
  const hideModal = () => dispatch(setSkeletonSAMModalAction());
  const isFinished = (skeletonSAMProgressPercentage || 0) >= 100;
  const okText = isFinished ? (
    "Proceed with Proofreading"
  ) : (
    <span>
      <Spin size="small" style={{ filter: "grayscale(1)", marginRight: 12 }} />
      Please wait until the Quick Select is done
    </span>
  );
  return skeletonSAMProgressPercentage == null ? null : (
    <Modal
      title={"Quick Select via Skeleton"}
      closable={false}
      okButtonProps={{ disabled: !isFinished }}
      width={700}
      keyboard={false}
      maskClosable={false}
      onOk={hideModal}
      zIndex={3000} // This should be displayed above the Toast created via showFollowupInterpolationToast.
      okText={okText}
      onCancel={hideModal}
      cancelButtonProps={{ style: { display: "none" } }}
      open
    >
      <div>
        WEBKNOSSOS now performs an ML-based automatic quick selection for each slice that contains
        nodes of the selected skeleton. This may take a while. Therefore, please wait until the
        prediction is completed. <br /> <br />
        After the quick selection is complete, you have the option to make corrections for each
        slice. To quickly navigate between the nodes and correct the corresponding annotations, use
        the key combinations <Text code>ctrl + ./,</Text>. When you have completed your corrections,
        you can perform a volume interpolation to label the slices between the quick selections. To
        do this, use the button at the bottom of the sticky toast in the top right corner. The toast
        is displayed as soon as the quick selection has been completed. To ignore the interpolation,
        simply close the toast.
        <Progress
          percent={skeletonSAMProgressPercentage}
          format={(percent?: number) => `${Math.round(percent || 0)}%`}
        />
      </div>
    </Modal>
  );
}

const mapStateToProps = (state: OxalisState): Props => ({
  skeletonSAMProgressPercentage: state.uiInformation.skeletonSAMProgressPercentage,
});
const connector = connect(mapStateToProps);
export default connector(SkeletonQuickSelectModal);

const TOAST_KEY = "interpolate-between-sam-slices";
export async function showFollowupInterpolationToast(): Promise<{
  shouldPerformInterpolation: boolean;
}> {
  return new Promise((resolve) => {
    Toast.info(
      <div style={{ fontSize: 14 }}>
        The Skeleton Quick Select is complete. You can now correct the predictions for each slice.
        After you have finished your corrections, you can perform volume interpolations to annotate
        the slices without predictions themselves.
        <Button
          onClick={() => {
            Toast.close(TOAST_KEY);
            resolve({ shouldPerformInterpolation: true });
          }}
          style={{ marginTop: 12, float: "right" }}
        >
          Perform Interpolation
        </Button>
      </div>,
      {
        sticky: true,
        key: TOAST_KEY,
        onClose: () => {
          Toast.close(TOAST_KEY);
          resolve({ shouldPerformInterpolation: false });
        },
      },
    );
  });
}
