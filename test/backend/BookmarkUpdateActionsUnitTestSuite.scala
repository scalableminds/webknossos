package backend

import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkStateProto.ViewModeProto
import com.scalableminds.webknossos.datastore.AnnotationBookmark.{AnnotationBookmarkProto, AnnotationBookmarkStateProto}
import com.scalableminds.webknossos.datastore.MetadataEntry.MetadataEntryProto
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.tracingstore.annotation.UpdateMetadataOfBookmarkAnnotationAction
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
      clippingDistance = 50.0,
      clipSkeletonToCurrentSection = false
    ),
    createdAtVersion = 1L,
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
}
