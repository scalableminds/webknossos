package backend

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.MetadataEntry.MetadataEntryProto
import com.scalableminds.webknossos.datastore.VolumeTracing.{Segment, VolumeTracing}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClassProto
import com.scalableminds.webknossos.datastore.geometry.{BoundingBoxProto, ColorProto, Vec3DoubleProto, Vec3IntProto}

object Dummies {
  val timestamp = 123456789
  val timestampLong = 123456789L

  def createDummyNode(id: Int): Node =
    Node(
      id,
      Vec3IntProto(id, id + 1, id + 2),
      Vec3DoubleProto(id, id + 1, id + 2),
      id.toFloat,
      1,
      10,
      8,
      id % 2 == 0,
      timestamp
    )

  val tree1: Tree = Tree(
    1,
    Seq(createDummyNode(0), createDummyNode(1), createDummyNode(2), createDummyNode(7)),
    Seq(Edge(0, 1), Edge(2, 1), Edge(1, 7)),
    Some(ColorProto(23, 23, 23, 1)),
    Seq(BranchPoint(1, 0), BranchPoint(7, 0)),
    Seq(Comment(0, "comment")),
    "TestTree-1",
    timestamp,
    None,
    Some(true),
    metadata = Seq(
      MetadataEntryProto("aKey", numberValue = Some(5.7)),
      MetadataEntryProto("anotherKey", boolValue = Some(true)),
      MetadataEntryProto("aThirdKey", stringListValue = Seq("multiple", "strings"))
    )
  )

  val tree2: Tree = Tree(
    2,
    Seq(createDummyNode(4), createDummyNode(5), createDummyNode(6)),
    Seq(Edge(4, 5), Edge(5, 6)),
    Some(ColorProto(30, 30, 30, 1)),
    Seq[BranchPoint](),
    Seq[Comment](),
    "TestTree-2",
    timestamp,
    Some(1),
    Some(true)
  )

  val treeGroup1: TreeGroup = TreeGroup(
    "Axon 1",
    1,
    Seq(TreeGroup("Blah", 3, Seq.empty, Some(false)), TreeGroup("Blah 2", 4, Seq.empty, Some(false))),
    Some(true))
  val treeGroup2: TreeGroup = TreeGroup("Axon 2", 2, Seq.empty, Some(true))

  val tracingId: String = "dummyTracingId"

  val skeletonTracing: SkeletonTracing = SkeletonTracing(
    "dummy_dataset",
    Seq(tree1, tree2),
    timestamp,
    None,
    Some(1),
    Vec3IntProto(1, 1, 1),
    Vec3DoubleProto(1.0, 1.0, 1.0),
    1.0,
    0,
    None,
    Seq(treeGroup1, treeGroup2),
    Seq.empty,
    Some("testOrganization")
  )

  //tree with two components, from tree1 and tree2
  val comp1Nodes: Seq[Node] = Seq(createDummyNode(10), createDummyNode(11), createDummyNode(12), createDummyNode(13))
  val comp2Nodes: Seq[Node] = Seq(createDummyNode(20), createDummyNode(21))
  val comp1Edges: Seq[Edge] = Seq(Edge(10, 11), Edge(10, 12), Edge(12, 13))
  val comp2Edges: Seq[Edge] = Seq(Edge(20, 21))
  val componentTree: Tree =
    Tree(3, comp1Nodes ++ comp2Nodes, comp1Edges ++ comp2Edges, None, Seq(), Seq(), "Test Tree-3", timestamp, None)

  val emptyTree: Tree = Tree(4, Seq(), Seq(), None, Seq(), Seq(), "Test Tree-3", timestamp, None)

  val componentSkeletonTracing: SkeletonTracing = SkeletonTracing(
    "dummy_dataset",
    Seq(componentTree, emptyTree),
    timestamp,
    None,
    None,
    Vec3IntProto(1, 1, 1),
    Vec3DoubleProto(1.0, 1.0, 1.0),
    1.0,
    0,
    None,
    Seq.empty,
    Seq.empty,
    Some("testOrganization")
  )

  val volumeTracing: VolumeTracing = VolumeTracing(
    None,
    BoundingBoxProto(Vec3IntProto(0, 0, 0), 10, 10, 10),
    timestamp,
    "dummy_dataset",
    Vec3IntProto(1, 1, 1),
    Vec3DoubleProto(1.0, 1.0, 1.0),
    ElementClassProto.uint16,
    None,
    Some(5L),
    0,
    1.0,
    segments = Seq(Segment(5, Some(Vec3IntProto(7, 7, 7)))),
    hasSegmentIndex = Some(true)
  )
}
