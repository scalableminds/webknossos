package backend

import java.io.ByteArrayInputStream

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.geometry.{Point3D, Vector3D}
import com.scalableminds.webknossos.datastore.tracings.{TracingReference, TracingType}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationSQL
import models.annotation.nml.NmlParser
import net.liftweb.common.Full
import org.scalatest.FlatSpec
import play.api.libs.iteratee.Iteratee
import reactivemongo.bson.BSONObjectID
import utils.ObjectId

import scala.concurrent.Await
import scala.concurrent.duration.Duration


class NMLUnitTestSuite extends FlatSpec with LazyLogging {
  logger.debug(s"test run")
  val timestamp = 123456789

  def getObjectId = ObjectId.fromBsonId(BSONObjectID.generate)

  def getParsedTracing(tracing: SkeletonTracing) = {
    val nmlEnumarator = NMLWriterTestStub.toNmlStream(tracing, None)
    val arrayFuture = Iteratee.flatten(nmlEnumarator |>> Iteratee.consume[Array[Byte]]()).run
    val array = Await.result(arrayFuture, Duration.Inf)
    NmlParser.parse("", new ByteArrayInputStream(array))
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
    val nmlEnumarator = NMLWriterTestStub.toNmlStream(dummyTracing, None)
    val arrayFuture = Iteratee.flatten(nmlEnumarator |>> Iteratee.consume[Array[Byte]]()).run
    val array = Await.result(arrayFuture, Duration.Inf)
    val parsedTracing = NmlParser.parse("", new ByteArrayInputStream(array))

    parsedTracing match {
      case Full(either) => either match {
        case (Left(tracing), _) => {
          assert(tracing == dummyTracing)
        }
        case _ => throw new Exception
      }
      case _ => throw new Exception
    }
  }

  "NML Parser" should "throw error for invalid comment state" in {
    val wrongTree = dummyTracing.trees(1).copy(comments = Seq(Comment(99, "test")))
    val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees(0), wrongTree))

    println(newTracing)

    assertThrows(getParsedTracing(newTracing))
  }


  /*
  - invalidCommentState
  tracing: { trees: { "2": { comments: { $set: [{ content: "test", nodeId: 99 }] } } } },
  - invalidBranchPointState
  tracing: { trees: { "2": { branchPoints: { $set: [{ timestamp: 0, nodeId: 99 }] } } } },
  - invalidEdgeState
  tracing: {
      trees: {
        "2": { edges: { $set: EdgeCollection.loadFromArray([{ source: 99, target: 5 }]) } },
      },
    },
  - duplicateEdgeState
  tracing: {
      trees: {
        "2": {
          edges: {
            $set: EdgeCollection.loadFromArray([
              { source: 4, target: 5 },
              { source: 4, target: 5 },
              { source: 5, target: 6 },
            ]),
          },
        },
      },
    },
  - disconnectedTreeState
  tracing: {
      trees: { "2": { edges: { $set: EdgeCollection.loadFromArray([{ source: 4, target: 5 }]) } } },
    },
  - missingGroupIdState
  tracing: {
      trees: {
        "2": {
          groupId: { $set: 9999 },
        },
      },
    },
  - duplicateGroupIdState
  tracing: {
      treeGroups: {
        $push: [
          {
            groupId: 3,
            name: "Group",
            children: [],
          },
        ],
      },
    },
  */

  /*message SkeletonTracing {
    required string dataSetName = 1;
    repeated Tree trees = 2;
    required int64 createdTimestamp = 3;
    optional BoundingBox boundingBox = 4;
    optional int32 activeNodeId = 5;
    required Point3D editPosition = 6;
    required Vector3D editRotation = 7;
    required double zoomLevel = 8;
    required int64 version = 9;
    optional BoundingBox userBoundingBox = 10;
    repeated TreeGroup treeGroups = 11;
}
*/

}
