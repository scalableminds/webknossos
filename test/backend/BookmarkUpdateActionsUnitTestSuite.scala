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
  UpdateBookmarkAnnotationAction,
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
    thumbnailSavedAtVersion = Some(1L),
    metadata = Seq(
      MetadataEntryProto("a", stringValue = Some("1")),
      MetadataEntryProto("b", numberValue = Some(2.0)),
      MetadataEntryProto("c", boolValue = Some(true))
    )
  )

  "UpdateBookmarkAnnotationAction" should {
    "clear fields that are null and keep fields that are absent" in {
      val named = bookmark.withName("name").withDescription("description")
      val clearName = Json.parse("""{"id": 1, "name": null}""").as[UpdateBookmarkAnnotationAction]
      assert(clearName.applyOn(named) == named.clearName)
      val setDescription = Json.parse("""{"id": 1, "description": "new"}""").as[UpdateBookmarkAnnotationAction]
      assert(setDescription.applyOn(named) == named.withDescription("new"))
    }
  }

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
    "only set the thumbnailSavedAtVersion" in {
      val action = UpdateBookmarkThumbnailAnnotationAction(
        id = 1,
        largeThumbnailDataBase64 = None,
        smallThumbnailDataBase64 = None,
        thumbnailSavedAtVersion = Some(5L)
      )
      assert(action.applyOn(bookmark) == bookmark.withThumbnailSavedAtVersion(5L))
      assert(action.copy(thumbnailSavedAtVersion = None).applyOn(bookmark) == bookmark.clearThumbnailSavedAtVersion)
    }

    "require the save version when carrying thumbnails and an older version when referencing them" in {
      val withThumbnails = UpdateBookmarkThumbnailAnnotationAction(
        id = 1,
        largeThumbnailDataBase64 = Some("AA=="),
        smallThumbnailDataBase64 = None,
        thumbnailSavedAtVersion = Some(9L)
      )
      assert(withThumbnails.thumbnailSavedAtVersionError(saveVersion = 9L).isEmpty)
      assert(withThumbnails.referencedThumbnailSavedAtVersion.isEmpty)
      assert(
        withThumbnails.copy(thumbnailSavedAtVersion = Some(5L)).thumbnailSavedAtVersionError(saveVersion = 9L).isDefined
      )
      assert(
        withThumbnails.copy(thumbnailSavedAtVersion = None).thumbnailSavedAtVersionError(saveVersion = 9L).isDefined
      )

      val referencing = withThumbnails.withoutThumbnails.copy(thumbnailSavedAtVersion = Some(5L))
      assert(referencing.thumbnailSavedAtVersionError(saveVersion = 9L).isEmpty)
      assert(referencing.referencedThumbnailSavedAtVersion.contains(5L))
      assert(
        referencing.copy(thumbnailSavedAtVersion = Some(9L)).thumbnailSavedAtVersionError(saveVersion = 9L).isDefined
      )
      assert(referencing.copy(thumbnailSavedAtVersion = None).thumbnailSavedAtVersionError(saveVersion = 9L).isEmpty)
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
      assert(action.thumbnailSavedAtVersionError(saveVersion = 9L).isEmpty)
      assert(action.copy(createdAtVersion = 8L).thumbnailSavedAtVersionError(saveVersion = 9L).isDefined)
      assert(action.toProto.createdAtVersion == 9L)
      assert(action.toProto.thumbnailSavedAtVersion.isEmpty)
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
        .parse("""{"id": 1, "thumbnailSavedAtVersion": 3, "thumbnailViewport": "TD"}""")
        .as[UpdateBookmarkThumbnailAnnotationAction]
      assert(thumbnailAction.applyOn(bookmark).thumbnailViewport.contains(ThumbnailViewportProto.TD))
    }
  }
}
