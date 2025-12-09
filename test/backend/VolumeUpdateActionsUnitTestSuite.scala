package backend

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.image.Color
import com.scalableminds.webknossos.datastore.VolumeTracing.{SegmentGroup, VolumeTracing}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.tracings.MetadataEntry
import com.scalableminds.webknossos.tracingstore.tracings.volume.{ApplyableVolumeUpdateAction, CreateSegmentVolumeAction, DeleteSegmentGroupVolumeAction, DeleteSegmentVolumeAction, LEGACY_UpdateSegmentGroupsVolumeAction, LEGACY_UpdateSegmentVolumeAction, UpdateActionSegmentGroup, UpdateMetadataOfSegmentVolumeAction, UpdateSegmentPartialVolumeAction, UpsertSegmentGroupVolumeAction}
import org.scalatestplus.play._

class VolumeUpdateActionsUnitTestSuite extends PlaySpec with ProtoGeometryImplicits {

  private def applyUpdateAction(action: ApplyableVolumeUpdateAction): VolumeTracing =
    action.applyOn(Dummies.volumeTracing)

  "CreateSegmentVolumeAction" should {
    "add the specified segment" in {
      val createSegmentAction = CreateSegmentVolumeAction(
        id = 1000,
        anchorPosition = Some(Vec3Int(5, 5, 5)),
        color = None,
        name = Some("aSegment"),
        groupId = Some(1),
        creationTime = Some(Dummies.timestampLong),
        actionTracingId = Dummies.tracingId
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
      val deleteSegmentAction = DeleteSegmentVolumeAction(id = 5, actionTracingId = Dummies.tracingId)
      val result = applyUpdateAction(deleteSegmentAction)

      assert(result.segments.length == Dummies.volumeTracing.segments.length - 1)
      result.segments.find(_.segmentId == deleteSegmentAction.id) match {
        case Some(_) => throw new Exception
        case None    =>
      }
    }
  }

  "LEGACY_UpdateSegmentVolumeAction" should {
    "update the specified segment" in {
      val updateSegmentAction = LEGACY_UpdateSegmentVolumeAction(
        id = 5,
        anchorPosition = Some(Vec3Int(8, 8, 8)),
        name = Some("aRenamedSegment"),
        color = None,
        creationTime = Some(Dummies.timestampLong),
        groupId = None,
        actionTracingId = Dummies.tracingId
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

  "UpdateSegmentPartialVolumeAction" should {
    "update the specified segment partially" in {
      val segmentId = 5
      val initialSegment = Dummies.volumeTracing.segments.find(_.segmentId == segmentId).get
      val updateSegmentPartialAction = UpdateSegmentPartialVolumeAction(
        id = segmentId,
        anchorPosition = Some(Some(Vec3Int(8, 8, 8))),
        name = Some(Some("aRenamedSegment")),
        color = None,
        groupId = None,
        creationTime = None,
        actionTracingId = Dummies.tracingId,
      )
      val result = applyUpdateAction(updateSegmentPartialAction)

      assert(result.segments.length == Dummies.volumeTracing.segments.length)
      val segment = result.segments.find(_.segmentId == updateSegmentPartialAction.id).get

      assert(segment.segmentId == updateSegmentPartialAction.id)
      assert(segment.anchorPosition.contains(vec3IntToProto(Vec3Int(8, 8, 8))))
      assert(segment.name.contains("aRenamedSegment"))
      assert(segment.color == initialSegment.color)
      assert(segment.groupId == initialSegment.groupId)
      assert(segment.creationTime == initialSegment.creationTime)
    }

    "update the specified segment fully" in {
      val updateSegmentPartialAction = UpdateSegmentPartialVolumeAction(
        id = 5,
        anchorPosition = Some(Some(Vec3Int(8, 8, 8))),
        name = Some(Some("aRenamedSegment")),
        color = Some(Some(Color(1.0, 1.0, 0.0, 1.0))),
        groupId = Some(Some(1)),
        creationTime = Some(Some(Dummies.timestampLong)),
        actionTracingId = Dummies.tracingId,
      )
      val result = applyUpdateAction(updateSegmentPartialAction)

      assert(result.segments.length == Dummies.volumeTracing.segments.length)
      val segment = result.segments.find(_.segmentId == updateSegmentPartialAction.id).get

      assert(segment.segmentId == updateSegmentPartialAction.id)
      assert(segment.anchorPosition.contains(vec3IntToProto(Vec3Int(8, 8, 8))))
      assert(segment.name.contains("aRenamedSegment"))
      assert(updateSegmentPartialAction.color.contains(segment.color.map(colorFromProto)))
      assert(updateSegmentPartialAction.groupId.contains(segment.groupId))
      assert(updateSegmentPartialAction.creationTime.contains(segment.creationTime))
    }
  }

  "UpdateMetadataOfSegmentVolumeAction" should {
    "update a segments metadata" in {

      // insert
      val updateMetadataAction =
        UpdateMetadataOfSegmentVolumeAction(
          id = 5,
          upsertEntriesByKey = Seq(
            MetadataEntry(key = "testString", stringValue = Some("string")),
            MetadataEntry(key = "testNumber", numberValue = Some(6)),
            MetadataEntry(key = "testBoolean", boolValue = Some(false)),
          ),
          removeEntriesByKey = Seq(),
          actionTracingId = Dummies.tracingId,
        )

      val result = applyUpdateAction(updateMetadataAction)

      assert(result.segments.length == Dummies.volumeTracing.segments.length)
      val segment = result.segments.find(_.segmentId == updateMetadataAction.id).get
      val segmentMetadata = segment.metadata.map(MetadataEntry.fromProto)

      assert(segment.segmentId == updateMetadataAction.id)
      assert(segmentMetadata.length == updateMetadataAction.upsertEntriesByKey.length)
      assert(segmentMetadata.head == updateMetadataAction.upsertEntriesByKey.head)
      assert(segmentMetadata(1) == updateMetadataAction.upsertEntriesByKey(1))
      assert(segmentMetadata(2) == updateMetadataAction.upsertEntriesByKey(2))

      // delete
      val deleteMetadataAction =
        UpdateMetadataOfSegmentVolumeAction(
          id = 5,
          upsertEntriesByKey = Seq(),
          removeEntriesByKey = Seq("testString", "testNumber"),
          actionTracingId = Dummies.tracingId,
        )
      val result2 = deleteMetadataAction.applyOn(result)
      assert(result2.segments.length == Dummies.volumeTracing.segments.length)
      val segment2 = result2.segments.find(_.segmentId == updateMetadataAction.id).get
      val segmentMetadata2 = segment2.metadata.map(MetadataEntry.fromProto)
      assert(segment.segmentId == updateMetadataAction.id)
      assert(
        segmentMetadata2.length == updateMetadataAction.upsertEntriesByKey.length - deleteMetadataAction.removeEntriesByKey.length)
      assert(segmentMetadata2.head == updateMetadataAction.upsertEntriesByKey(2))

    }
  }

  "LEGACY_UpdateSegmentGroupsVolumeAction" should {
    "update a top level segment group" in {
      val updatedName = "Segment Group 2 updated"
      val updateSegmentGroupsVolumeAction = new LEGACY_UpdateSegmentGroupsVolumeAction(
        List(UpdateActionSegmentGroup(updatedName, 2, isExpanded = Some(true), List())),
        actionTracingId = Dummies.tracingId
      )
      val result = applyUpdateAction(updateSegmentGroupsVolumeAction)
      assert(result.segments == Dummies.volumeTracing.segments)
      val segmentGroup = result.segmentGroups.find(_.groupId == 2).get
      assert(segmentGroup.name == updatedName)
    }
    "update a nested segment group" in {
      val updatedNameTop = "Segment Group 1 updated"
      val updatedNameNested = "Segment Group 3 updated"
      val updateSegmentGroupsVolumeAction = new LEGACY_UpdateSegmentGroupsVolumeAction(
        List(
          UpdateActionSegmentGroup(
            updatedNameTop,
            1,
            isExpanded = Some(true),
            List(UpdateActionSegmentGroup(updatedNameNested, 3, isExpanded = Some(false), List())))),
        actionTracingId = Dummies.tracingId
      )
      val result = applyUpdateAction(updateSegmentGroupsVolumeAction)
      assert(result.segments == Dummies.volumeTracing.segments)
      val segmentGroupTop = result.segmentGroups.find(_.groupId == 1).get
      assert(segmentGroupTop.name == updatedNameTop)
      val segmentGroupNested = segmentGroupTop.children.find(_.groupId == 3).get
      assert(segmentGroupNested.name == updatedNameNested)
    }
  }

  "UpsertSegmentGroupVolumeAction" should {
    val groupId1 = 1
    val groupId2 = 2
    val groupId3 = 3
    val tracingWithSegmentGroups = Dummies.volumeTracing.withSegmentGroups(
      Seq(
        SegmentGroup(
          "Group 1",
          groupId1,
          Seq(SegmentGroup("Group 2", groupId2, Seq(SegmentGroup("Group 3", groupId3, Seq(), Some(true))), Some(true))),
          Some(true))))

    "should insert and update new segment groups" in {
      val groupId = 1
      val initialName = "Group 1"
      val renamedName = "Group 2"
      val upsertGroupAction = UpsertSegmentGroupVolumeAction(
        groupId = groupId,
        name = Some(initialName),
        newParentId = None,
        actionTracingId = Dummies.tracingId
      )
      val result = applyUpdateAction(upsertGroupAction)
      assert(result.segmentGroups.length == 1)
      assert(
        result.segmentGroups.head == SegmentGroup(initialName,
                                                  groupId = groupId,
                                                  children = Seq(),
                                                  isExpanded = Some(true)))

      val renameGroupAction = UpsertSegmentGroupVolumeAction(
        groupId = groupId,
        name = Some(renamedName),
        newParentId = None,
        actionTracingId = Dummies.tracingId
      )

      val result2 = renameGroupAction.applyOn(result)
      assert(result2.segmentGroups.length == 1)
      assert(
        result2.segmentGroups.head == SegmentGroup(renamedName,
                                                   groupId = groupId,
                                                   children = Seq(),
                                                   isExpanded = Some(true)))
    }

    "should reparent a segment group correctly to root" in {
      val newParent = -1

      val upsertGroup3Action = UpsertSegmentGroupVolumeAction(
        groupId = groupId3,
        name = None,
        newParentId = Some(newParent),
        actionTracingId = Dummies.tracingId
      )
      val result = upsertGroup3Action.applyOn(tracingWithSegmentGroups)
      assert(result.segmentGroups.length == 2)
      assert(result.segmentGroups.head.groupId == groupId1)
      assert(result.segmentGroups.head.children.length == 1)
      assert(result.segmentGroups.head.children.head.groupId == groupId2)
      assert(result.segmentGroups.head.children.head.children.isEmpty)
      assert(result.segmentGroups(1).groupId == groupId3)
      assert(result.segmentGroups(1).children.isEmpty)

      val upsertGroup2Action = UpsertSegmentGroupVolumeAction(
        groupId = groupId2,
        name = None,
        newParentId = Some(newParent),
        actionTracingId = Dummies.tracingId
      )
      val result2 = upsertGroup2Action.applyOn(tracingWithSegmentGroups)
      assert(result2.segmentGroups.length == 2)
      assert(result2.segmentGroups.head.groupId == 1)
      assert(result2.segmentGroups.head.children.length == 1)
      assert(result2.segmentGroups.head.children.head.groupId == groupId3)
      assert(result2.segmentGroups.head.children.head.children.isEmpty)
      assert(result2.segmentGroups(1).groupId == groupId2)
      assert(result2.segmentGroups(1).children.isEmpty)

    }

    "should reparent a segment group correctly" in {
      val newParent = 1

      val upsertGroup3Action = UpsertSegmentGroupVolumeAction(
        groupId = groupId3,
        name = None,
        newParentId = Some(newParent),
        actionTracingId = Dummies.tracingId
      )
      val result = upsertGroup3Action.applyOn(tracingWithSegmentGroups)
      assert(result.segmentGroups.length == 1)
      assert(result.segmentGroups.head.groupId == groupId1)
      assert(result.segmentGroups.head.children.length == 2)
      assert(result.segmentGroups.head.children.head.groupId == groupId2)
      assert(result.segmentGroups.head.children.head.children.isEmpty)
      assert(result.segmentGroups.head.children(1).groupId == groupId3)
      assert(result.segmentGroups.head.children(1).children.isEmpty)

      val newParent2 = 3
      val upsertGroup2Action = UpsertSegmentGroupVolumeAction(
        groupId = groupId2,
        name = None,
        newParentId = Some(newParent2),
        actionTracingId = Dummies.tracingId
      )
      val result2 = upsertGroup2Action.applyOn(tracingWithSegmentGroups)
      assert(result2.segmentGroups.length == 1)
      assert(result2.segmentGroups.head.groupId == groupId1)
      assert(result2.segmentGroups.head.children.length == 1)
      assert(result2.segmentGroups.head.children.head.groupId == groupId3)
      assert(result2.segmentGroups.head.children.head.children.length == 1)
      assert(result2.segmentGroups.head.children.head.children.head.groupId == groupId2)
      assert(result2.segmentGroups.head.children.head.children.head.children.isEmpty)
    }

    "should delete a segment group correctly" in {
      val deleteGroup1Action = DeleteSegmentGroupVolumeAction(
        groupId = groupId1,
        actionTracingId = Dummies.tracingId
      )
      val result = deleteGroup1Action.applyOn(tracingWithSegmentGroups)
      assert(result.segmentGroups.length == 1)
      assert(result.segmentGroups.head.groupId == groupId2)
      assert(result.segmentGroups.head.children.length == 1)
      assert(result.segmentGroups.head.children.head.groupId == groupId3)
      assert(result.segmentGroups.head.children.head.children.isEmpty)

      val deleteGroup2Action = DeleteSegmentGroupVolumeAction(
        groupId = groupId2,
        actionTracingId = Dummies.tracingId
      )
      val result2 = deleteGroup2Action.applyOn(tracingWithSegmentGroups)
      assert(result2.segmentGroups.length == 1)
      assert(result2.segmentGroups.head.groupId == groupId1)
      assert(result2.segmentGroups.head.children.length == 1)
      assert(result2.segmentGroups.head.children.head.groupId == groupId3)
      assert(result2.segmentGroups.head.children.head.children.isEmpty)

      val deleteGroup3Action = DeleteSegmentGroupVolumeAction(
        groupId = groupId3,
        actionTracingId = Dummies.tracingId
      )
      val result3 = deleteGroup3Action.applyOn(tracingWithSegmentGroups)
      assert(result3.segmentGroups.length == 1)
      assert(result3.segmentGroups.head.groupId == groupId1)
      assert(result3.segmentGroups.head.children.length == 1)
      assert(result3.segmentGroups.head.children.head.groupId == groupId2)
      assert(result3.segmentGroups.head.children.head.children.isEmpty)
    }
  }

}
