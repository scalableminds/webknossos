import { Modal, Tabs } from "antd";
import { useWkSelector } from "libs/react_hooks";
import _ from "lodash";
import { useCallback, useMemo } from "react";
import { useDispatch } from "react-redux";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import type { StartAIJobModalState } from "./constants";
import { AlignmentTab } from "./tabs/alignment_tab";
import { RunAiModelTab } from "./tabs/run_ai_model_tab";
import { TrainAiModelFromAnnotationTab } from "./tabs/train_ai_model_tab";

export type StartAIJobModalProps = {
  aIJobModalState: StartAIJobModalState;
};

export function StartAIJobModal({ aIJobModalState }: StartAIJobModalProps) {
  const dispatch = useDispatch();
  const onClose = useCallback(() => dispatch(setAIJobModalStateAction("invisible")), [dispatch]);
  const isSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser || false);
  const tabs = useMemo(
    () =>
      _.compact([
        {
          label: "Run a model",
          key: "runModel",
          children: <RunAiModelTab aIJobModalState={aIJobModalState} />,
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
    [isSuperUser, aIJobModalState, onClose],
  );
  return aIJobModalState !== "invisible" ? (
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
