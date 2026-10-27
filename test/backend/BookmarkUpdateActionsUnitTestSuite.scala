package backend

import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkStateProto.ViewModeProto
import com.scalableminds.webknossos.datastore.AnnotationBookmark.{AnnotationBookmarkProto, AnnotationBookmarkStateProto}
import com.scalableminds.webknossos.datastore.MetadataEntry.MetadataEntryProto
import com.scalableminds.webknossos.datastore.geometry.{Vec3DoubleProto, Vec3IntProto}
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.webknossos.tracingstore.annotation.{
  AnnotationBookmarkState,
  UpdateBookmarkStateAnnotationAction,
  UpdateBookmarkThumbnailAnnotationAction,
  UpdateMetadataOfBookmarkAnnotationAction
}
import com.scalableminds.webknossos.tracingstore.tracings.MetadataEntry
import org.scalatest.wordspec.AnyWordSpec

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
    thumbnailVersion = 1L,
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
    "replace the state and set the thumbnail version, keeping everything else" in {
      val newState = AnnotationBookmarkState(
        position = Vec3Int(1, 2, 3),
        mode = ViewModeProto.flight,
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
      val action = UpdateBookmarkStateAnnotationAction(
        id = 1,
        state = newState,
        largeThumbnailDataBase64 = None,
        smallThumbnailDataBase64 = None,
        thumbnailVersion = Some(5L)
      )
      val updated = action.applyOn(fallbackThumbnailVersion = 9L)(bookmark)
      assert(updated.state == newState.toProto)
      assert(updated.thumbnailVersion == 5L)
      assert(updated.copy(state = bookmark.state, thumbnailVersion = bookmark.thumbnailVersion) == bookmark)
      assert(action.copy(thumbnailVersion = None).applyOn(9L)(bookmark).thumbnailVersion == 9L)
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
      assert(action.applyOn(fallbackThumbnailVersion = 9L)(bookmark) == bookmark.withThumbnailVersion(5L))
    }
  }
}
