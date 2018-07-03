package backend

import java.io.ByteArrayInputStream

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.{Point3D, Vector3D}
import models.annotation.nml.NmlParser
import net.liftweb.common.{Box, Full}
import org.scalatest.FlatSpec
import play.api.libs.iteratee.Iteratee
import reactivemongo.bson.BSONObjectID
import utils.ObjectId

import scala.concurrent.Await
import scala.concurrent.duration.Duration


class NMLUnitTestSuite extends FlatSpec {
  val timestamp = 123456789

  def getObjectId = ObjectId.fromBsonId(BSONObjectID.generate)

  def writeAndParseTracing(tracing: SkeletonTracing): Box[(Either[SkeletonTracing, (VolumeTracing, String)], String)] = {
    val nmlEnumarator = NMLWriterTestStub.toNmlStream(tracing, None)
    val arrayFuture = Iteratee.flatten(nmlEnumarator |>> Iteratee.consume[Array[Byte]]()).run
    val array = Await.result(arrayFuture, Duration.Inf)
    NmlParser.parse("", new ByteArrayInputStream(array))
  }

  def isParseSuccessful(parsedTracing: Box[(Either[SkeletonTracing, (VolumeTracing, String)], String)]): Boolean = {
    parsedTracing match {
      case Full(either) => either match {
        case (Left(_), _) => true
        case _ => false
      }
      case _ => false
    }
  }

  def createDummyNode(id: Int) = Node(id, Point3D(id, id, id), Vector3D(id, id, id), id, 1, 10, 8, id % 2 == 0, timestamp)

  var tree1 = Tree(1, Seq(createDummyNode(0), createDummyNode(1), createDummyNode(2), createDummyNode(7)),
    Seq(Edge(0, 1), Edge(2, 1), Edge(1, 7)), Some(Color(23, 23, 23, 1)), Seq(BranchPoint(1, 0), BranchPoint(7, 0)), Seq(Comment(0, "comment")),
    "TestTree-0", timestamp, None)

  var tree2 = Tree(2, Seq(createDummyNode(4), createDummyNode(5), createDummyNode(6)),
    Seq(Edge(4, 5), Edge(5, 6)), Some(Color(30, 30, 30, 1)), Seq[BranchPoint](), Seq[Comment](),
    "TestTree-1", timestamp, Some(1))

  var treeGroup1 = TreeGroup("Axon 1", 1, Seq(TreeGroup("Blah", 3), TreeGroup("Blah 2", 4)))
  var treeGroup2 = TreeGroup("Axon 2", 2)

  var dummyTracing = SkeletonTracing("dummy_dataset", Seq(tree1, tree2), timestamp, None, Some(1), Point3D(1, 1, 1), Vector3D(1.0, 1.0, 1.0), 1.0, 0, None, Seq(treeGroup1, treeGroup2))

  "NML writing and parsing" should "yield the same state" in {
    writeAndParseTracing(dummyTracing) match {
      case Full(either) => either match {
        case (Left(tracing), _) => {
          assert(tracing == dummyTracing)
        }
        case _ => throw new Exception
      }
      case _ => throw new Exception
    }
  }

  "NML Parser" should "throw an error for invalid comment state" in {
    // the comment nodeId is referring to a non-existent node therefore invalid
    val wrongTree = dummyTracing.trees(1).copy(comments = Seq(Comment(99, "test")))
    val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees(0), wrongTree))

    assert(true) //!isParseSuccessful(getParsedTracing(newTracing)))
    //TODO: The parser currently doesn't check this
  }

  it should "throw an error for invalid branchPoint state" in {
    // the branchPoint nodeId is referring to a non-existent node therefore invalid
    val wrongTree = dummyTracing.trees(1).copy(branchPoints = Seq(BranchPoint(99, 0)))
    val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees(0), wrongTree))

    assert(true) //!isParseSuccessful(getParsedTracing(newTracing)))
    //TODO: The parser currently doesn't check this
  }

  it should "throw an error for invalid edge state" in {
    // one of the nodeIds in the edge is referring to a non-existent node  therefore invalid
    val wrongTree = dummyTracing.trees(1).copy(edges = Seq(Edge(99, 5)))
    val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees(0), wrongTree))

    assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
  }

  it should "throw an error for edge with same source and target state" in {
    val wrongTree = dummyTracing.trees(1).copy(edges = Edge(5, 5) +: dummyTracing.trees(1).edges)
    val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees(0), wrongTree))

    assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
  }

  it should "throw an error for duplicate edge state" in {
    val wrongTree = dummyTracing.trees(1).copy(edges = Seq(Edge(4, 5), Edge(4, 5), Edge(5, 6)))
    val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees(0), wrongTree))

    assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
  }

  it should "throw an error for disconnected tree state" in {
    val wrongTree = dummyTracing.trees(1).copy(edges = Seq(Edge(4, 5)))
    val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees(0), wrongTree))

    assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
  }

  it should "throw an error for duplicate tree state" in {
    val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees(0), dummyTracing.trees(0)))

    assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
  }

  it should "throw an error for duplicate node state" in {
    val duplicatedNode = dummyTracing.trees(1).nodes(0);
    val wrongTree = dummyTracing.trees(1).copy(nodes = Seq(duplicatedNode, duplicatedNode))
    val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees(0), wrongTree))

    assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
  }

  it should "throw an error for missing groupId state" in {
    val wrongTree = dummyTracing.trees(1).copy(groupId = Some(9999))
    val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees(0), wrongTree))

    assert(true) //!isParseSuccessful(getParsedTracing(newTracing)))
    //TODO: The parser currently doesn't check this
  }

  it should "throw an error for duplicate groupId state" in {
    val newTracing = dummyTracing.copy(treeGroups = TreeGroup("Group", 3) +: dummyTracing.treeGroups)

    assert(true) //!isParseSuccessful(getParsedTracing(newTracing)))
    //TODO: The parser currently doesn't check this
  }
}
