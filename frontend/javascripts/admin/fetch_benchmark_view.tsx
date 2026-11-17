// Dev-only benchmark page (/benchmark/fetch) that compares fetching bucket data
// on the main thread with fetching it via the fetch_buffer(_with_headers) web workers.
// Requests go through the real Request code paths, so the measured overhead matches the app.
import { doWithToken } from "admin/api/token";
import { getActiveDatasetsOfMyOrganization, getDataset } from "admin/rest_api";
import { Alert, Button, Card, Checkbox, Form, InputNumber, Select, Space, Table } from "antd";
import Request from "libs/request";
import { useEffect, useRef, useState } from "react";
import type { APIDataLayer, APIDataset, APIDatasetCompact } from "types/api_types";
import type { Vector3 } from "viewer/constants";

const BUCKET_WIDTH = 32;

type Mode = "main" | "workerCopy" | "workerTransfer";
const MODE_LABELS: Record<Mode, string> = {
  main: "Main thread (fetch + arrayBuffer)",
  workerCopy: "Worker, buffer copied (fetch_buffer.worker)",
  workerTransfer: "Worker, buffer transferred (fetch_buffer_with_headers.worker)",
};
const ALL_MODES: Mode[] = ["main", "workerCopy", "workerTransfer"];

type RunResult = {
  mode: Mode;
  round: number;
  totalMs: number;
  bytes: number;
  latencyP50: number;
  latencyP95: number;
  frameCount: number;
  frameP50: number;
  frameP95: number;
  frameMax: number;
  jankyFrames: number; // frames with a delta > 50 ms
  longTaskMs: number;
  longTaskCount: number;
};

type Settings = {
  requestCount: number;
  bucketsPerRequest: number;
  concurrency: number;
  rounds: number;
  mainThreadLoadMs: number;
  modes: Mode[];
};

const DEFAULT_SETTINGS: Settings = {
  requestCount: 300,
  // Mirrors BATCH_SIZE and BATCH_LIMIT in pullqueue.ts.
  bucketsPerRequest: 6,
  concurrency: 6,
  rounds: 3,
  mainThreadLoadMs: 0,
  modes: ALL_MODES,
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function median(values: number[]): number {
  return percentile(values, 50);
}

function busyWait(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Simulates main-thread work (e.g., rendering) within each frame.
  }
}

// Generates `count` bucket requests (in the server's JSON format) for a cube of buckets
// around the center of the layer's bounding box.
function createBucketBatches(
  layer: APIDataLayer,
  mag: Vector3,
  requestCount: number,
  bucketsPerRequest: number,
) {
  const totalBuckets = requestCount * bucketsPerRequest;
  const { topLeft, width, height, depth } = layer.boundingBox;
  const bucketExtent = mag.map((m) => m * BUCKET_WIDTH) as Vector3;
  const center = [topLeft[0] + width / 2, topLeft[1] + height / 2, topLeft[2] + depth / 2];
  const centerBucket = center.map((c, i) => Math.floor(c / bucketExtent[i]));
  const side = Math.ceil(Math.cbrt(totalBuckets));
  const offset = Math.floor(side / 2);
  const additionalCoordinates =
    layer.additionalAxes?.map((axis) => ({ name: axis.name, value: axis.bounds[0] })) ?? null;

  const buckets = [];
  for (let z = 0; z < side && buckets.length < totalBuckets; z++) {
    for (let y = 0; y < side && buckets.length < totalBuckets; y++) {
      for (let x = 0; x < side && buckets.length < totalBuckets; x++) {
        const bucket = [x, y, z].map((v, i) => (centerBucket[i] + v - offset) * bucketExtent[i]);
        buckets.push({
          position: bucket,
          additionalCoordinates,
          mag,
          cubeSize: BUCKET_WIDTH,
          fourBit: false,
        });
      }
    }
  }
  const batches = [];
  for (let i = 0; i < requestCount; i++) {
    batches.push(buckets.slice(i * bucketsPerRequest, (i + 1) * bucketsPerRequest));
  }
  return batches;
}

async function fetchBatch(mode: Mode, url: string, data: unknown): Promise<ArrayBuffer> {
  const baseOptions = { data, showErrorToast: false, doNotInvestigate: true };
  if (mode === "workerTransfer") {
    const { buffer } = await Request.sendJSONReceiveArraybufferWithHeaders(url, baseOptions);
    return buffer;
  }
  const options = await Request.prepareJSON(url, baseOptions);
  return Request.receiveArraybuffer(url, {
    ...options,
    useWebworkerForArrayBuffer: mode !== "main",
  });
}

