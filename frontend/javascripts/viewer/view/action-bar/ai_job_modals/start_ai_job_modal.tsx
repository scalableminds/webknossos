import { Modal, Tabs } from "antd";
import { useWkSelector } from "libs/react_hooks";
import _ from "lodash";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import { Store } from "viewer/singletons";
import { TrainAiModelFromAnnotationTab } from "./tabs/train_ai_model_tab";
import type { StartAIJobModalState } from "./constants";
import { AlignmentTab } from "./tabs/alignment_tab";
import { RunAiModelTab } from "./tabs/run_ai_model_tab";

export type StartAIJobModalProps = {
  aIJobModalState: StartAIJobModalState;
};

export function StartAIJobModal({ aIJobModalState }: StartAIJobModalProps) {
  const onClose = () => Store.dispatch(setAIJobModalStateAction("invisible"));
  const isSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser || false);
  const tabs = _.compact([
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
  ]);
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
