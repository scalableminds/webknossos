package backend

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.image.Color
import com.scalableminds.webknossos.datastore.MetadataEntry.MetadataEntryProto
import com.scalableminds.webknossos.datastore.VolumeTracing.{Segment, SegmentGroup, VolumeTracing}
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.tracings.MetadataEntry
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  ApplyableVolumeUpdateAction,
  CreateSegmentVolumeAction,
  DeleteSegmentGroupVolumeAction,
  DeleteSegmentVolumeAction,
  LegacyUpdateSegmentGroupsVolumeAction,
  LegacyUpdateSegmentVolumeAction,
  MergeSegmentsVolumeAction,
  UpdateActionSegmentGroup,
  UpdateSegmentMetadataVolumeAction,
  UpdateSegmentPartialVolumeAction,
  UpsertSegmentGroupVolumeAction
}
import org.scalatestplus.play._

class VolumeUpdateActionsUnitTestSuite extends PlaySpec with ProtoGeometryImplicits {

  private def applyUpdateAction(action: ApplyableVolumeUpdateAction): VolumeTracing =
    action.applyOn(Dummies.volumeTracing)

  private val groupId1 = 1
  private val groupId2 = 2
  private val groupId3 = 3
  private val groupId4 = 4
  private val groupId5 = 5
  private val groupId6 = 6
  private val groupId7 = 7
  // Group structure:
  // - root
  //  - Group 1
  //    - Group 2
  //      - Group 3
  //        - Group 4
  //  - Group 5
  //    - Group 6
  //    - Group 7
  private val tracingWithSegmentGroups = Dummies.volumeTracing.withSegmentGroups(
    Seq(
      SegmentGroup(
        "Group 1",
        groupId1,
        Seq(
          SegmentGroup(
            "Group 2",
            groupId2,
            Seq(
              SegmentGroup("Group 3", groupId3, Seq(SegmentGroup("Group 4", groupId4, Seq(), Some(true))), Some(true))),
            Some(true))),
        Some(true)
      ),
      SegmentGroup("Group 5",
                   groupId5,
                   Seq(SegmentGroup("Group 6", groupId6, Seq(), Some(true)),
                       SegmentGroup("Group 7", groupId7, Seq(), Some(true))),
                   Some(true))
    ))

  private val segmentWithMetadata1 = Segment(
    segmentId = 1,
    name = Some("Name 1"),
    metadata = Seq(
      MetadataEntryProto(key = "someKey1", stringValue = Some("someStringValue - segment 1")),
      MetadataEntryProto(key = "someKey2", stringListValue = Seq("list", "value", "segment 1")),
      MetadataEntryProto(key = "identicalKey", stringValue = Some("identicalValue"))
    ),
    anchorPosition = Some(Vec3IntProto(1, 1, 1)),
    groupId = Some(1)
  )

  private val segmentWithMetadata2 = Segment(
    segmentId = 2,
    name = Some("Name 2"),
    metadata = Seq(
      MetadataEntryProto(key = "someKey1", stringValue = Some("someStringValue - segment 2")),
      MetadataEntryProto(key = "someKey3", stringListValue = Seq("list", "value", "segment 2")),
      MetadataEntryProto(key = "identicalKey", stringValue = Some("identicalValue"))
    ),
    anchorPosition = Some(Vec3IntProto(2, 2, 2)),
    groupId = Some(2)
  )

