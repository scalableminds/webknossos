package backend

import java.io.ByteArrayInputStream

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.geometry.{Point3D, Vector3D}
import com.scalableminds.webknossos.datastore.tracings.{TracingReference, TracingType}
import models.annotation.AnnotationSQL
import models.annotation.nml.{NmlParser, NmlWriter}
import org.specs2.main.Arguments
import org.scalatest.FlatSpec
import play.api.libs.iteratee.Enumerator
import reactivemongo.bson.BSONObjectID
import utils.ObjectId

class NMLUnitTest(arguments: Arguments) extends FlatSpec {
  val timestamp = 123456789

  def getObjectId = ObjectId.fromBsonId(BSONObjectID.generate)

  def createDummyNode(id: Int) = Node(id, Point3D(id, id, id), Vector3D(id, id, id), id, 1, 10, 8, id % 2 == 0, id)

  val tree1 = Tree(1, Seq(createDummyNode(0), createDummyNode(1), createDummyNode(2), createDummyNode(7)),
    Seq(Edge(0, 1), Edge(2, 1), Edge(1, 7)), Some(Color(23, 23, 23, 1)), Seq(BranchPoint(1, 0), BranchPoint(7, 0)), Seq(Comment(0, "comment")),
    "TestTree-0", timestamp, None)

  val tree2 = Tree(2, Seq(createDummyNode(4), createDummyNode(5), createDummyNode(6)),
    Seq(Edge(4, 5), Edge(5, 6)), Some(Color(30, 30, 30, 1)), Seq[BranchPoint](), Seq[Comment](),
    "TestTree-1", timestamp, Some(1))

  val treeGroup1 = TreeGroup("Axon 1", 1, Seq(TreeGroup("Blah", 3), TreeGroup("Blah 2", 4)))
  val treeGroup2 = TreeGroup("Axon 2", 2)

  val dummyTracing = SkeletonTracing("dummy_dataset", Seq(tree1, tree2), timestamp, None, Some(1), Point3D(1, 1, 1), Vector3D(1, 1, 1), 1.0, 1, None, Seq(treeGroup1, treeGroup2))

  val dummyAnnotation = AnnotationSQL(getObjectId, getObjectId, None, getObjectId, getObjectId, TracingReference(getObjectId.toString, TracingType.skeleton))

  /*"NML serializing and parsing" should "yield the same state" in {
    val nml = NmlWriter.toNmlStream(Left(dummyTracing), dummyAnnotation, None)
    Enumerator.
    val parsedTracing = NmlParser.parse("", nml.)
  }
  /*
  * _id: ObjectId,
                          _dataSet: ObjectId,
                          _task: Option[ObjectId] = None,
                          _team: ObjectId,
                          _user: ObjectId,
                          tracing: TracingReference,
                          description: String = "",
                          isPublic: Boolean = false,
                          name: String = "",
                          state: AnnotationState.Value = Active,
                          statistics: JsObject = Json.obj(),
                          tags: Set[String] = Set.empty,
                          tracingTime: Option[Long] = None,
                          typ: AnnotationTypeSQL.Value = AnnotationTypeSQL.Explorational,
                          created: Long = System.currentTimeMillis,
                          modified: Long = System.currentTimeMillis,
                          isDeleted: Boolean = false
  * */
}
