package backend

import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkProto.ThumbnailViewportProto
import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkStateProto.{
  MappingTypeProto,
  ViewModeProto
}
import com.scalableminds.webknossos.datastore.AnnotationBookmark.{AnnotationBookmarkProto, AnnotationBookmarkStateProto}
import com.scalableminds.webknossos.datastore.MetadataEntry.MetadataEntryProto
import com.scalableminds.webknossos.datastore.geometry.{Vec3DoubleProto, Vec3IntProto}
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.webknossos.tracingstore.annotation.{
  AddBookmarkAnnotationAction,
  AnnotationBookmarkState,
  BookmarkViewMode,
  UpdateBookmarkStateAnnotationAction,
  UpdateBookmarkThumbnailAnnotationAction,
  UpdateMetadataOfBookmarkAnnotationAction
}
import com.scalableminds.webknossos.tracingstore.tracings.MetadataEntry
import org.scalatest.wordspec.AnyWordSpec
import play.api.libs.json.Json

class BookmarkUpdateActionsUnitTestSuite extends AnyWordSpec {

  private val bookmark = AnnotationBookmarkProto(
    id = 1,
    created = 0L,
    state = AnnotationBookmarkStateProto(
      position = Vec3IntProto(0, 0, 0),
      mode = ViewModeProto.orthogonal,
      zoomStep = 1.0,
      rotation = Vec3DoubleProto(0, 0, 0),
      clippingDistance = 50.0,
      clipSkeletonToCurrentSection = false
    ),
    createdAtVersion = 1L,
    thumbnailVersion = Some(1L),
    metadata = Seq(
      MetadataEntryProto("a", stringValue = Some("1")),
      MetadataEntryProto("b", numberValue = Some(2.0)),
      MetadataEntryProto("c", boolValue = Some(true))
    )
  )

  "UpdateMetadataOfBookmarkAnnotationAction" should {
    "update existing entries in place, append new ones and remove the requested keys" in {
      val action = UpdateMetadataOfBookmarkAnnotationAction(
        id = 1,
        upsertEntriesByKey =
          Seq(MetadataEntry("b", numberValue = Some(3.0)), MetadataEntry("d", stringValue = Some("4"))),
        removeEntriesByKey = Seq("a")
      )
      assert(
        action.applyOn(bookmark).metadata == Seq(
          MetadataEntryProto("b", numberValue = Some(3.0)),
          MetadataEntryProto("c", boolValue = Some(true)),
          MetadataEntryProto("d", stringValue = Some("4"))
        )
      )
    }
  }

  "UpdateBookmarkStateAnnotationAction" should {
    "replace the state, keeping everything else" in {
      val newState = AnnotationBookmarkState(
        position = Vec3Int(1, 2, 3),
        mode = BookmarkViewMode.flight,
        zoomStep = 2.0,
        rotation = Vec3Double(0, 0, 90),
        activeNodeId = None,
        additionalCoordinates = None,
        nativelyRenderedLayerName = None,
        clippingDistance = 10.0,
        clipSkeletonToCurrentSection = true,
        tdCamera = None,
        showSkeletons = None
      )
      val updated = UpdateBookmarkStateAnnotationAction(id = 1, state = newState).applyOn(bookmark)
      assert(updated == bookmark.withState(newState.toProto))
    }
  }

  "UpdateBookmarkThumbnailAnnotationAction" should {
    "only set the thumbnail version" in {
      val action = UpdateBookmarkThumbnailAnnotationAction(
        id = 1,
        largeThumbnailDataBase64 = None,
        smallThumbnailDataBase64 = None,
        thumbnailVersion = Some(5L)
      )
      assert(action.applyOn(bookmark) == bookmark.withThumbnailVersion(5L))
      assert(action.copy(thumbnailVersion = None).applyOn(bookmark) == bookmark.clearThumbnailVersion)
    }

    "require the save version when carrying thumbnails and an older version when referencing them" in {
      val withThumbnails = UpdateBookmarkThumbnailAnnotationAction(
        id = 1,
        largeThumbnailDataBase64 = Some("AA=="),
        smallThumbnailDataBase64 = None,
        thumbnailVersion = Some(9L)
      )
      assert(withThumbnails.thumbnailVersionError(saveVersion = 9L).isEmpty)
      assert(withThumbnails.referencedThumbnailVersion.isEmpty)
      assert(withThumbnails.copy(thumbnailVersion = Some(5L)).thumbnailVersionError(saveVersion = 9L).isDefined)
      assert(withThumbnails.copy(thumbnailVersion = None).thumbnailVersionError(saveVersion = 9L).isDefined)

      val referencing = withThumbnails.withoutThumbnails.copy(thumbnailVersion = Some(5L))
      assert(referencing.thumbnailVersionError(saveVersion = 9L).isEmpty)
      assert(referencing.referencedThumbnailVersion.contains(5L))
      assert(referencing.copy(thumbnailVersion = Some(9L)).thumbnailVersionError(saveVersion = 9L).isDefined)
      assert(referencing.copy(thumbnailVersion = None).thumbnailVersionError(saveVersion = 9L).isEmpty)
    }
  }

  "AddBookmarkAnnotationAction" should {
    "require createdAtVersion to be the save version" in {
      val action = AddBookmarkAnnotationAction(
        id = 1,
        created = 0L,
        name = None,
        description = None,
        state = AnnotationBookmarkState(
          position = Vec3Int(0, 0, 0),
          mode = BookmarkViewMode.orthogonal,
          zoomStep = 1.0,
          rotation = Vec3Double(0, 0, 0),
          activeNodeId = None,
          additionalCoordinates = None,
          nativelyRenderedLayerName = None,
          clippingDistance = 50.0,
          clipSkeletonToCurrentSection = false,
          tdCamera = None,
          showSkeletons = None
        ),
        largeThumbnailDataBase64 = None,
        smallThumbnailDataBase64 = None,
        createdAtVersion = 9L
      )
      assert(action.thumbnailVersionError(saveVersion = 9L).isEmpty)
      assert(action.copy(createdAtVersion = 8L).thumbnailVersionError(saveVersion = 9L).isDefined)
      assert(action.toProto.createdAtVersion == 9L)
      assert(action.toProto.thumbnailVersion.isEmpty)
    }
  }

  "The JSON format of bookmark enums" should {
    "read the proto value names" in {
      val state = Json
        .parse("""{
          "position": [0, 0, 0], "mode": "flight", "zoomStep": 1, "rotation": [0, 0, 0],
          "clippingDistance": 50, "clipSkeletonToCurrentSection": false,
          "layers": [{
            "layerName": "segmentation",
            "mapping": {"mappingName": "agglomerate_view_5", "mappingType": "AGGLOMERATE"},
            "meshes": [{"segmentId": 5, "seedPosition": [0, 0, 0], "isPrecomputed": false, "mappingType": "JSON"}]
          }]
        }""")
        .as[AnnotationBookmarkState]
        .toProto
      assert(state.mode == ViewModeProto.flight)
      assert(state.layers.head.mapping.map(_.mappingType).contains(MappingTypeProto.AGGLOMERATE))
      assert(state.layers.head.meshes.head.mappingType.contains(MappingTypeProto.JSON))

      val thumbnailAction = Json
        .parse("""{"id": 1, "thumbnailVersion": 3, "thumbnailViewport": "TD"}""")
        .as[UpdateBookmarkThumbnailAnnotationAction]
      assert(thumbnailAction.applyOn(bookmark).thumbnailViewport.contains(ThumbnailViewportProto.TD))
    }
  }
}
