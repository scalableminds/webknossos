import { FileExcelOutlined } from "@ant-design/icons";
import { Button } from "antd";
import Upload, { UploadChangeParam, UploadFile } from "antd/lib/upload";
import { AsyncButton } from "components/async_clickables";
import { readFileAsText } from "libs/read_file";
import Toast from "libs/toast";
import { values } from "libs/utils";
import _ from "lodash";
import { Vector3 } from "oxalis/constants";
import { parseNml } from "oxalis/model/helpers/nml_helpers";
import React from "react";
import { tryToFetchDatasetsByName, WizardComponentProps } from "./common";
const EXPECTED_VALUE_COUNT_PER_LINE = 8;

export default function UploadFiles({ wizardContext, setWizardContext }: WizardComponentProps) {
  const fileList = wizardContext.fileList;
  const handleChange = async (info: UploadChangeParam<UploadFile<any>>) => {
    setWizardContext((oldContext) => ({
      ...oldContext,
      fileList: info.fileList,
    }));
  };

  const onPrev = () => {
    setWizardContext((oldContext) => ({
      ...oldContext,
      currentWizardStep: "SelectImportType",
    }));
  };
  const onNext = async () => {
    try {
      const sourcePoints: Vector3[] = [];
      const targetPoints: Vector3[] = [];
      if (wizardContext.composeMode === "BIG_WARP") {
        if (fileList.length !== 1 || fileList[0]?.originFileObj == null) {
          Toast.error("Expected exactly one CSV file.");
          return;
        }

        const csv = await readFileAsText(fileList[0]?.originFileObj);
        const lines = csv.split("\n");
        for (const line of lines) {
          const fields = line.split(",");
          if (fields.length !== EXPECTED_VALUE_COUNT_PER_LINE) {
            if (line.trim() !== "") {
              throw new Error(
                `Cannot interpret line in CSV file. Expected ${EXPECTED_VALUE_COUNT_PER_LINE} values, got ${fields.length}.`,
              );
            }
            continue;
          }
          const [_pointName, _enabled, x1, y1, z1, x2, y2, z2] = fields;

          const source = [x1, y1, z1].map((el) => parseInt(el.replaceAll('"', ""))) as Vector3;
          const target = [x2, y2, z2].map((el) => parseInt(el.replaceAll('"', ""))) as Vector3;
          sourcePoints.push(source);
          targetPoints.push(target);
        }

        setWizardContext((oldContext) => ({
          ...oldContext,
          sourcePoints,
          targetPoints,
          datasets: [],
          currentWizardStep: "SelectDatasets",
        }));
      } else if (wizardContext.composeMode === "WK_ANNOTATIONS") {
        if (fileList.length !== 2) {
          Toast.warning("Expected exactly two NML files.");
          return;
        }

        const nmlString1 = await readFileAsText(fileList[0]?.originFileObj!);
        const nmlString2 = await readFileAsText(fileList[1]?.originFileObj!);

        if (nmlString1 === "" || nmlString2 === "") {
          // todop unify error handling
          Toast.warning("NML files should not be empty.");
          return;
        }

        const { trees: trees1, datasetName: datasetName1 } = await parseNml(nmlString1);
        const { trees: trees2, datasetName: datasetName2 } = await parseNml(nmlString2);

        if (!datasetName1 || !datasetName2) {
          throw new Error("Could not extract dataset names.");
        }

        const nodes1 = Array.from(
          values(trees1)
            .map((tree) => Array.from(tree.nodes.values())[0])
            .values(),
        );
        const nodes2 = Array.from(
          values(trees2)
            .map((tree) => Array.from(tree.nodes.values())[0])
            .values(),
        );

        for (const [node1, node2] of _.zip(nodes1, nodes2)) {
          if ((node1 == null) !== (node2 == null)) {
            throw new Error("A tree was empty while its corresponding tree wasn't.");
          }
          if (node1 != null && node2 != null) {
            sourcePoints.push(node1.position);
            targetPoints.push(node2.position);
          }
        }

        const datasets = await tryToFetchDatasetsByName(
          [datasetName1, datasetName2],
          "Could not derive datasets from NML. Please specify these manually.",
        );

        setWizardContext((oldContext) => ({
          ...oldContext,
          datasets: datasets || [],
          sourcePoints,
          targetPoints,
          currentWizardStep: "SelectDatasets",
        }));
      }
    } catch (exception) {
      Toast.error(
        "An error occurred while importing the uploaded files. See the Browser's console for more feedback.",
      );
      console.error(exception);
    }
  };

  return (
    <div>
      <p>
        {wizardContext.composeMode === "BIG_WARP"
          ? "Please upload one CSV file that was exported by BigWarp."
          : "Please upload two NML files that contain landmarks that you created with WEBKNOSSOS."}
      </p>
      <div>
        <p>
          Landmark files ({wizardContext.composeMode === "BIG_WARP" ? "1 CSV file" : "2 NML files"}
          ):
        </p>
        <Upload.Dragger
          name="files"
          fileList={fileList}
          onChange={handleChange}
          beforeUpload={() => false}
          maxCount={2}
          multiple
        >
          <p className="ant-upload-drag-icon">
            <FileExcelOutlined
              style={{
                margin: 0,
                fontSize: 35,
              }}
            />
          </p>
          <p className="ant-upload-text">Drag your landmark files to this area</p>
          <p className="ant-upload-text-hint">...</p>
        </Upload.Dragger>
      </div>

      <Button style={{ marginTop: 16 }} onClick={onPrev}>
        Back
      </Button>

      <AsyncButton type="primary" style={{ marginTop: 16, marginLeft: 8 }} onClick={onNext}>
        Next
      </AsyncButton>
    </div>
  );
}
