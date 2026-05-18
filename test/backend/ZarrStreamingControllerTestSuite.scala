package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, AnnotationLayerType}
import org.scalatest.wordspec.AsyncWordSpec
import play.api.libs.json.Json

class ZarrStreamingControllerTestSuite extends AsyncWordSpec {

  "excludedDatasetLayerNames" should {
    "exclude annotation layer names and their fallback layer names" in {
      val volumeAnnotationLayers = List(
        AnnotationLayer("tracing-1", AnnotationLayerType.Volume, "annotation-layer", Json.obj()),
        AnnotationLayer("tracing-2", AnnotationLayerType.Volume, "same-name-layer", Json.obj())
      )

      val excludedLayerNames = ZarrStreamingController.excludedDatasetLayerNames(
        volumeAnnotationLayers,
        List(Some("fallback-dataset-layer"), Some("same-name-layer"), None)
      )

      assert(excludedLayerNames == Set("annotation-layer", "same-name-layer", "fallback-dataset-layer"))
    }

    "not exclude unrelated dataset layers" in {
      val volumeAnnotationLayers = List(
        AnnotationLayer("tracing-1", AnnotationLayerType.Volume, "annotation-layer", Json.obj())
      )

      val excludedLayerNames = ZarrStreamingController.excludedDatasetLayerNames(
        volumeAnnotationLayers,
        List(Some("fallback-dataset-layer"))
      )

      assert(!excludedLayerNames.contains("unrelated-dataset-layer"))
    }
  }
}
