import { CloseOutlined } from "@ant-design/icons";
import { Alert, Col, InputNumber, Row, Spin } from "antd";
import FastTooltip from "components/fast_tooltip";
import { Slider } from "components/slider";
import { roundTo } from "libs/utils";
import { debounce, range } from "lodash";
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import type { APIHistogramData, ElementClass, HistogramDatum } from "types/api_types";
import { PRIMARY_COLOR, type Vector3 } from "viewer/constants";
import { updateLayerSettingAction } from "viewer/model/actions/settings_actions";
import type { DatasetLayerConfiguration } from "viewer/store";

type Props = {
  data: APIHistogramData | null | undefined;
  layerName: string;
  intensityRangeMin: number;
  intensityRangeMax: number;
  min?: number;
  max?: number;
  isInEditMode: boolean;
  defaultMinMax: readonly [number, number];
  supportFractions: boolean;
  reloadHistogram: () => void;
};

const uint24Colors = [
  [255, 65, 54],
  [46, 204, 64],
  [24, 144, 255],
];
const CANVAS_HEIGHT = 100;
const CANVAS_WIDTH = 318;

export function isHistogramSupported(elementClass: ElementClass): boolean {
  // This function needs to be adapted when a new dtype should/element class needs
  // to be supported.
  // Note that histograms are only supported for color layers. This is why
  // (u)int64 is not listed here.
  return ["int8", "uint8", "int16", "uint16", "uint24", "uint32", "int32", "float"].includes(
    elementClass,
  );
}

function getMinAndMax({ min, max, data, defaultMinMax }: Props) {
  if (min != null && max != null) {
    return {
      min,
      max,
    };
  }

  if (data == null) {
    return {
      min: defaultMinMax[0],
      max: defaultMinMax[1],
    };
  }

  const dataMin = Math.min(...data.map(({ min: minOfHistPart }) => minOfHistPart));
  const dataMax = Math.max(...data.map(({ max: maxOfHistPart }) => maxOfHistPart));
  return {
    min: dataMin,
    max: dataMax,
  };
}

function getPrecisionOf(num: number): number {
  const decimals = num.toString().split(".")[1];
  return decimals ? decimals.length : 0;
}

const DUMMY_HISTOGRAM_DATA = [
  // Define a dummy histogram with a gaussian curve (mean=128 and std=30).
  // This is used as a fallback for a nicer look. On top of that, an error
  // message will be rendered.
  {
    numberOfElements: 255,
    elementCounts: range(255).map((idx) => Math.exp(-0.5 * ((idx - 128) / 30) ** 2)),
    min: 0,
    max: 255,
  },
];

