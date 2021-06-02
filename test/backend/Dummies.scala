package backend

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.geometry.{Color, Point3D, Vector3D}

object Dummies {
  val timestamp = 123456789

  def createDummyNode(id: Int): Node =
    Node(id, Point3D(id, id + 1, id + 2), Vector3D(id, id + 1, id + 2), id, 1, 10, 8, id % 2 == 0, timestamp)

  val tree1: Tree = Tree(
    1,
    Seq(createDummyNode(0), createDummyNode(1), createDummyNode(2), createDummyNode(7)),
    Seq(Edge(0, 1), Edge(2, 1), Edge(1, 7)),
    Some(Color(23, 23, 23, 1)),
    Seq(BranchPoint(1, 0), BranchPoint(7, 0)),
    Seq(Comment(0, "comment")),
    "TestTree-1",
    timestamp,
    None,
    Some(true)
  )

  val tree2: Tree = Tree(
    2,
    Seq(createDummyNode(4), createDummyNode(5), createDummyNode(6)),
    Seq(Edge(4, 5), Edge(5, 6)),
    Some(Color(30, 30, 30, 1)),
    Seq[BranchPoint](),
    Seq[Comment](),
    "TestTree-2",
    timestamp,
    Some(1),
    Some(true)
  )

  val treeGroup1: TreeGroup = TreeGroup("Axon 1", 1, Seq(TreeGroup("Blah", 3), TreeGroup("Blah 2", 4)))
  val treeGroup2: TreeGroup = TreeGroup("Axon 2", 2)

  val tracing: SkeletonTracing = SkeletonTracing("dummy_dataset",
                                Seq(tree1, tree2),
                                timestamp,
                                None,
                                Some(1),
                                Point3D(1, 1, 1),
                                Vector3D(1.0, 1.0, 1.0),
                                1.0,
                                0,
                                None,
                                Seq(treeGroup1, treeGroup2),
                                Seq.empty,
                                Some("testOrganization"))

  //tree with two components, from tree1 and tree2
  val comp1Nodes = Seq(createDummyNode(10), createDummyNode(11), createDummyNode(12), createDummyNode(13))
  val comp2Nodes = Seq(createDummyNode(20), createDummyNode(21))
  val comp1Edges = Seq(Edge(10, 11), Edge(10, 12), Edge(12, 13))
  val comp2Edges = Seq(Edge(20, 21))
  val componentTree: Tree =
    Tree(3, comp1Nodes ++ comp2Nodes, comp1Edges ++ comp2Edges, None, Seq(), Seq(), "Test Tree-3", timestamp, None)

  val emptyTree: Tree = Tree(4, Seq(), Seq(), None, Seq(), Seq(), "Test Tree-3", timestamp, None)

  val componentTracing: SkeletonTracing = SkeletonTracing("dummy_dataset",
                                         Seq(componentTree, emptyTree),
                                         timestamp,
                                         None,
                                         None,
                                         Point3D(1, 1, 1),
                                         Vector3D(1.0, 1.0, 1.0),
                                         1.0,
                                         0,
                                         None,
                                         Seq())
}
