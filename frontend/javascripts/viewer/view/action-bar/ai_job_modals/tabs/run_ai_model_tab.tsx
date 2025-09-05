import { Card, Radio, Row, Space, Switch, Tooltip } from "antd";
import { useState } from "react";
import { useDispatch } from "react-redux";
import { APIJobType } from "types/api_types";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";

import { useWkSelector } from "libs/react_hooks";
import { jobNameToImagePath } from "../constants";
import { AlignSectionsForm } from "../forms/align_sections_form";
import { CustomAiModelInferenceForm } from "../forms/custom_ai_model_inference_form";
import { MitochondriaSegmentationForm } from "../forms/mitochondria_segmentation_form";
import { NeuronSegmentationForm } from "../forms/neuron_segmentation_form";
import { NucleiDetectionForm } from "../forms/nuclei_detection_form";

export function RunAiModelTab({ aIJobDrawerState }: { aIJobDrawerState: string }) {
  const centerImageStyle = {
    margin: "auto",
    width: 220,
  };
  const isSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser || false);
  const [showCustomAiModels, setShowCustomAiModels] = useState(false);
  const dispatch = useDispatch();

  return (
    <Space direction="vertical" size="middle">
      <Row>
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <div className="flex-item">
            {showCustomAiModels
              ? "Choose one of your custom trained models from the list below."
              : "Choose a pretrained AI model to process your dataset."}
          </div>
          {isSuperUser && (
            <div className="flex-item" style={{ flexGrow: 0 }}>
              <Tooltip title="Switch between default and custom models">
                <Switch
                  checkedChildren="Custom"
                  unCheckedChildren="Default"
                  checked={showCustomAiModels}
                  disabled={!isSuperUser}
                  style={{
                    marginBottom: 6,
                  }}
                  onChange={(bool) => {
                    setShowCustomAiModels(bool);
                  }}
                />
              </Tooltip>
            </div>
          )}
        </div>
      </Row>

      {showCustomAiModels ? (
        <CustomAiModelInferenceForm />
      ) : (
        <>
          <Space align="center">
            <Radio.Button
              className="aIJobSelection"
              checked={aIJobDrawerState === APIJobType.INFER_NEURONS}
              onClick={() => dispatch(setAIJobDrawerStateAction(APIJobType.INFER_NEURONS))}
            >
              <Card bordered={false}>
                <Space direction="vertical" size="small">
                  <Row className="ai-job-title">Neuron segmentation</Row>
                  <Row>
                    <img
                      src={`/assets/images/${jobNameToImagePath.infer_neurons}`}
                      alt={"Neuron segmentation example"}
                      style={centerImageStyle}
                    />
                  </Row>
                </Space>
              </Card>
            </Radio.Button>
            <Tooltip title={!isSuperUser ? "Coming soon" : null}>
              <Radio.Button
                className="aIJobSelection"
                disabled={!isSuperUser}
                checked={aIJobDrawerState === APIJobType.INFER_MITOCHONDRIA}
                onClick={() => dispatch(setAIJobDrawerStateAction(APIJobType.INFER_MITOCHONDRIA))}
              >
                <Card bordered={false}>
                  <Space direction="vertical" size="small">
                    <Row className="ai-job-title">Mitochondria detection</Row>
                    <Row>
                      <img
                        src={`/assets/images/${jobNameToImagePath.infer_mitochondria}`}
                        alt={"Mitochondria detection example"}
                        style={centerImageStyle}
                      />
                    </Row>
                  </Space>
                </Card>
              </Radio.Button>
            </Tooltip>
            <Tooltip title="Coming soon">
              <Radio.Button
                className="aIJobSelection"
                disabled
                checked={aIJobDrawerState === APIJobType.INFER_NUCLEI}
                onClick={() => dispatch(setAIJobDrawerStateAction(APIJobType.INFER_NUCLEI))}
              >
                <Card bordered={false}>
                  <Space direction="vertical" size="small">
                    <Row className="ai-job-title">Nuclei detection</Row>
                    <Row>
                      <img
                        src={`/assets/images/${jobNameToImagePath.infer_nuclei}`}
                        alt={"Nuclei detection example"}
                        style={centerImageStyle}
                      />
                    </Row>
                  </Space>
                </Card>
              </Radio.Button>
            </Tooltip>
          </Space>
          {aIJobDrawerState === APIJobType.INFER_NEURONS ? <NeuronSegmentationForm /> : null}
          {aIJobDrawerState === APIJobType.INFER_NUCLEI ? <NucleiDetectionForm /> : null}
          {aIJobDrawerState === APIJobType.INFER_MITOCHONDRIA ? (
            <MitochondriaSegmentationForm />
          ) : null}
          {aIJobDrawerState === APIJobType.ALIGN_SECTIONS ? <AlignSectionsForm /> : null}
        </>
      )}
    </Space>
  );
}
