package backend

import java.io.ByteArrayInputStream

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.geometry.{Point3D, Vector3D}
import com.scalableminds.webknossos.datastore.tracings.{TracingReference, TracingType}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationSQL
import models.annotation.nml.{NmlParser, NmlWriter}
import net.liftweb.common.Full
import org.scalatest.FlatSpec
import org.specs2.main.Arguments
import play.api.libs.iteratee.Iteratee
import play.api.test.{FakeApplication, WithServer}
import reactivemongo.bson.BSONObjectID
import utils.ObjectId

import scala.concurrent.Await
import scala.concurrent.duration.Duration


class NMLUnitTestSuite extends FlatSpec with LazyLogging {
  logger.debug(s"test run")
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


  "NML serializing and parsing" should "yield the same state" in new WithServer(app = FakeApplication(
    additionalConfiguration = Map("http.port" -> 9000,
      "play.modules.disabled" -> List("com.scalableminds.webknossos.datastore.DataStoreModule"),
      "play.http.router" -> "webknossos.Routes",
      "datastore.enabled" -> false)
  ),
    port = 9000) {
    logger.debug(s"test run")
    val nmlEnumarator = NmlWriter.toNmlStream(Left(dummyTracing), dummyAnnotation, None)
    val arrayFuture = Iteratee.flatten(nmlEnumarator |>> Iteratee.consume[Array[Byte]]()).run
    val array = Await.result(arrayFuture, Duration.Inf)
    val parsedTracing = NmlParser.parse("", new ByteArrayInputStream(array))

    parsedTracing match {
      case Full(either) => either match {
        case (Left(tracing), _) => {
          logger.info(tracing.toString)
          logger.info(dummyTracing.toString)
          assert(tracing == dummyTracing)
        }
        case _ => throw new Exception
      }
      case _ => throw new Exception
    }
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
