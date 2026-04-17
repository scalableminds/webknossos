import { InfoCircleOutlined } from "@ant-design/icons";
import FastTooltip from "components/fast_tooltip";
import { useCallback } from "react";
import type { APIDataLayer, APIDataset } from "types/api_types";
import { getElementClass, getMagInfo } from "viewer/model/accessors/dataset_accessor";
import ButtonComponent from "viewer/view/components/button_component";

export default function LayerInfoIconWithTooltip({
  layer,
  dataset,
}: {
  layer: APIDataLayer;
  dataset: APIDataset;
}) {
  const renderTooltipContent = useCallback(() => {
    const elementClass = getElementClass(dataset, layer.name);
    const magInfo = getMagInfo(layer.mags);
    const mags = magInfo.getMagList();
    return (
      <div>
        <div>Data Type: {elementClass}</div>
        <div>
          Available magnifications:
          <ul>
            {mags.map((r) => (
              <li key={r.join()}>{r.join("-")}</li>
            ))}
          </ul>
        </div>
        Bounding Box:
        <table style={{ borderSpacing: 2, borderCollapse: "separate" }}>
          <tbody>
            <tr>
              <td />
              <td style={{ fontSize: 10 }}>X</td>
              <td style={{ fontSize: 10 }}>Y</td>
              <td style={{ fontSize: 10 }}>Z</td>
            </tr>
            <tr>
              <td style={{ fontSize: 10 }}>Min</td>
              <td>{layer.boundingBox.topLeft[0]}</td>
              <td>{layer.boundingBox.topLeft[1]}</td>
              <td>{layer.boundingBox.topLeft[2]}</td>
            </tr>
            <tr>
              <td style={{ fontSize: 10 }}>Max</td>
              <td>{layer.boundingBox.topLeft[0] + layer.boundingBox.width}</td>
              <td>{layer.boundingBox.topLeft[1] + layer.boundingBox.height} </td>
              <td>{layer.boundingBox.topLeft[2] + layer.boundingBox.depth}</td>
            </tr>
            <tr>
              <td style={{ fontSize: 10 }}>Size</td>
              <td>{layer.boundingBox.width} </td>
              <td>{layer.boundingBox.height} </td>
              <td>{layer.boundingBox.depth}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }, [layer, dataset]);

  return (
    <FastTooltip dynamicRenderer={renderTooltipContent} placement="left">
      <ButtonComponent
        icon={<InfoCircleOutlined />}
        disabled
        color="default"
        size="small"
        variant="text"
      />
    </FastTooltip>
  );
}
