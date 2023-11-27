import _ from "lodash";
import React, { useRef, useState, useEffect } from "react";
import { useFetch, useInterval } from "libs/react_helpers";
import { InputNumber, Switch } from "antd";
import { AsyncButton } from "./async_clickables";

export function MatchViewer() {
  const canvasRef = useRef<any>(null);
  const width = 300;
  const height = 300;

  const [info_refresher, set_info_refresher] = useState(0);
  const refetch_info = () => set_info_refresher(info_refresher + 1);
  const [partnerIndex, setPartnerIndex] = useState(0);
  const [tilePairIndex, setTilePairIndex] = useState(0);
  const [use_flann, set_use_flann] = useState(false);
  const onChangeTilePairIndex = (value: number | null) => {
    if (value != null) {
      setTilePairIndex(value);
    }
    set_use_flann(false);
  };

  const rematch = async () => {
    await fetch(`http://localhost:8000/rematch?tile_pair_index=${tilePairIndex}`);
    set_use_flann(true);
    refetch_info();
  };

  useInterval(() => {
    setPartnerIndex((partnerIndex + 1) % 2);
  }, 500);

  const info = useFetch(
    async () => {
      return fetch(`http://localhost:8000/info?tile_pair_index=${tilePairIndex}`).then((res) =>
        res.json(),
      );
    },
    null,
    [tilePairIndex, info_refresher],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == null) {
      return;
    }
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);

    for (const tileIdx of [0, 1]) {
      let [x1, y1, x2, y2] = info.tiles[tileIdx].rect;
      x1 = Math.ceil((x1 / info.section_shape[0]) * width);
      x2 = Math.ceil((x2 / info.section_shape[0]) * width);
      y1 = Math.ceil((y1 / info.section_shape[1]) * height);
      y2 = Math.ceil((y2 / info.section_shape[1]) * height);

      // Generate a distinct color for each rectangle
      context.fillStyle = `hsla(${tileIdx * 36}, 70%, 60%, 70%)`;

      // Draw the rectangle
      context.fillRect(x1, y1, x2 - x1, y2 - y1);
    }
  }, [info]);

  console.log("info", info);
  if (info == null) {
    return null;
  }
  const { feature_distances_base, feature_distances_flann } = info;

  const feature_count = feature_distances_base.length;
  const feature_distances = use_flann ? feature_distances_flann : feature_distances_base;

  feature_distances.sort((a, b) => a - b);

  const sortedIndices = _.sortBy(
    feature_distances.map((value, index) => ({ value, index })),
    "value",
  ).map((item) => item.index);

  const images = _.range(0, Math.min(20, feature_count)).map((idx) => {
    const match_idx = sortedIndices[idx];
    return (
      match_idx && (
        <div key={match_idx} style={{ textAlign: "center" }}>
          <img
            style={{ border: "1px white solid" }}
            src={`http://localhost:8000/match_image?tile_pair_index=${tilePairIndex}&feature_index=${match_idx}&partner_index=${partnerIndex}&use_flann=${
              use_flann ? "True" : "False"
            }`}
          />
          <div>{Math.round(feature_distances[match_idx])}</div>
        </div>
      )
    );
  });

  return (
    <div>
      <Switch checked={use_flann} onChange={(bool) => set_use_flann(bool)} />
      <AsyncButton onClick={() => rematch()}>Rematch</AsyncButton>
      <div style={{ textAlign: "center" }}>
        <canvas ref={canvasRef} width={300} height={300} />
        <InputNumber value={tilePairIndex} min={0} max={100} onChange={onChangeTilePairIndex} />
        {info.tiles[0].indices.join("-")} vs {info.tiles[1].indices.join("-")}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <img
            style={{ border: "1px white solid", width: "40%" }}
            src={`http://localhost:8000/full_image?tile_pair_index=${tilePairIndex}&partner_index=0`}
          />
          <img
            style={{ border: "1px white solid", width: "40%" }}
            src={`http://localhost:8000/full_image?tile_pair_index=${tilePairIndex}&partner_index=1`}
          />
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridGap: "1rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        }}
      >
        {images}
      </div>
    </div>
  );
}
