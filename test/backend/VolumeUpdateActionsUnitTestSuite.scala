package backend

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.tracings.UpdateAction
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  CreateSegmentVolumeAction,
  DeleteSegmentVolumeAction,
  UpdateActionSegmentGroup,
  UpdateSegmentGroupsVolumeAction,
  UpdateSegmentVolumeAction
}
import org.scalatestplus.play._

class VolumeUpdateActionsUnitTestSuite extends PlaySpec with ProtoGeometryImplicits {

  private def applyUpdateAction(action: UpdateAction.VolumeUpdateAction): VolumeTracing =
    action.applyOn(Dummies.volumeTracing)

  "CreateSegmentVolumeAction" should {
    "add the specified segment" in {
      val createSegmentAction = CreateSegmentVolumeAction(
        id = 1000,
        anchorPosition = Some(Vec3Int(5, 5, 5)),
        color = None,
        name = Some("aSegment"),
        groupId = Some(1),
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
        anchorPosition = Some(Vec3Int(8, 8, 8)),
        name = Some("aRenamedSegment"),
        color = None,
        creationTime = Some(Dummies.timestampLong),
        groupId = None
      )
      val result = applyUpdateAction(updateSegmentAction)

      assert(result.segments.length == Dummies.volumeTracing.segments.length)
      val segment = result.segments.find(_.segmentId == updateSegmentAction.id).get

      assert(segment.segmentId == updateSegmentAction.id)
      assert(segment.anchorPosition.contains(vec3IntToProto(Vec3Int(8, 8, 8))))
      assert(segment.name.contains("aRenamedSegment"))
      assert(segment.creationTime.contains(Dummies.timestampLong))
    }
  }

  "UpdateSegmentGroupsVolumeAction" should {
    "update a top level segment group" in {
      val updatedName = "Segment Group 2 updated"
      val updateSegmentGroupsVolumeAction = new UpdateSegmentGroupsVolumeAction(
        List(UpdateActionSegmentGroup(updatedName, 2, isExpanded = Some(true), List()))
      )
      val result = applyUpdateAction(updateSegmentGroupsVolumeAction)
      assert(result.segments == Dummies.volumeTracing.segments)
      val segmentGroup = result.segmentGroups.find(_.groupId == 2).get
      assert(segmentGroup.name == updatedName)
    }
    "update a nested segment group" in {
      val updatedNameTop = "Segment Group 1 updated"
      val updatedNameNested = "Segment Group 3 updated"
      val updateSegmentGroupsVolumeAction = new UpdateSegmentGroupsVolumeAction(
        List(UpdateActionSegmentGroup(updatedNameTop, 1, isExpanded = Some(true), List(UpdateActionSegmentGroup(updatedNameNested, 3, isExpanded = Some(false), List()))))
      )
      val result = applyUpdateAction(updateSegmentGroupsVolumeAction)
      assert(result.segments == Dummies.volumeTracing.segments)
      val segmentGroupTop = result.segmentGroups.find(_.groupId == 1).get
      assert(segmentGroupTop.name == updatedNameTop)
      val segmentGroupNested = segmentGroupTop.children.find(_.groupId == 3).get
      assert(segmentGroupNested.name == updatedNameNested)
    }
  }

}