// Records rAF frame deltas and long tasks while `fn` runs. Optionally burns
// `mainThreadLoadMs` per frame to simulate a busy main thread.
async function measureResponsiveness<T>(mainThreadLoadMs: number, fn: () => Promise<T>) {
  const frameDeltas: number[] = [];
  let running = true;
  let lastFrame = performance.now();
  const onFrame = (now: number) => {
    if (!running) return;
    frameDeltas.push(now - lastFrame);
    lastFrame = now;
    if (mainThreadLoadMs > 0) busyWait(mainThreadLoadMs);
    requestAnimationFrame(onFrame);
  };

  const longTasks: number[] = [];
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });
  } catch {
    // Long task API is not supported (e.g., Firefox/Safari).
    observer = null;
  }

  requestAnimationFrame((now) => {
    lastFrame = now;
    requestAnimationFrame(onFrame);
  });
  const start = performance.now();
  const result = await fn();
  const totalMs = performance.now() - start;
  running = false;
  if (observer != null) {
    // Flush pending entries before disconnecting.
    for (const entry of observer.takeRecords()) longTasks.push(entry.duration);
    observer.disconnect();
  }
  return { result, totalMs, frameDeltas, longTasks, longTasksSupported: observer != null };
}

async function runOnce(
  mode: Mode,
  round: number,
  url: string,
  batches: unknown[],
  settings: Settings,
): Promise<RunResult> {
  const latencies: number[] = [];
  let bytes = 0;
  const { totalMs, frameDeltas, longTasks } = await measureResponsiveness(
    settings.mainThreadLoadMs,
    async () => {
      let nextIndex = 0;
      const workerLoop = async () => {
        while (nextIndex < batches.length) {
          const batch = batches[nextIndex++];
          const start = performance.now();
          const buffer = await fetchBatch(mode, url, batch);
          latencies.push(performance.now() - start);
          bytes += buffer.byteLength;
        }
      };
      await Promise.all(Array.from({ length: settings.concurrency }, workerLoop));
    },
  );
  return {
    mode,
    round,
    totalMs,
    bytes,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    frameCount: frameDeltas.length,
    frameP50: percentile(frameDeltas, 50),
    frameP95: percentile(frameDeltas, 95),
    frameMax: Math.max(0, ...frameDeltas),
    jankyFrames: frameDeltas.filter((d) => d > 50).length,
    longTaskMs: longTasks.reduce((sum, d) => sum + d, 0),
    longTaskCount: longTasks.length,
  };
}

// A rAF-driven moving bar to eyeball jank while the benchmark runs.
function JankIndicator() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let handle = 0;
    const tick = (now: number) => {
      if (ref.current != null) {
        ref.current.style.transform = `translateX(${(now / 4) % 400}px)`;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, []);
  return (
    <div style={{ width: 420, height: 20, background: "#eee", position: "relative" }}>
      <div ref={ref} style={{ width: 20, height: 20, background: "#1677ff" }} />
    </div>
  );
}

const fmt = (value: number, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : "-");

function summarize(results: RunResult[]) {
  return ALL_MODES.flatMap((mode) => {
    const runs = results.filter((r) => r.mode === mode);
    if (runs.length === 0) return [];
    const pick = (key: keyof RunResult) => median(runs.map((r) => r[key] as number));
    const totalMs = pick("totalMs");
    return [
      {
        key: mode,
        mode: MODE_LABELS[mode],
        runs: runs.length,
        totalMs,
        throughput: pick("bytes") / 1024 / 1024 / (totalMs / 1000),
        latencyP50: pick("latencyP50"),
        latencyP95: pick("latencyP95"),
        fps: (pick("frameCount") / totalMs) * 1000,
        frameP95: pick("frameP95"),
        frameMax: pick("frameMax"),
        jankyFrames: pick("jankyFrames"),
        longTaskMs: pick("longTaskMs"),
      },
    ];
  });
}

