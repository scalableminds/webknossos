import { Modal, Tabs } from "antd";
import { useWkSelector } from "libs/react_hooks";
import _ from "lodash";
import { useCallback, useMemo } from "react";
import { useDispatch } from "react-redux";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import type { StartAiJobDrawerState } from "./constants";
import { AlignmentTab } from "./tabs/alignment_tab";
import { RunAiModelTab } from "./tabs/run_ai_model_tab";
import { TrainAiModelFromAnnotationTab } from "./tabs/train_ai_model_tab";

export type StartAIJobDrawerProps = {
  aIJobDrawerState: StartAiJobDrawerState;
};

export function StartAIJobModal({ aIJobDrawerState }: StartAIJobDrawerProps) {
  const dispatch = useDispatch();
  const onClose = useCallback(() => dispatch(setAIJobDrawerStateAction("invisible")), [dispatch]);
  const isSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser || false);
  const tabs = useMemo(
    () =>
      _.compact([
        {
          label: "Run a model",
          key: "runModel",
          children: <RunAiModelTab aIJobDrawerState={aIJobDrawerState} />,
        },
        isSuperUser
          ? {
              label: "Train a model",
              key: "trainModel",
              children: <TrainAiModelFromAnnotationTab onClose={onClose} />,
            }
          : null,
        {
          label: "Alignment",
          key: "alignment",
          children: <AlignmentTab />,
        },
      ]),
    [isSuperUser, aIJobDrawerState, onClose],
  );
  return aIJobDrawerState !== "invisible" ? (
    <Modal
      width={875}
      open
      title={
        <>
          <i className="fas fa-magic icon-margin-right" />
          AI Analysis
        </>
      }
      onCancel={onClose}
      footer={null}
    >
      <Tabs items={tabs} />
    </Modal>
  ) : null;
}
