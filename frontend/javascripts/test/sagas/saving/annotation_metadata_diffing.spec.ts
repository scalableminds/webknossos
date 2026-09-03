import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { diffAnnotationMetadata } from "viewer/model/sagas/diffing/annotation_metadata_diffing";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import {
  updateAnnotationLayerName,
  updateMetadataOfAnnotation,
} from "viewer/model/sagas/volume/update_actions";
import { Store } from "viewer/singletons";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("diffAnnotationMetadata (pure diff function)", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
  });

  afterEach<WebknossosTestContext>((context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("yields updateAnnotationLayerName when a layer's name changed", () => {
    const annotation = Store.getState().annotation;
    const [layer] = annotation.annotationLayers;
    const nextAnnotation = {
      ...annotation,
      annotationLayers: annotation.annotationLayers.map((l) =>
        l.tracingId === layer.tracingId ? { ...l, name: "Renamed" } : l,
      ),
    };

    const items = Array.from(diffAnnotationMetadata(annotation, nextAnnotation, true));

    expect(items).toEqual([updateAnnotationLayerName(layer.tracingId, "Renamed")]);
  });

  it("yields updateMetadataOfAnnotation when the description changed and editing is allowed", () => {
    const annotation = Store.getState().annotation;
    const nextAnnotation = { ...annotation, description: "New description" };

    const items = Array.from(diffAnnotationMetadata(annotation, nextAnnotation, true));

    expect(items).toEqual([updateMetadataOfAnnotation("New description")]);
  });

  it("suppresses the description diff when mayEditAnnotationProperties is false", () => {
    const annotation = Store.getState().annotation;
    const nextAnnotation = { ...annotation, description: "New description" };

    const items = Array.from(diffAnnotationMetadata(annotation, nextAnnotation, false));

    expect(items).toEqual([]);
  });

  it("yields nothing when nothing changed", () => {
    const annotation = Store.getState().annotation;

    const items = Array.from(diffAnnotationMetadata(annotation, annotation, true));

    expect(items).toEqual([]);
  });

  it("ignores a tracingId missing from prevAnnotation (e.g. a freshly added layer)", () => {
    const annotation = Store.getState().annotation;
    const [layer] = annotation.annotationLayers;
    const prevAnnotation = {
      ...annotation,
      annotationLayers: annotation.annotationLayers.filter((l) => l.tracingId !== layer.tracingId),
    };

    const items = Array.from(diffAnnotationMetadata(prevAnnotation, annotation, true));

    expect(items).toEqual([]);
  });
});