  // Note: The tests for MergeSegmentsVolumeAction have parity with those in the frontend.
  // If the action changes, tests should be adapted both in frontend and here.
  "MergeSegmentsVolumeAction" should {
    "merge two segments (simple)" in {
      val action = MergeSegmentsVolumeAction(1, 2, Dummies.tracingId)
      val result = action.applyOn(Dummies.volumeTracing.withSegments(Seq(segmentWithMetadata1, segmentWithMetadata2)))

      assert(
        result.segments == Seq(Segment(
          segmentId = 1,
          name = Some("Name 1 and Name 2"),
          metadata = Seq(
            MetadataEntryProto(key = "someKey1-1", stringValue = Some("someStringValue - segment 1")),
            MetadataEntryProto(key = "someKey2", stringListValue = Seq("list", "value", "segment 1")),
            MetadataEntryProto(key = "identicalKey", stringValue = Some("identicalValue")),
            MetadataEntryProto(key = "someKey1-2", stringValue = Some("someStringValue - segment 2")),
            MetadataEntryProto(key = "someKey3", stringListValue = Seq("list", "value", "segment 2")),
          ),
          anchorPosition = Some(Vec3IntProto(1, 1, 1)),
          groupId = Some(1),
        )))
    }

    "merge two segments (segment 1 doesn't exist, though)" in {
      val action = MergeSegmentsVolumeAction(1, 2, Dummies.tracingId)
      val result = action.applyOn(Dummies.volumeTracing.withSegments(Seq(segmentWithMetadata2)))

      assert(
        result.segments == Seq(
          Segment(
            segmentId = 1,
            name = Some("Segment 1 and Name 2"), // Note that "Segment 1" as a fallback got used here.
            metadata = Seq(
              MetadataEntryProto(key = "someKey1", stringValue = Some("someStringValue - segment 2")),
              MetadataEntryProto(key = "someKey3", stringListValue = Seq("list", "value", "segment 2")),
              MetadataEntryProto(key = "identicalKey", stringValue = Some("identicalValue"))
            ),
            anchorPosition = Some(Vec3IntProto(2, 2, 2)),
            groupId = Some(2)
          ))
      )
    }

    "merge two segments (segment 2 doesn't exist, though)" in {
      val action = MergeSegmentsVolumeAction(1, 2, Dummies.tracingId)
      val result = action.applyOn(Dummies.volumeTracing.withSegments(Seq(segmentWithMetadata1)))

      assert(result.segments == Seq(segmentWithMetadata1))
    }
  }

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
      val updateSegmentAction = LegacyUpdateSegmentVolumeAction(
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
        UpdateSegmentMetadataVolumeAction(
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
        UpdateSegmentMetadataVolumeAction(
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
      val updateSegmentGroupsVolumeAction = new LegacyUpdateSegmentGroupsVolumeAction(
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
      val updateSegmentGroupsVolumeAction = new LegacyUpdateSegmentGroupsVolumeAction(
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
    "insert a new segment group" in {
      val groupId = 1
      val initialName = "Group 1"

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

    }

    "rename a segment group" in {
      val groupId = 1
      val renamedName = "Group Renamed"
      val renameGroupAction = UpsertSegmentGroupVolumeAction(
        groupId = groupId,
        name = Some(renamedName),
        newParentId = None,
        actionTracingId = Dummies.tracingId
      )

      val result = renameGroupAction.applyOn(tracingWithSegmentGroups)
      assert(
        result.segmentGroups.head == SegmentGroup(
          renamedName,
          groupId = groupId,
          children = tracingWithSegmentGroups.segmentGroups.head.children,
          isExpanded = tracingWithSegmentGroups.segmentGroups.head.isExpanded
        ))
    }

    "reparent a segment group recursively correctly to root" in {
      val newParent = -1

      val upsertGroup3Action = UpsertSegmentGroupVolumeAction(
        groupId = groupId3,
        name = None,
        newParentId = Some(newParent),
        actionTracingId = Dummies.tracingId
      )
      val result = upsertGroup3Action.applyOn(tracingWithSegmentGroups)

      val expectedGroupsAfterReparenting = Seq(
        SegmentGroup(
          "Group 1",
          groupId1,
          Seq(SegmentGroup("Group 2", groupId2, Seq(), Some(true))),
          Some(true)
        ),
        SegmentGroup("Group 5",
                     groupId5,
                     Seq(SegmentGroup("Group 6", groupId6, Seq(), Some(true)),
                         SegmentGroup("Group 7", groupId7, Seq(), Some(true))),
                     Some(true)),
        SegmentGroup("Group 3", groupId3, Seq(SegmentGroup("Group 4", groupId4, Seq(), Some(true))), Some(true))
      )
      assert(result.segmentGroups == expectedGroupsAfterReparenting)
    }

    "reparent a segment group recursively correctly to root 2nd" in {
      val newParent = -1
      val upsertGroup2Action = UpsertSegmentGroupVolumeAction(
        groupId = groupId2,
        name = None,
        newParentId = Some(newParent),
        actionTracingId = Dummies.tracingId
      )
      val result = upsertGroup2Action.applyOn(tracingWithSegmentGroups)

      val expectedGroupsAfterReparenting = Seq(
        SegmentGroup(
          "Group 1",
          groupId1,
          Seq(),
          Some(true)
        ),
        SegmentGroup("Group 5",
                     groupId5,
                     Seq(SegmentGroup("Group 6", groupId6, Seq(), Some(true)),
                         SegmentGroup("Group 7", groupId7, Seq(), Some(true))),
                     Some(true)),
        SegmentGroup(
          "Group 2",
          groupId2,
          Seq(SegmentGroup("Group 3", groupId3, Seq(SegmentGroup("Group 4", groupId4, Seq(), Some(true))), Some(true))),
          Some(true))
      )
      assert(result.segmentGroups == expectedGroupsAfterReparenting)

    }

    "reparent a segment group recursively correctly" in {
      val newParent = 1

      val upsertGroup3Action = UpsertSegmentGroupVolumeAction(
        groupId = groupId3,
        name = None,
        newParentId = Some(newParent),
        actionTracingId = Dummies.tracingId
      )
      val result = upsertGroup3Action.applyOn(tracingWithSegmentGroups)
      val expectedGroupsAfterReparenting = Seq(
        SegmentGroup(
          "Group 1",
          groupId1,
          Seq(SegmentGroup("Group 2", groupId2, Seq(), Some(true)),
              SegmentGroup("Group 3", groupId3, Seq(SegmentGroup("Group 4", groupId4, Seq(), Some(true))), Some(true))),
          Some(true)
        ),
        SegmentGroup("Group 5",
                     groupId5,
                     Seq(SegmentGroup("Group 6", groupId6, Seq(), Some(true)),
                         SegmentGroup("Group 7", groupId7, Seq(), Some(true))),
                     Some(true))
      )
      assert(result.segmentGroups == expectedGroupsAfterReparenting)
    }

    "reparent a segment group into a different root subtree with children" in {

      val newParent2 = 4
      val upsertGroup5Action = UpsertSegmentGroupVolumeAction(
        groupId = groupId5,
        name = None,
        newParentId = Some(newParent2),
        actionTracingId = Dummies.tracingId
      )
      val result = upsertGroup5Action.applyOn(tracingWithSegmentGroups)
      val expectedGroupsAfterReparenting = Seq(
        SegmentGroup(
          "Group 1",
          groupId1,
          Seq(
            SegmentGroup(
              "Group 2",
              groupId2,
              Seq(SegmentGroup(
                "Group 3",
                groupId3,
                Seq(SegmentGroup(
                  "Group 4",
                  groupId4,
                  Seq(SegmentGroup("Group 5",
                                   groupId5,
                                   Seq(SegmentGroup("Group 6", groupId6, Seq(), Some(true)),
                                       SegmentGroup("Group 7", groupId7, Seq(), Some(true))),
                                   Some(true))),
                  Some(true)
                )),
                Some(true)
              )),
              Some(true)
            )),
          Some(true)
        ),
      )
      assert(result.segmentGroups == expectedGroupsAfterReparenting)
    }

    "rename a group in first root subtree" in {

      val newName = "New Name"
      val renameGroup3Action = UpsertSegmentGroupVolumeAction(
        groupId = groupId3,
        name = Some(newName),
        newParentId = None,
        actionTracingId = Dummies.tracingId
      )
      val result = renameGroup3Action.applyOn(tracingWithSegmentGroups)
      val expectedGroupsAfterRenaming = Seq(
        SegmentGroup(
          "Group 1",
          groupId1,
          Seq(
            SegmentGroup(
              "Group 2",
              groupId2,
              Seq(
                SegmentGroup(newName, groupId3, Seq(SegmentGroup("Group 4", groupId4, Seq(), Some(true))), Some(true))),
              Some(true))),
          Some(true)
        ),
        SegmentGroup("Group 5",
                     groupId5,
                     Seq(SegmentGroup("Group 6", groupId6, Seq(), Some(true)),
                         SegmentGroup("Group 7", groupId7, Seq(), Some(true))),
                     Some(true))
      )
      assert(result.segmentGroups == expectedGroupsAfterRenaming)
    }

    "rename a group in second root subtree" in {

      val newName = "New Name"
      val renameGroup6Action = UpsertSegmentGroupVolumeAction(
        groupId = groupId6,
        name = Some(newName),
        newParentId = None,
        actionTracingId = Dummies.tracingId
      )
      val result2 = renameGroup6Action.applyOn(tracingWithSegmentGroups)
      val expectedGroupsAfterRenaming = Seq(
        SegmentGroup(
          "Group 1",
          groupId1,
          Seq(
            SegmentGroup("Group 2",
                         groupId2,
                         Seq(
                           SegmentGroup("Group 3",
                                        groupId3,
                                        Seq(SegmentGroup("Group 4", groupId4, Seq(), Some(true))),
                                        Some(true))),
                         Some(true))),
          Some(true)
        ),
        SegmentGroup("Group 5",
                     groupId5,
                     Seq(SegmentGroup(newName, groupId6, Seq(), Some(true)),
                         SegmentGroup("Group 7", groupId7, Seq(), Some(true))),
                     Some(true))
      )
      assert(result2.segmentGroups == expectedGroupsAfterRenaming)
    }
  }
  "DeleteSegmentGroupVolumeAction" should {

    "delete a segment group recursively correctly - delete group 1" in {
      val deleteGroup1Action = DeleteSegmentGroupVolumeAction(
        groupId = groupId1,
        actionTracingId = Dummies.tracingId
      )
      val result = deleteGroup1Action.applyOn(tracingWithSegmentGroups)
      val expectedGroupsAfterDeletion = Seq(
        SegmentGroup("Group 5",
                     groupId5,
                     Seq(SegmentGroup("Group 6", groupId6, Seq(), Some(true)),
                         SegmentGroup("Group 7", groupId7, Seq(), Some(true))),
                     Some(true))
      )
      assert(result.segmentGroups == expectedGroupsAfterDeletion)
    }
    "delete a segment group recursively correctly - delete group 2" in {
      val deleteGroup2Action = DeleteSegmentGroupVolumeAction(
        groupId = groupId2,
        actionTracingId = Dummies.tracingId
      )
      val result = deleteGroup2Action.applyOn(tracingWithSegmentGroups)
      val expectedGroupsAfterDeletion = Seq(
        SegmentGroup(
          "Group 1",
          groupId1,
          Seq(),
          Some(true)
        ),
        SegmentGroup("Group 5",
                     groupId5,
                     Seq(SegmentGroup("Group 6", groupId6, Seq(), Some(true)),
                         SegmentGroup("Group 7", groupId7, Seq(), Some(true))),
                     Some(true))
      )
      assert(result.segmentGroups == expectedGroupsAfterDeletion)
    }
    "delete a segment group recursively correctly - delete group 3" in {
      val deleteGroup3Action = DeleteSegmentGroupVolumeAction(
        groupId = groupId3,
        actionTracingId = Dummies.tracingId
      )
      val result = deleteGroup3Action.applyOn(tracingWithSegmentGroups)
      val expectedGroupsAfterDeletion = Seq(
        SegmentGroup(
          "Group 1",
          groupId1,
          Seq(SegmentGroup("Group 2", groupId2, Seq(), Some(true))),
          Some(true)
        ),
        SegmentGroup("Group 5",
                     groupId5,
                     Seq(SegmentGroup("Group 6", groupId6, Seq(), Some(true)),
                         SegmentGroup("Group 7", groupId7, Seq(), Some(true))),
                     Some(true))
      )
      assert(result.segmentGroups == expectedGroupsAfterDeletion)
    }
  }

}
