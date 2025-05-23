import { FileExcelOutlined } from "@ant-design/icons";
import { Button, Upload } from "antd";
import type { UploadChangeParam, UploadFile } from "antd/lib/upload";
import { AsyncButton } from "components/async_clickables";
import ErrorHandling from "libs/error_handling";
import { readFileAsText } from "libs/read_file";
import Toast from "libs/toast";
import { SoftError } from "libs/utils";
import _ from "lodash";
import type { Vector3 } from "viewer/constants";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import {
  type FileList,
  type WizardComponentProps,
  type WizardContext,
  tryToFetchDatasetsByNameOrId,
} from "./common";

const EXPECTED_VALUE_COUNT_PER_CSV_LINE = 8;

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
      let newContextPartial: Partial<WizardContext> | null = null;
      if (wizardContext.composeMode === "BIG_WARP") {
        newContextPartial = await parseBigWarpFile(fileList);
      } else if (wizardContext.composeMode === "WK_ANNOTATIONS") {
        newContextPartial = await parseNmlFiles(fileList);
      } else {
        throw new Error("Unexpected compose mode: " + wizardContext.composeMode);
      }
      setWizardContext((oldContext) => ({
        ...oldContext,
        ...newContextPartial,
      }));
    } catch (exception) {
      if (exception instanceof SoftError) {
        Toast.warning(exception.message);
      } else {
        Toast.error(
          "An error occurred while importing the uploaded files. See the Browser's console for more details.",
        );
        ErrorHandling.notify(exception as Error);
        console.error(exception);
      }
    }
  };

  return (
    <div>
      {wizardContext.composeMode === "BIG_WARP" ? (
        <p>
          Please upload one CSV file that was exported by BigWarp. Note that the first dataset
          referenced by the CSV file will be transformed to the second referenced dataset.
        </p>
      ) : (
        <p>
          Please upload two NML files that contain landmarks that you created with WEBKNOSSOS. Note
          that the dataset that belongs to the first NML will be transformed to the dataset that
          belongs to the second NML file. The skeletons in the NML files should match each other
          exactly. This means that both NMLs should contain the same amount of trees and that the
          n-th tree of the first and second NML should have the same amount of nodes, as these will
          be aligned with each other.
        </p>
      )}

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
          maxCount={wizardContext.composeMode === "BIG_WARP" ? 1 : 2}
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
          <p className="ant-upload-text">Drag your landmark file(s) to this area</p>
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

async function parseBigWarpFile(fileList: FileList): Promise<Partial<WizardContext>> {
  const sourcePoints: Vector3[] = [];
  const targetPoints: Vector3[] = [];
  if (fileList.length !== 1 || fileList[0]?.originFileObj == null) {
    throw new SoftError("Expected exactly one CSV file.");
  }

  const csv = await readFileAsText(fileList[0]?.originFileObj);
  const lines = csv.split("\n");
  for (const line of lines) {
    const fields = line.split(",");
    if (fields.length !== EXPECTED_VALUE_COUNT_PER_CSV_LINE) {
      if (line.trim() !== "") {
        throw new SoftError(
          `Cannot interpret line in CSV file. Expected ${EXPECTED_VALUE_COUNT_PER_CSV_LINE} values, got ${fields.length}.`,
        );
      }
      continue;
    }
    const [_pointName, enabled, x1, y1, z1, x2, y2, z2] = fields;

    if (enabled) {
      const source = [x1, y1, z1].map((el) => Number.parseInt(el.replaceAll('"', ""))) as Vector3;
      const target = [x2, y2, z2].map((el) => Number.parseInt(el.replaceAll('"', ""))) as Vector3;
      sourcePoints.push(source);
      targetPoints.push(target);
    }
  }

  return {
    sourcePoints,
    targetPoints,
    datasets: [],
    currentWizardStep: "SelectDatasets",
  };
}

async function parseNmlFiles(fileList: FileList): Promise<Partial<WizardContext> | null> {
  const sourcePoints: Vector3[] = [];
  const targetPoints: Vector3[] = [];
  if (fileList.length !== 2) {
    throw new SoftError("Expected exactly two NML files.");
  }

  const nmlString1 = await readFileAsText(fileList[0]?.originFileObj!);
  const nmlString2 = await readFileAsText(fileList[1]?.originFileObj!);

  if (nmlString1 === "" || nmlString2 === "") {
    throw new SoftError("NML files should not be empty.");
  }

  // TODO: Now the datasetName stored in the nml is interpreted as the path of the dataset. -> call to legacy route is necessary.
  //  Discussion: how to handle this better?
  const { trees: trees1, datasetName: datasetDirectoryName1 } = await parseNml(nmlString1);
  const { trees: trees2, datasetName: datasetDirectoryName2 } = await parseNml(nmlString2);

  if (!datasetDirectoryName1 || !datasetDirectoryName2) {
    throw new SoftError("Could not extract dataset names.");
  }

  if (trees1.keys().toArray().length !== trees2.keys().toArray().length) {
    throw new SoftError("The two NML files should have the same tree count.");
  }

  for (const [tree1, tree2] of _.zip(
    trees1
      .values()
      .toArray()
      .sort((a, b) => a.treeId - b.treeId),
    trees2
      .values()
      .toArray()
      .sort((a, b) => a.treeId - b.treeId),
  )) {
    if (tree1 == null || tree2 == null) {
      // Satisfy TS. This should not happen, as we checked before that both tree collections
      // have the same size.
      throw new SoftError("A tree was unexpectedly parsed as null. Please try again");
    }
    const nodes1 = Array.from(tree1.nodes.values()).sort((a, b) => a.id - b.id);
    const nodes2 = Array.from(tree2.nodes.values()).sort((a, b) => a.id - b.id);
    for (const [node1, node2] of _.zip(nodes1, nodes2)) {
      if ((node1 == null) !== (node2 == null)) {
        throw new SoftError(
          `Tree ${tree1.treeId} and tree ${tree2.treeId} don't have the same amount of trees. Ensure that the NML structures match each other.`,
        );
      }
      if (node1 != null && node2 != null) {
        sourcePoints.push(node1.untransformedPosition);
        targetPoints.push(node2.untransformedPosition);
      }
    }
  }

  if (sourcePoints.length < 3) {
    throw new SoftError("Each file should contain at least 3 nodes.");
  }

  const datasets = await tryToFetchDatasetsByNameOrId(
    [datasetDirectoryName1, datasetDirectoryName2], // fetch by name
    [],
    "Could not derive datasets from NML. Please specify these manually.",
  );

  return {
    datasets: datasets || [],
    sourcePoints, // The first dataset (will be transformed to match the second later)
    targetPoints, // The second dataset (won't be transformed by default)
    currentWizardStep: "SelectDatasets",
  };
}