const Histogram: React.FC<Props> = (props) => {
  const {
    data,
    layerName,
    intensityRangeMin,
    intensityRangeMax,
    isInEditMode,
    defaultMinMax,
    supportFractions,
    reloadHistogram,
  } = props;

  const dispatch = useDispatch();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { min, max } = getMinAndMax(props);
  const [currentMin, setCurrentMin] = useState(min);
  const [currentMax, setCurrentMax] = useState(max);

  const onChangeLayer = useCallback(
    (
      layerName: string,
      propertyName: keyof DatasetLayerConfiguration,
      value: [number, number] | number | boolean,
    ) => {
      dispatch(updateLayerSettingAction(layerName, propertyName, value));
    },
    [dispatch],
  );

  const getPrecision = () => Math.max(getPrecisionOf(currentMin), getPrecisionOf(currentMax)) + 3;

  const drawHistogram = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      histogram: HistogramDatum,
      maxValue: number,
      color: Vector3,
      minRange: number,
      maxRange: number,
    ) => {
      const { intensityRangeMin, intensityRangeMax } = props;
      const { min: histogramMin, max: histogramMax, elementCounts } = histogram;
      const histogramLength = histogramMax - histogramMin;
      const fullLength = maxRange - minRange;
      const xOffset = histogramMin - minRange;
      ctx.fillStyle = `rgba(${color.join(",")}, 0.1)`;
      ctx.strokeStyle = `rgba(${color.join(",")})`;
      ctx.beginPath();
      // Scale data to the height of the histogram canvas.
      const downscaledData = elementCounts.map((value) => (value / maxValue) * CANVAS_HEIGHT);
      const activeRegion = new Path2D();
      ctx.moveTo(0, 0);
      activeRegion.moveTo(((intensityRangeMin - minRange) / fullLength) * CANVAS_WIDTH, 0);

      for (let i = 0; i < downscaledData.length; i++) {
        const xInHistogramScale = (i * histogramLength) / downscaledData.length;
        const xInCanvasScale = ((xOffset + xInHistogramScale) * CANVAS_WIDTH) / fullLength;
        const xValue = histogramMin + xInHistogramScale;

        if (xValue >= intensityRangeMin && xValue <= intensityRangeMax) {
          activeRegion.lineTo(xInCanvasScale, downscaledData[i]);
        }

        ctx.lineTo(xInCanvasScale, downscaledData[i]);
      }

      ctx.stroke();
      ctx.closePath();
      const activeRegionRightLimit = Math.min(histogramMax, intensityRangeMax);
      const activeRegionLeftLimit = Math.max(histogramMin, intensityRangeMin);
      activeRegion.lineTo(((activeRegionRightLimit - minRange) / fullLength) * CANVAS_WIDTH, 0);
      activeRegion.lineTo(((activeRegionLeftLimit - minRange) / fullLength) * CANVAS_WIDTH, 0);
      activeRegion.closePath();
      ctx.fill(activeRegion);
    },
    [props],
  );

  const updateCanvas = useCallback(() => {
    if (canvasRef.current == null) {
      return;
    }

    const ctx = canvasRef.current.getContext("2d");
    if (ctx == null) {
      return;
    }
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const { min, max } = props.data != null ? getMinAndMax(props) : DUMMY_HISTOGRAM_DATA[0];
    const data = props.data ?? DUMMY_HISTOGRAM_DATA;

    // Compute the overall maximum count, so the RGB curves are scaled correctly relative to each other.
    const maxValue = Math.max(
      ...data.map(({ elementCounts, min: histogramMin, max: histogramMax }) => {
        // We only take the elements of the array into account that are displayed.
        const displayedPartStartOffset = Math.max(histogramMin, min) - histogramMin;
        const displayedPartEndOffset = Math.min(histogramMax, max) - histogramMin;
        // Here we scale the offsets to the range of the elements array.
        const startingIndex =
          (displayedPartStartOffset * elementCounts.length) / (histogramMax - histogramMin);
        const endingIndex =
          (displayedPartEndOffset * elementCounts.length) / (histogramMax - histogramMin);
        return Math.max(...elementCounts.slice(startingIndex, endingIndex + 1));
      }),
    );

    for (const [i, histogram] of data.entries()) {
      const color = data.length > 1 ? uint24Colors[i] : PRIMARY_COLOR;
      drawHistogram(ctx, histogram, maxValue, color as Vector3, min, max);
    }
  }, [props, drawHistogram]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Update min/max when the data changes.
  useEffect(() => {
    const { min, max } = getMinAndMax(props);
    setCurrentMin(min);
    setCurrentMax(max);
  }, [props.min, props.max]);

  useEffect(() => {
    updateCanvas();
  });

  useLayoutEffect(() => {
    if (canvasRef.current == null) {
      return;
    }

    const ctx = canvasRef.current.getContext("2d");
    if (ctx == null) {
      return;
    }
    ctx.translate(0, CANVAS_HEIGHT);
    ctx.scale(1, -1);
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    updateCanvas();
  }, [updateCanvas]);

  const onThresholdChange = (values: number[]) => {
    const [firstVal, secVal] = values;

    if (firstVal < secVal) {
      onChangeLayer(layerName, "intensityRange", [firstVal, secVal]);
    } else {
      onChangeLayer(layerName, "intensityRange", [secVal, firstVal]);
    }
  };

  const tipFormatter = (value: number | undefined) => {
    if (value == null) {
      return "invalid";
    }
    return value >= 100000 || (value < 0.001 && value > -0.001 && value !== 0)
      ? value.toExponential()
      : roundTo(value, getPrecision()).toString();
  };

  const maybeWarning =
    data === null ? (
      <Alert
        type="warning"
        style={{ margin: 10 }}
        message={
          <>
            Histogram couldn’t be fetched.{" "}
            <a href="#" onClick={reloadHistogram}>
              Retry
            </a>
          </>
        }
        showIcon
      />
    ) : null;

  const { min: minRange, max: maxRange } = getMinAndMax(props);

  const tooltipTitleFor = (minimumOrMaximum: string) =>
    `Enter the ${minimumOrMaximum} possible value for layer ${layerName}. Scientific (e.g. 9e+10) notation is supported.`;

  const minMaxInputStyle = {
    width: "100%",
  };
  const maybeCeilFn = supportFractions ? (val: number) => val : Math.ceil;
  return (
    <Spin spinning={data === undefined}>
      <div style={{ display: "grid", placeItems: "center", position: "relative" }}>
        {maybeWarning && <div style={{ position: "absolute", zIndex: 1 }}>{maybeWarning}</div>}
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{ opacity: maybeWarning ? 0.5 : 1 }}
        />
      </div>
      <Slider
        range
        value={[intensityRangeMin, intensityRangeMax]}
        min={minRange}
        max={maxRange}
        defaultValue={[minRange, maxRange]}
        onChange={onThresholdChange}
        onChangeComplete={onThresholdChange}
        step={maybeCeilFn((maxRange - minRange) / 255)}
        tooltip={{ formatter: tipFormatter }}
        style={{
          width: CANVAS_WIDTH,
          margin: 0,
          marginTop: 6,
        }}
      />
      {isInEditMode ? (
        <Row
          align="middle"
          style={{
            marginTop: 6,
          }}
        >
          <Col span={3}>
            <label className="setting-label">Min:</label>
          </Col>
          <Col span={8}>
            <FastTooltip title={tooltipTitleFor("minimum")}>
              <InputNumber
                size="small"
                min={defaultMinMax[0]}
                max={maxRange}
                defaultValue={currentMin}
                value={currentMin}
                variant="borderless"
                onChange={(value) => {
                  // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
                  value = Number.parseFloat(value);

                  if (value <= maxRange) {
                    setCurrentMin(value);
                    onChangeLayer(layerName, "min", value);
                  }
                }}
                style={minMaxInputStyle}
              />
            </FastTooltip>
          </Col>
          <Col span={3}>
            <label
              className="setting-label"
              style={{
                width: "100%",
                textAlign: "center",
              }}
            >
              Max:
            </label>
          </Col>
          <Col span={8}>
            <FastTooltip title={tooltipTitleFor("maximum")}>
              <InputNumber
                size="small"
                min={minRange}
                max={defaultMinMax[1]}
                defaultValue={currentMax}
                value={currentMax}
                variant="borderless"
                onChange={(value) => {
                  // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
                  value = Number.parseFloat(value);

                  if (value >= minRange) {
                    setCurrentMax(value);
                    onChangeLayer(layerName, "max", value);
                  }
                }}
                style={minMaxInputStyle}
              />
            </FastTooltip>
          </Col>
          <FastTooltip title="Stop editing histogram range">
            <Col
              span={2}
              style={{ textAlign: "right", cursor: "pointer" }}
              onClick={() => onChangeLayer(layerName, "isInEditMode", !isInEditMode)}
            >
              <CloseOutlined />
            </Col>
          </FastTooltip>
        </Row>
      ) : null}
    </Spin>
  );
};

export default Histogram;