const summaryColumns = [
  { title: "Mode", dataIndex: "mode" },
  { title: "Runs", dataIndex: "runs" },
  { title: "Total [ms]", dataIndex: "totalMs", render: (v: number) => fmt(v, 0) },
  { title: "MB/s", dataIndex: "throughput", render: (v: number) => fmt(v) },
  { title: "Req p50 [ms]", dataIndex: "latencyP50", render: (v: number) => fmt(v) },
  { title: "Req p95 [ms]", dataIndex: "latencyP95", render: (v: number) => fmt(v) },
  { title: "FPS", dataIndex: "fps", render: (v: number) => fmt(v) },
  { title: "Frame p95 [ms]", dataIndex: "frameP95", render: (v: number) => fmt(v) },
  { title: "Frame max [ms]", dataIndex: "frameMax", render: (v: number) => fmt(v) },
  { title: "Frames >50ms", dataIndex: "jankyFrames", render: (v: number) => fmt(v, 0) },
  { title: "Long tasks [ms]", dataIndex: "longTaskMs", render: (v: number) => fmt(v, 0) },
];

const runColumns = [
  { title: "Round", dataIndex: "round" },
  { title: "Mode", dataIndex: "mode", render: (m: Mode) => MODE_LABELS[m] },
  { title: "Total [ms]", dataIndex: "totalMs", render: (v: number) => fmt(v, 0) },
  { title: "MB", dataIndex: "bytes", render: (v: number) => fmt(v / 1024 / 1024) },
  { title: "Req p50", dataIndex: "latencyP50", render: (v: number) => fmt(v) },
  { title: "Req p95", dataIndex: "latencyP95", render: (v: number) => fmt(v) },
  { title: "Frames", dataIndex: "frameCount" },
  { title: "Frame p50", dataIndex: "frameP50", render: (v: number) => fmt(v) },
  { title: "Frame p95", dataIndex: "frameP95", render: (v: number) => fmt(v) },
  { title: "Frame max", dataIndex: "frameMax", render: (v: number) => fmt(v) },
  { title: ">50ms", dataIndex: "jankyFrames" },
  { title: "Long tasks", dataIndex: "longTaskCount" },
  { title: "Long task ms", dataIndex: "longTaskMs", render: (v: number) => fmt(v, 0) },
];

