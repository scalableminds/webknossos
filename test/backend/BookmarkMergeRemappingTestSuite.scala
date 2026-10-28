package backend

import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkStateProto.{
  MappingTypeProto,
  ViewModeProto
}
import com.scalableminds.webknossos.datastore.AnnotationBookmark.{
  AnnotationBookmarkProto,
  AnnotationBookmarkStateProto,
  BookmarkLayerStateProto,
  BookmarkMappingProto,
  BookmarkMeshProto
}
import com.scalableminds.webknossos.datastore.geometry.{Vec3DoubleProto, Vec3IntProto}
import com.scalableminds.webknossos.tracingstore.annotation.BookmarkMergeRemapping
import org.scalatest.wordspec.AnyWordSpec

class BookmarkMergeRemappingTestSuite extends AnyWordSpec {

  private val origin = Vec3IntProto(0, 0, 0)

  private def adHocMesh(segmentId: Long, mappingName: Option[String] = None) =
    BookmarkMeshProto(segmentId, origin, isPrecomputed = false, mappingName = mappingName)

  private def bookmark(
      activeNodeId: Option[Int] = None,
      nativelyRenderedLayerName: Option[String] = None,
      layers: Seq[BookmarkLayerStateProto] = Seq.empty
  ) =
    AnnotationBookmarkProto(
      id = 3,
      created = 0L,
      createdAtVersion = 4L,
      thumbnailVersion = 4L,
      name = Some("name"),
      state = AnnotationBookmarkStateProto(
        position = origin,
        mode = ViewModeProto.orthogonal,
        zoomStep = 1.0,
        rotation = Vec3DoubleProto(0, 0, 0),
        activeNodeId = activeNodeId,
        nativelyRenderedLayerName = nativelyRenderedLayerName,
        clippingDistance = 50.0,
        clipSkeletonToCurrentSection = false,
        layers = layers
      )
    )

  private val remapping = BookmarkMergeRemapping(
    existingNodeIds = Set(1, 2),
    nodeIdMap = _ + 100,
    tracingIdMap = Map("skeletonA" -> "mergedSkeleton", "volumeA" -> "mergedVolume", "volumeB" -> "mergedVolume"),
    segmentIdMapsByTracingId = Map("volumeA" -> Map(5L -> 50L), "volumeB" -> Map(5L -> 60L)),
    editableMappingIdMap = Map.empty
  )

  "BookmarkMergeRemapping" should {
    "set the new id and keep the name" in {
      val merged = remapping(bookmark(), newId = 7)
      assert(merged.id == 7)
      assert(merged.name.contains("name"))
    }

    "remap the active node and drop it if the node no longer exists" in {
      assert(remapping(bookmark(activeNodeId = Some(2)), 1).state.activeNodeId.contains(102))
      assert(remapping(bookmark(activeNodeId = Some(3)), 1).state.activeNodeId.isEmpty)
    }

    "rename annotation layers and keep dataset layers" in {
      val merged = remapping(
        bookmark(
          nativelyRenderedLayerName = Some("volumeA"),
          layers = Seq(BookmarkLayerStateProto("volumeA"), BookmarkLayerStateProto("color"))
        ),
        1
      )
      assert(merged.state.nativelyRenderedLayerName.contains("mergedVolume"))
      assert(merged.state.layers.map(_.layerName) == Seq("mergedVolume", "color"))
    }

    "remap the segment ids of meshes in volume layers only" in {
      val merged = remapping(
        bookmark(layers =
          Seq(
            BookmarkLayerStateProto("volumeA", meshes = Seq(adHocMesh(5), adHocMesh(6))),
            BookmarkLayerStateProto("color", meshes = Seq(adHocMesh(5)))
          )
        ),
        1
      )
      assert(merged.state.layers.map(_.meshes.map(_.segmentId)) == Seq(Seq(50L, 6L), Seq(5L)))
    }

    "combine layers that are merged into the same layer, keeping the settings of the first" in {
      val merged = remapping(
        bookmark(layers =
          Seq(
            BookmarkLayerStateProto("volumeA", isDisabled = Some(true), meshes = Seq(adHocMesh(5))),
            BookmarkLayerStateProto("volumeB", isDisabled = Some(false), meshes = Seq(adHocMesh(5)))
          )
        ),
        1
      )
      assert(merged.state.layers.length == 1)
      assert(merged.state.layers.head.isDisabled.contains(true))
      assert(merged.state.layers.head.meshes.map(_.segmentId) == Seq(50L, 60L))
    }

    "remap editable mappings, drop those that no longer exist and keep regular mappings" in {
      val layers = Seq(
        BookmarkLayerStateProto(
          "volumeA",
          mapping = Some(BookmarkMappingProto("volumeA", MappingTypeProto.AGGLOMERATE)),
          meshes = Seq(adHocMesh(5, Some("volumeA")), adHocMesh(6))
        ),
        BookmarkLayerStateProto(
          "color",
          mapping = Some(BookmarkMappingProto("agglomerate_view_5", MappingTypeProto.AGGLOMERATE))
        )
      )
      val withEditableMapping =
        remapping.copy(editableMappingIdMap = Map("volumeA" -> "mergedVolume"))(bookmark(layers = layers), 1)
      assert(
        withEditableMapping.state.layers
          .flatMap(_.mapping.map(_.mappingName)) == Seq("mergedVolume", "agglomerate_view_5")
      )
      assert(withEditableMapping.state.layers.head.meshes.map(_.mappingName) == Seq(Some("mergedVolume"), None))

      val withoutEditableMapping = remapping(bookmark(layers = layers), 1)
      assert(withoutEditableMapping.state.layers.flatMap(_.mapping.map(_.mappingName)) == Seq("agglomerate_view_5"))
      assert(withoutEditableMapping.state.layers.head.meshes.map(_.segmentId) == Seq(6L))
    }
  }
}
