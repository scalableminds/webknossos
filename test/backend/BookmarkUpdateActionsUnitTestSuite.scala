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
    "replace the state, keeping everything else" in {
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
      assert(action.applyOn(fallbackThumbnailVersion = 9L)(bookmark) == bookmark.withThumbnailVersion(5L))
    }

    "point to the save version when carrying thumbnails and to an explicit older version otherwise" in {
      val withThumbnails = UpdateBookmarkThumbnailAnnotationAction(
        id = 1,
        largeThumbnailDataBase64 = Some("AA=="),
        smallThumbnailDataBase64 = Some("AA=="),
        thumbnailVersion = Some(5L)
      )
      assert(withThumbnails.resultingThumbnailVersion(saveVersion = 9L) == 9L)
      val withoutThumbnails = withThumbnails.copy(largeThumbnailDataBase64 = None, smallThumbnailDataBase64 = None)
      assert(withoutThumbnails.resultingThumbnailVersion(saveVersion = 9L) == 5L)
      assert(withoutThumbnails.copy(thumbnailVersion = None).resultingThumbnailVersion(saveVersion = 9L) == 9L)
    }
  }
}