export default function FetchBenchmarkView() {
  const [datasets, setDatasets] = useState<APIDatasetCompact[]>([]);
  const [datasetId, setDatasetId] = useState<string | null>(
    new URLSearchParams(window.location.search).get("datasetId"),
  );
  const [dataset, setDataset] = useState<APIDataset | null>(null);
  const [layerName, setLayerName] = useState<string | null>(null);
  const [magIndex, setMagIndex] = useState<number>(0);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [results, setResults] = useState<RunResult[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    getActiveDatasetsOfMyOrganization().then(setDatasets, (e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (datasetId == null) return;
    setDataset(null);
    getDataset(datasetId).then(
      (ds) => {
        if (!("dataLayers" in ds.dataSource)) {
          setError("Dataset is not imported.");
          return;
        }
        const imported = ds as APIDataset;
        setDataset(imported);
        setLayerName(imported.dataSource.dataLayers[0]?.name ?? null);
        setMagIndex(0);
      },
      (e) => setError(String(e)),
    );
  }, [datasetId]);

  const layer = dataset?.dataSource.dataLayers.find((l) => l.name === layerName) ?? null;

  const run = async () => {
    if (dataset == null || layer == null) return;
    setIsRunning(true);
    setError(null);
    setResults([]);
    try {
      const mag = layer.mags[magIndex].mag;
      const batches = createBucketBatches(
        layer,
        mag,
        settings.requestCount,
        settings.bucketsPerRequest,
      );
      const collected: RunResult[] = [];
      await doWithToken(async (token) => {
        const url = `${dataset.dataStore.url}/data/datasets/${dataset.id}/layers/${layer.name}/data?token=${token}`;
        // Warm up server-side caches and spawn the workers so that all modes see the same conditions.
        setStatus("Warm-up");
        for (const mode of settings.modes) {
          await runOnce(mode, -1, url, batches.slice(0, 10), settings);
        }
        await runOnce(settings.modes[0], -1, url, batches, settings);

        for (let round = 0; round < settings.rounds; round++) {
          // Rotate the order per round so that no mode is systematically first.
          const order = settings.modes.map(
            (_, i) => settings.modes[(i + round) % settings.modes.length],
          );
          for (const mode of order) {
            setStatus(`Round ${round + 1}/${settings.rounds}: ${MODE_LABELS[mode]}`);
            const result = await runOnce(mode, round + 1, url, batches, settings);
            collected.push(result);
            setResults([...collected]);
          }
        }
      });
      setStatus("Done");
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : JSON.stringify(e));
      setStatus(null);
    } finally {
      setIsRunning(false);
    }
  };

  const copyResults = () => {
    const payload = {
      userAgent: navigator.userAgent,
      dataset: dataset?.id,
      layer: layer?.name,
      elementClass: layer?.elementClass,
      mag: layer?.mags[magIndex]?.mag,
      settings,
      summary: summarize(results),
      runs: results,
    };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  };

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K] | null) => {
    if (value != null) setSettings((s) => ({ ...s, [key]: value }));
  };

  return (
    <div className="container">
      <h2>Fetch benchmark: main thread vs. web worker</h2>
      <Card style={{ marginBottom: 16 }}>
        <Form layout="vertical" disabled={isRunning}>
          <Space wrap align="start">
            <Form.Item label="Dataset">
              <Select
                showSearch
                style={{ width: 320 }}
                value={datasetId}
                onChange={setDatasetId}
                optionFilterProp="label"
                options={datasets.map((ds) => ({ value: ds.id, label: ds.name }))}
              />
            </Form.Item>
            <Form.Item label="Layer">
              <Select
                style={{ width: 220 }}
                value={layerName}
                onChange={(name) => {
                  setLayerName(name);
                  setMagIndex(0);
                }}
                options={(dataset?.dataSource.dataLayers ?? []).map((l) => ({
                  value: l.name,
                  label: `${l.name} (${l.elementClass})`,
                }))}
              />
            </Form.Item>
            <Form.Item label="Mag">
              <Select
                style={{ width: 120 }}
                value={magIndex}
                onChange={setMagIndex}
                options={(layer?.mags ?? []).map((m, i) => ({ value: i, label: m.mag.join("-") }))}
              />
            </Form.Item>
          </Space>
          <Space wrap align="start">
            <Form.Item label="Requests per run">
              <InputNumber
                min={1}
                value={settings.requestCount}
                onChange={(v) => updateSetting("requestCount", v)}
              />
            </Form.Item>
            <Form.Item label="Buckets per request">
              <InputNumber
                min={1}
                value={settings.bucketsPerRequest}
                onChange={(v) => updateSetting("bucketsPerRequest", v)}
              />
            </Form.Item>
            <Form.Item label="Concurrent requests">
              <InputNumber
                min={1}
                value={settings.concurrency}
                onChange={(v) => updateSetting("concurrency", v)}
              />
            </Form.Item>
            <Form.Item label="Rounds">
              <InputNumber
                min={1}
                value={settings.rounds}
                onChange={(v) => updateSetting("rounds", v)}
              />
            </Form.Item>
            <Form.Item
              label="Simulated main-thread work per frame [ms]"
              help="Busy-waits in each rAF callback, e.g. to mimic rendering."
            >
              <InputNumber
                min={0}
                value={settings.mainThreadLoadMs}
                onChange={(v) => updateSetting("mainThreadLoadMs", v)}
              />
            </Form.Item>
          </Space>
          <Form.Item label="Modes">
            <Checkbox.Group
              value={settings.modes}
              onChange={(modes) => updateSetting("modes", modes as Mode[])}
              options={ALL_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
            />
          </Form.Item>
        </Form>
        <Space>
          <Button
            type="primary"
            onClick={run}
            loading={isRunning}
            disabled={layer == null || settings.modes.length === 0}
          >
            Run benchmark
          </Button>
          <Button onClick={copyResults} disabled={results.length === 0}>
            Copy results as JSON
          </Button>
          <JankIndicator />
          {status}
        </Space>
      </Card>
      {error != null && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <Card title="Summary (median over rounds)" style={{ marginBottom: 16 }}>
        <Table
          size="small"
          pagination={false}
          dataSource={summarize(results)}
          columns={summaryColumns}
        />
      </Card>
      <Card title="Individual runs">
        <Table
          size="small"
          pagination={false}
          rowKey={(r) => `${r.round}-${r.mode}`}
          dataSource={results}
          columns={runColumns}
        />
      </Card>
    </div>
  );
}
