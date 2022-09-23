package backend

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.tracings.volume.{ApplyableVolumeAction, CreateSegmentVolumeAction, DeleteSegmentVolumeAction, UpdateSegmentVolumeAction}
import org.scalatestplus.play._

class VolumeUpdateActionsUnitTestSuite extends PlaySpec with ProtoGeometryImplicits {

  private def applyUpdateAction(action: ApplyableVolumeAction): VolumeTracing =
    action.applyOn(Dummies.volumeTracing)

  "CreateSegmentVolumeAction" should {
    "add the specified segment" in {
      val createSegmentAction = CreateSegmentVolumeAction(
        id = 1000,
        anchorPosition = Some(Vec3Int(5,5,5)),
        color = None,
        name = Some("aSegment"),
        creationTime = Some(Dummies.timestampLong)
      )
      val result = applyUpdateAction(createSegmentAction)

      assert(result.segments.length == Dummies.volumeTracing.segments.length + 1)
      val segment = result.segments.find(_.segmentId == createSegmentAction.id).get
      assert(segment.segmentId == createSegmentAction.id)
      assert(segment.creationTime.contains(Dummies.timestampLong))
    }
  }

  "DeleteSegmentVolumeAction" should {
    "delete the specified segment" in {
      val deleteSegmentAction = DeleteSegmentVolumeAction(id = 5)
      val result = applyUpdateAction(deleteSegmentAction)

      assert(result.segments.length == Dummies.volumeTracing.segments.length - 1)
      result.segments.find(_.segmentId == deleteSegmentAction.id) match {
        case Some(_) => throw new Exception
        case None    =>
      }
    }
  }

  "UpdateSegmentVolumeAction" should {
    "update the specified segment" in {
      val updateSegmentAction = UpdateSegmentVolumeAction(
        id = 5,
        anchorPosition = Some(Vec3Int(8,8,8)),
        name = Some("aRenamedSegment"),
        color = None,
        creationTime = Some(Dummies.timestampLong)
      )
      val result = applyUpdateAction(updateSegmentAction)

      assert(result.segments.length == Dummies.volumeTracing.segments.length)
      val segment = result.segments.find(_.segmentId == updateSegmentAction.id).get

      assert(segment.segmentId == updateSegmentAction.id)
      assert(segment.anchorPosition.contains(vec3IntToProto(Vec3Int(8,8,8))))
      assert(segment.name.contains("aRenamedSegment"))
      assert(segment.creationTime.contains(Dummies.timestampLong))
    }
  }

}
