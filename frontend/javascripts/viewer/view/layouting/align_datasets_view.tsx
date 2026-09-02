import { EyeOutlined } from "@ant-design/icons";
import { createExplorational, getDataset, updateDatasetPartial } from "admin/rest_api";
import { Button, Drawer, Select, Space, Spin, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import Deferred from "libs/async/deferred";
import Toast from "libs/toast";
import { zip } from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { APIDataset, CoordinateTransformation } from "types/api_types";
import { TracingTypeEnum } from "types/api_types";
import { Identity4x4, type Vector3 } from "viewer/constants";
import { getDatasetIdOrNameFromReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { flatToNestedMatrix } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import {
  checkLandmarksForThinPlateSpline,
  createAffineTransform,
  invertTransform,
  type Transform,
  transformPointUnscaled,
} from "viewer/model/helpers/transformation_helpers";

// This is the "coordinator" of the BigWarp-style dataset alignment feature. See
// BIGWARP_ALIGNMENT_PLAN.md for the full design (architecture decision in §3, this
// file's scope in §5). In short: this page owns and persists one skeleton-only
// "landmark annotation" per (dataset, fixed layer, moving layer) triple. It never
// shows dataset content itself - instead it embeds three iframes, each a normal
// WEBKNOSSOS annotation view of this same app:
//  - "A" (fixed layer) and "B" (moving layer): visible, chrome-less, non-persisted
//    sandbox annotations the user actually clicks landmarks in ("workers").
//  - a hidden iframe holding the one real, persisted landmark annotation ("store"),
//    into which newly placed landmarks get merged as they appear in the workers.

type Side = "A" | "B";
const OTHER_SIDE: Record<Side, Side> = { A: "B", B: "A" };
type IframeRole = Side | "store";
const ALL_ROLES: IframeRole[] = ["A", "B", "store"];

const LANDMARK_ANNOTATION_STORAGE_PREFIX = "bigwarp-landmark-annotation:";

function getLandmarkAnnotationStorageKey(
  datasetId: string,
  layerAName: string,
  layerBName: string,
): string {
  return `${LANDMARK_ANNOTATION_STORAGE_PREFIX}${datasetId}:${layerAName}:${layerBName}`;
}

function getGroupNames(layerAName: string, layerBName: string) {
  return {
    pairGroupName: `Layer pair: ${layerAName} × ${layerBName}`,
    sideAGroupName: `${layerAName} landmarks`,
    sideBGroupName: `${layerBName} landmarks`,
  };
}

type GroupIds = { pairGroupId: number; sideAGroupId: number; sideBGroupId: number };

type CorrespondenceRow = {
  key: number;
  posA: Vector3 | null | undefined;
  posB: Vector3 | null | undefined;
  colorA: Vector3 | null | undefined;
  colorB: Vector3 | null | undefined;
  // Distance between posA and transformBtoA(posB) - i.e. how far apart this specific
  // landmark pair still ends up after applying the *overall* least-squares transform.
  // A high value relative to the other rows usually means this particular pair was
  // clicked imprecisely (or mismatched), since all other pairs are "pulling" the fit
  // away from it. Null until an alignment has actually been computed, or if either
  // side of the pair doesn't exist (unmatched landmark).
  residual: number | null;
};

type CorrespondenceEntry = { position: Vector3; color: Vector3 };

// Pairs up landmarks positionally (the Nth tree/node on one side is assumed to
// correspond to the Nth on the other), same as the original spike. Superseded by a
// real id/name-based correspondence table once one exists - see
// BIGWARP_ALIGNMENT_PLAN.md §9.
function getCorrespondenceEntries(
  trees: Awaited<ReturnType<typeof parseNml>>["trees"],
): CorrespondenceEntry[] {
  const sortedTrees = Array.from(trees.values()).toSorted((a, b) => a.treeId - b.treeId);
  const entries: CorrespondenceEntry[] = [];
  for (const tree of sortedTrees) {
    const sortedNodes = Array.from(tree.nodes.values()).toSorted((a, b) => a.id - b.id);
    for (const node of sortedNodes) {
      entries.push({ position: node.untransformedPosition, color: tree.color });
    }
  }
  return entries;
}

function rgbColorString(color: Vector3): string {
  return `rgb(${color.map((c) => Math.round(c * 255)).join(",")})`;
}

function vectorLength(v: Vector3): number {
  return Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
}

function LayerPairPicker({
  dataset,
  onPick,
}: {
  dataset: APIDataset;
  onPick: (layerAName: string, layerBName: string) => void;
}) {
  const layerNames = dataset.dataSource.dataLayers.map((layer) => layer.name);
  const [layerAName, setLayerAName] = useState<string | null>(null);
  const [layerBName, setLayerBName] = useState<string | null>(null);

  return (
    <div style={{ padding: 24, maxWidth: 480, margin: "40px auto" }}>
      <Typography.Title level={4}>Align two layers of “{dataset.name}”</Typography.Title>
      <Typography.Paragraph>
        Pick the fixed (reference) layer, which stays put, and the moving layer, which will be
        warped onto it.
      </Typography.Paragraph>
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Select
          placeholder="Fixed layer (does not move)"
          style={{ width: "100%" }}
          value={layerAName ?? undefined}
          onChange={setLayerAName}
          options={layerNames
            .filter((name) => name !== layerBName)
            .map((name) => ({ value: name, label: name }))}
        />
        <Select
          placeholder="Moving layer (gets warped)"
          style={{ width: "100%" }}
          value={layerBName ?? undefined}
          onChange={setLayerBName}
          options={layerNames
            .filter((name) => name !== layerAName)
            .map((name) => ({ value: name, label: name }))}
        />
        <Button
          type="primary"
          disabled={layerAName == null || layerBName == null}
          onClick={() => layerAName != null && layerBName != null && onPick(layerAName, layerBName)}
        >
          Start aligning
        </Button>
      </Space>
    </div>
  );
}

function AlignDatasetsView() {
  const { datasetNameAndId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const layerAName = searchParams.get("layerA");
  const layerBName = searchParams.get("layerB");

  const { datasetId } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);

  const [dataset, setDataset] = useState<APIDataset | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [landmarkAnnotationId, setLandmarkAnnotationId] = useState<string | null>(null);
  const [groupIds, setGroupIds] = useState<GroupIds | null>(null);
  const [workersReady, setWorkersReady] = useState<Record<Side, boolean>>({
    A: false,
    B: false,
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [correspondencesA, setCorrespondencesA] = useState<CorrespondenceEntry[]>([]);
  const [correspondencesB, setCorrespondencesB] = useState<CorrespondenceEntry[]>([]);
  const [transformBtoA, setTransformBtoA] = useState<Transform | null>(null);
  const [otherLayerVisible, setOtherLayerVisible] = useState<Record<Side, boolean>>({
    A: false,
    B: false,
  });
  // Surfaces the sync loop's progress/health directly in the drawer instead of only
  // logging to the console - the sync loop only starts once both workers *and* the
  // store's tree-group bootstrap are ready (see the two effects below), and each tick
  // can fail independently, so this is the quickest way to see where things are stuck.
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [isForceSaving, setIsForceSaving] = useState(false);

  const iframeRefs = useRef<Record<IframeRole, HTMLIFrameElement | null>>({
    A: null,
    B: null,
    store: null,
  });
  const readyDeferredsRef = useRef<Record<IframeRole, Deferred<void, unknown>>>({
    A: new Deferred(),
    B: new Deferred(),
    store: new Deferred(),
  });
  const deferredsByMessageIdRef = useRef<Record<string, Deferred<unknown, unknown>>>({});
  const messageCounterRef = useRef(0);
  // Worker-local tree ids already merged into the persisted "store" annotation, per
  // side - used to detect newly placed landmarks without re-persisting old ones on
  // every poll tick. See BIGWARP_ALIGNMENT_PLAN.md §5.4.
  const knownLocalTreeIdsRef = useRef<Record<Side, Set<number>>>({ A: new Set(), B: new Set() });
  const bootstrappedRef = useRef(false);
  const creatingAnnotationRef = useRef(false);
  // Always-latest-callback refs so the stable `handleShortcut` (registered once with
  // the window message listener) can call the current onAlign/toggleShowOtherLayer/
  // syncOtherViewToFocused without needing to re-subscribe that listener every render.
  const onAlignRef = useRef<() => void>(() => {});
  const toggleShowOtherLayerRef = useRef<(side: Side) => void>(() => {});
  const syncOtherViewToFocusedRef = useRef<(side: Side) => void>(() => {});

  const sendMessage = useCallback((role: IframeRole, type: string, args: unknown[] = []) => {
    const win = iframeRefs.current[role]?.contentWindow;
    if (win == null) {
      return Promise.reject(new Error(`The "${role}" iframe is not mounted yet.`));
    }
    const deferred = new Deferred<unknown, unknown>();
    const messageId = `bigwarp-${++messageCounterRef.current}`;
    deferredsByMessageIdRef.current[messageId] = deferred;
    win.postMessage({ type, args, messageId }, "*");
    return deferred.promise();
  }, []);

  const handleShortcut = useCallback((side: Side, key: string) => {
    if (key === "t") {
      onAlignRef.current();
    } else if (key === "x") {
      toggleShowOtherLayerRef.current(side);
    } else if (key === "y") {
      syncOtherViewToFocusedRef.current(side);
    }
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (data == null || typeof data !== "object") {
        return;
      }

      if (data.type === "init") {
        for (const role of ALL_ROLES) {
          if (event.source === iframeRefs.current[role]?.contentWindow) {
            readyDeferredsRef.current[role].resolve();
            if (role !== "store") {
              setWorkersReady((prev) => ({ ...prev, [role]: true }));
            }
          }
        }
        return;
      }

      if (data.type === "bigwarpShortcut") {
        if (event.source === iframeRefs.current.A?.contentWindow) {
          handleShortcut("A", data.key);
        } else if (event.source === iframeRefs.current.B?.contentWindow) {
          handleShortcut("B", data.key);
        }
        return;
      }

      // Sent by the "Alignment Tools" button in worker A's own navbar - the
      // coordinator's top-level navbar is gone (router.tsx's RootLayout), so this is
      // now the only way to reach that toggle. See BIGWARP_ALIGNMENT_PLAN.md §0.13.
      if (data.type === "bigwarpToggleDrawer") {
        if (event.source === iframeRefs.current.A?.contentWindow) {
          setDrawerOpen((open) => !open);
        }
        return;
      }

      if (typeof data.messageId === "string" && data.messageId.startsWith("bigwarp-")) {
        const deferred = deferredsByMessageIdRef.current[data.messageId];
        if (deferred == null) {
          return;
        }
        delete deferredsByMessageIdRef.current[data.messageId];
        if (data.type === "err") {
          deferred.reject(new Error(data.message));
        } else {
          deferred.resolve(data.returnValue);
        }
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handleShortcut]);

  // Fetch the dataset once, to resolve its layers (for the picker) and to patch its
  // default transforms later ("Store as Default").
  useEffect(() => {
    if (datasetId == null) {
      setDatasetError(
        "This page needs to be opened with a dataset id in the URL, e.g. via the dataset actions menu.",
      );
      return;
    }
    let cancelled = false;
    getDataset(datasetId)
      .then((fetchedDataset) => {
        if (!cancelled) {
          setDataset(fetchedDataset);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDatasetError("Could not load this dataset.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  // Find-or-create the one landmark annotation for this (dataset, layerA, layerB)
  // triple. See BIGWARP_ALIGNMENT_PLAN.md §3 - v1 remembers the mapping in
  // localStorage only (not shared across browsers/devices, a known v1 limitation).
  useEffect(() => {
    if (dataset == null || layerAName == null || layerBName == null) {
      return;
    }
    const storageKey = getLandmarkAnnotationStorageKey(dataset.id, layerAName, layerBName);
    const existingId = window.localStorage.getItem(storageKey);
    if (existingId != null) {
      setLandmarkAnnotationId(existingId);
      return;
    }
    if (creatingAnnotationRef.current) {
      return;
    }
    creatingAnnotationRef.current = true;
    createExplorational(dataset.id, TracingTypeEnum.skeleton, false)
      .then((annotation) => {
        window.localStorage.setItem(storageKey, annotation.id);
        setLandmarkAnnotationId(annotation.id);
      })
      .catch(() => {
        Toast.error("Could not create the landmark annotation for this dataset/layer pair.");
      })
      .finally(() => {
        creatingAnnotationRef.current = false;
      });
  }, [dataset, layerAName, layerBName]);

  // Once the store iframe is ready: ensure the two per-side tree groups exist, then
  // push each side's previously-known landmarks into its freshly (re)loaded worker
  // sandbox. See BIGWARP_ALIGNMENT_PLAN.md §3/§5.4.
  useEffect(() => {
    if (landmarkAnnotationId == null || layerAName == null || layerBName == null) {
      return;
    }
    if (bootstrappedRef.current) {
      return;
    }
    bootstrappedRef.current = true;
    let cancelled = false;

    (async () => {
      const { pairGroupName, sideAGroupName, sideBGroupName } = getGroupNames(
        layerAName,
        layerBName,
      );
      await readyDeferredsRef.current.store.promise();
      const ids = (await sendMessage("store", "ensureLandmarkGroups", [
        pairGroupName,
        sideAGroupName,
        sideBGroupName,
      ])) as GroupIds;
      if (cancelled) {
        return;
      }
      setGroupIds(ids);

      for (const side of ["A", "B"] as Side[]) {
        const groupId = side === "A" ? ids.sideAGroupId : ids.sideBGroupId;
        const nmlString = (await sendMessage("store", "exportTreesInGroupAsNmlString", [
          groupId,
          false,
        ])) as string;
        await readyDeferredsRef.current[side].promise();
        if (cancelled) {
          return;
        }
        await sendMessage(side, "importNml", [nmlString]);
        // The worker sandbox is guaranteed empty at this point, so importing
        // preserves the original (coordinator-assigned) tree ids as-is.
        const { trees } = await parseNml(nmlString);
        knownLocalTreeIdsRef.current[side] = new Set(trees.keys());
      }
    })().catch((error) => {
      console.error(error);
      Toast.error("Failed to set up the landmark annotation sync.");
    });

    return () => {
      cancelled = true;
    };
  }, [landmarkAnnotationId, layerAName, layerBName, sendMessage]);

  const fetchWorkerTrees = useCallback(
    async (side: Side) => {
      const nmlString = (await sendMessage(side, "exportTreesAsNmlString", [false])) as string;
      return parseNml(nmlString);
    },
    [sendMessage],
  );

  // The core sync loop: (1) refresh the live correspondence table/transform inputs,
  // (2) merge newly-placed landmarks into the persisted store annotation. Reject-only
  // for degenerate configurations, additions-only for persistence - see
  // BIGWARP_ALIGNMENT_PLAN.md §5.4/§5.5 for what's explicitly deferred (deletions,
  // TPS).
  useEffect(() => {
    if (groupIds == null || !workersReady.A || !workersReady.B) {
      return;
    }
    let cancelled = false;
    const intervalId = window.setInterval(async () => {
      try {
        const [{ trees: treesA }, { trees: treesB }] = await Promise.all([
          fetchWorkerTrees("A"),
          fetchWorkerTrees("B"),
        ]);
        if (cancelled) {
          return;
        }
        setCorrespondencesA(getCorrespondenceEntries(treesA));
        setCorrespondencesB(getCorrespondenceEntries(treesB));
        setLastSyncedAt(Date.now());
        setLastSyncError(null);

        for (const [side, trees] of [
          ["A", treesA],
          ["B", treesB],
        ] as const) {
          const allLocalIds = Array.from(trees.keys());
          const newIds = allLocalIds.filter((id) => !knownLocalTreeIdsRef.current[side].has(id));
          if (newIds.length === 0) {
            continue;
          }
          const newNmlString = (await sendMessage(side, "exportTreesByIdsAsNmlString", [
            newIds,
            false,
          ])) as string;
          const groupId = side === "A" ? groupIds.sideAGroupId : groupIds.sideBGroupId;
          await sendMessage("store", "importNmlIntoGroup", [newNmlString, groupId]);
          for (const id of newIds) {
            knownLocalTreeIdsRef.current[side].add(id);
          }
        }
      } catch (error) {
        console.error("BigWarp sync tick failed:", error);
        setLastSyncError(error instanceof Error ? error.message : String(error));
      }
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [groupIds, workersReady, fetchWorkerTrees, sendMessage]);

  const onAlign = useCallback(async () => {
    if (
      correspondencesA.length < 4 ||
      correspondencesB.length < 4 ||
      correspondencesA.length !== correspondencesB.length
    ) {
      Toast.warning(
        "Need at least 4 matching landmark pairs (the same number on both sides) before aligning.",
      );
      return;
    }
    const positionsA = correspondencesA.map((entry) => entry.position);
    const positionsB = correspondencesB.map((entry) => entry.position);
    try {
      checkLandmarksForThinPlateSpline(positionsB, positionsA);
    } catch {
      Toast.warning(
        "The current landmarks all lie in (roughly) one plane, which isn't enough to estimate a 3D transform. Add a landmark outside the current plane.",
      );
      return;
    }
    const transform = createAffineTransform(positionsB, positionsA);
    setTransformBtoA(transform);
    if (layerAName != null && layerBName != null) {
      await sendMessage("A", "setAffineLayerTransforms", [layerBName, transform.affineMatrix]);
      await sendMessage("B", "setAffineLayerTransforms", [layerAName, transform.affineMatrixInv]);
    }
  }, [correspondencesA, correspondencesB, layerAName, layerBName, sendMessage]);

  const onReset = useCallback(async () => {
    if (layerAName == null || layerBName == null) {
      return;
    }
    await sendMessage("A", "setAffineLayerTransforms", [layerBName, Identity4x4]);
    await sendMessage("B", "setAffineLayerTransforms", [layerAName, Identity4x4]);
    setTransformBtoA(null);
  }, [layerAName, layerBName, sendMessage]);

  const toggleShowOtherLayer = useCallback(
    (side: Side) => {
      const otherLayerName = side === "A" ? layerBName : layerAName;
      if (otherLayerName == null) {
        return;
      }
      setOtherLayerVisible((prev) => {
        const nextVisible = !prev[side];
        sendMessage(side, "setLayerVisibility", [otherLayerName, nextVisible]);
        return { ...prev, [side]: nextVisible };
      });
    },
    [layerAName, layerBName, sendMessage],
  );

  const syncOtherViewToFocused = useCallback(
    async (side: Side) => {
      if (transformBtoA == null) {
        Toast.info('Align the layers first (press "t") before syncing positions between views.');
        return;
      }
      const pos = (await sendMessage(side, "getCameraPosition", [])) as Vector3;
      const posInOtherFrame =
        side === "A"
          ? transformPointUnscaled(invertTransform(transformBtoA))(pos)
          : transformPointUnscaled(transformBtoA)(pos);
      await sendMessage(OTHER_SIDE[side], "centerPositionAnimated", [posInOtherFrame]);
    },
    [transformBtoA, sendMessage],
  );

  onAlignRef.current = onAlign;
  toggleShowOtherLayerRef.current = toggleShowOtherLayer;
  syncOtherViewToFocusedRef.current = syncOtherViewToFocused;

  const onFocusCorrespondenceSide = useCallback(
    (side: Side, pos: Vector3) => {
      sendMessage(side, "centerPositionAnimated", [pos]);
    },
    [sendMessage],
  );

  // Forces the persisted "store" annotation to flush right away instead of waiting for
  // its normal debounced auto-save - useful since reloading the coordinator tears down
  // all three iframes close together, which may not leave the store's own
  // beforeunload-triggered save enough time to actually finish.
  const onForceSave = useCallback(async () => {
    setIsForceSaving(true);
    try {
      await sendMessage("store", "save", []);
      Toast.success("Saved the landmark annotation.");
    } catch (error) {
      console.error(error);
      Toast.error("Could not save the landmark annotation.");
    } finally {
      setIsForceSaving(false);
    }
  }, [sendMessage]);

  const onStoreAsDefault = useCallback(async () => {
    if (transformBtoA == null || dataset == null || layerBName == null) {
      return;
    }
    try {
      const freshDataset = await getDataset(dataset.id);
      const layerIndex = freshDataset.dataSource.dataLayers.findIndex(
        (layer) => layer.name === layerBName,
      );
      if (layerIndex === -1) {
        Toast.error(`Layer "${layerBName}" could not be found in the dataset anymore.`);
        return;
      }
      const existingTransforms =
        freshDataset.dataSource.dataLayers[layerIndex].coordinateTransformations ?? [];
      const newTransform: CoordinateTransformation = {
        type: "affine",
        matrix: flatToNestedMatrix(transformBtoA.affineMatrix),
      };
      const updatedLayers = freshDataset.dataSource.dataLayers.map((layer, index) =>
        index === layerIndex
          ? { ...layer, coordinateTransformations: [...existingTransforms, newTransform] }
          : layer,
      );
      await updateDatasetPartial(dataset.id, {
        dataSource: { ...freshDataset.dataSource, dataLayers: updatedLayers },
      });
      Toast.success(`Stored the current alignment as the default transform for "${layerBName}".`);
    } catch (error) {
      console.error(error);
      Toast.error("Could not store the alignment as the dataset's default transform.");
    }
  }, [transformBtoA, dataset, layerBName]);

  const workerASrc = useMemo(() => {
    if (dataset == null || layerAName == null) {
      return undefined;
    }
    // bigwarpPrimary marks A as the "left" worker whose own navbar hosts the
    // dashboard link (forwarded to the top-level page via target="_top") and the
    // "Alignment Tools" drawer toggle, now that the coordinator's own top-level
    // navbar is gone. See BIGWARP_ALIGNMENT_PLAN.md §0.13.
    return `/datasets/${dataset.name}-${dataset.id}/sandbox/skeleton?bigwarpWorker=${encodeURIComponent(layerAName)}&bigwarpPrimary=true`;
  }, [dataset, layerAName]);
  const workerBSrc = useMemo(() => {
    if (dataset == null || layerBName == null) {
      return undefined;
    }
    return `/datasets/${dataset.name}-${dataset.id}/sandbox/skeleton?bigwarpWorker=${encodeURIComponent(layerBName)}`;
  }, [dataset, layerBName]);
  const storeSrc = useMemo(() => {
    if (landmarkAnnotationId == null) {
      return undefined;
    }
    return `/annotations/${landmarkAnnotationId}`;
  }, [landmarkAnnotationId]);

  if (datasetError != null) {
    return <Typography.Text type="danger">{datasetError}</Typography.Text>;
  }
  if (dataset == null) {
    return <Spin style={{ margin: 40 }} />;
  }
  if (layerAName == null || layerBName == null) {
    return (
      <LayerPairPicker
        dataset={dataset}
        onPick={(a, b) => setSearchParams({ layerA: a, layerB: b })}
      />
    );
  }
  if (landmarkAnnotationId == null) {
    return <Spin style={{ margin: 40 }} description="Preparing the landmark annotation..." />;
  }

  const columns: ColumnsType<CorrespondenceRow> = [
    {
      title: "#",
      key: "index",
      width: 32,
      render: (_value, _row, index) => index + 1,
    },
    {
      title: layerAName,
      key: "posA",
      width: 180,
      align: "center",
      render: (_value, row) =>
        row.posA != null ? (
          <span>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: row.colorA != null ? rgbColorString(row.colorA) : undefined,
                marginRight: 4,
              }}
            />
            {row.posA.join(", ")}{" "}
            <EyeOutlined
              onClick={() => row.posA != null && onFocusCorrespondenceSide("A", row.posA)}
            />
          </span>
        ) : null,
    },
    {
      title: layerBName,
      key: "posB",
      width: 180,
      align: "center",
      render: (_value, row) =>
        row.posB != null ? (
          <span>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: row.colorB != null ? rgbColorString(row.colorB) : undefined,
                marginRight: 4,
              }}
            />
            {row.posB.join(", ")}{" "}
            <EyeOutlined
              onClick={() => row.posB != null && onFocusCorrespondenceSide("B", row.posB)}
            />
          </span>
        ) : (
          "–"
        ),
    },
    {
      title: "Error",
      key: "residual",
      width: 70,
      align: "center",
      render: (_value, row) => (row.residual != null ? row.residual.toFixed(1) : "–"),
    },
  ];
  const tableData: CorrespondenceRow[] = zip(correspondencesA, correspondencesB).map(
    ([entryA, entryB], index) => {
      const posA = entryA?.position;
      const posB = entryB?.position;
      let residual: number | null = null;
      if (transformBtoA != null && posA != null && posB != null) {
        const posBInA = transformPointUnscaled(transformBtoA)(posB);
        residual = vectorLength([posA[0] - posBInA[0], posA[1] - posBInA[1], posA[2] - posBInA[2]]);
      }
      return {
        key: index,
        posA,
        colorA: entryA?.color,
        posB,
        colorB: entryB?.color,
        residual,
      };
    },
  );

  return (
    <div className="adv-parent">
      <Drawer
        title="Align Layers"
        placement="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        mask={false}
        size={420}
      >
        <Space orientation="vertical" style={{ width: "100%" }} size="middle">
          <Typography.Text>
            Fixed: <b>{layerAName}</b> &nbsp;→&nbsp; Moving: <b>{layerBName}</b>
          </Typography.Text>
          <Space wrap>
            <Button onClick={onReset}>Reset</Button>
            <Button type="primary" onClick={onAlign}>
              Align (t)
            </Button>
            <Button onClick={onStoreAsDefault} disabled={transformBtoA == null}>
              Store as Default
            </Button>
            <Button onClick={onForceSave} loading={isForceSaving}>
              Force Save
            </Button>
          </Space>
          <Space wrap>
            <Button onClick={() => toggleShowOtherLayer("A")}>
              {otherLayerVisible.A ? "Hide" : "Show"} {layerBName} in {layerAName} view (x)
            </Button>
            <Button onClick={() => toggleShowOtherLayer("B")}>
              {otherLayerVisible.B ? "Hide" : "Show"} {layerAName} in {layerBName} view (x)
            </Button>
          </Space>
          <Typography.Text type="secondary">
            While a view has keyboard focus: <b>t</b> aligns, <b>x</b> toggles the other layer in
            that view, <b>y</b> syncs the other view to that view's position.
          </Typography.Text>
          <Typography.Text
            type={lastSyncError != null ? "danger" : "secondary"}
            style={{ fontSize: 12 }}
          >
            Sync: workers {workersReady.A ? "✅" : "⏳"} A / {workersReady.B ? "✅" : "⏳"} B ·
            groups {groupIds != null ? "✅" : "⏳"} ·{" "}
            {lastSyncError != null
              ? `error: ${lastSyncError}`
              : lastSyncedAt != null
                ? `last synced ${new Date(lastSyncedAt).toLocaleTimeString()}`
                : "not synced yet"}
          </Typography.Text>
          <Table<CorrespondenceRow>
            size="small"
            pagination={false}
            columns={columns}
            dataSource={tableData}
            style={{ width: "fit-content" }}
          />
        </Space>
      </Drawer>
      <div className="adv-worker">
        <iframe
          ref={(el) => {
            iframeRefs.current.A = el;
          }}
          title={`Fixed layer (${layerAName})`}
          style={{
            width: "100%",
            height: "100%",
            borderRight: "2px solid var(--ant-color-primary)",
          }}
          src={workerASrc}
        />
      </div>
      <div className="adv-worker">
        <iframe
          ref={(el) => {
            iframeRefs.current.B = el;
          }}
          title={`Moving layer (${layerBName})`}
          style={{
            width: "100%",
            height: "100%",
            borderLeft: "2px solid var(--ant-color-primary)",
          }}
          src={workerBSrc}
        />
      </div>
      <iframe
        ref={(el) => {
          iframeRefs.current.store = el;
        }}
        title="Landmark annotation store"
        style={{ display: "none" }}
        src={storeSrc}
      />
    </div>
  );
}

export default AlignDatasetsView;
