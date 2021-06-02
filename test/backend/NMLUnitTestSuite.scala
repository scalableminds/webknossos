package backend

import java.io.ByteArrayInputStream

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import models.annotation.nml.{NmlParser, NmlWriter}
import net.liftweb.common.{Box, Full}
import org.scalatestplus.play.PlaySpec
import play.api.i18n.{DefaultMessagesApi, Messages, MessagesProvider}
import play.api.libs.iteratee.Iteratee
import play.api.test.FakeRequest

import scala.concurrent.Await
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.Duration

class NMLUnitTestSuite extends PlaySpec {
  implicit val messagesProvider: MessagesProvider = new MessagesProvider {
    val m = new DefaultMessagesApi()
    override def messages: Messages = m.preferred({ FakeRequest("GET", "/") })
  }

  def writeAndParseTracing(skeletonTracing: SkeletonTracing)
    : Box[(Option[SkeletonTracing], Option[(VolumeTracing, String)], String)] = {
    val nmlEnumarator =
      new NmlWriter().toNmlStream(Some(skeletonTracing), None, None, None, None, "testOrganization", None, None)
    val arrayFuture = Iteratee.flatten(nmlEnumarator |>> Iteratee.consume[Array[Byte]]()).run
    val array = Await.result(arrayFuture, Duration.Inf)
    NmlParser.parse("", new ByteArrayInputStream(array), None, isTaskUpload = true)
  }

  def isParseSuccessful(
      parsedTracing: Box[(Option[SkeletonTracing], Option[(VolumeTracing, String)], String)]): Boolean =
    parsedTracing match {
      case Full(tuple) =>
        tuple match {
          case (Some(_), _, _) => true
          case _                  => false
        }
      case _ => false
    }

  private val dummyTracing = Dummies.tracing

  "NML writing and parsing" should {
    "yield the same state" in {
      writeAndParseTracing(dummyTracing) match {
        case Full(tuple) =>
          tuple match {
            case (Some(tracing), _, _) =>
              assert(tracing == dummyTracing)
            case _ => throw new Exception
          }
        case _ => throw new Exception
      }
    }
  }

  "NML Parser" should {
    "throw an error for invalid comment with a non-existent nodeId" in {
      // the comment nodeId is referring to a non-existent node therefore invalid
      val wrongTree = dummyTracing.trees(1).copy(comments = Seq(Comment(99, "test")))
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
    }
    "throw an error for a branchPoint with a non-existent nodeId" in {
      val wrongTree = dummyTracing.trees(1).copy(branchPoints = Seq(BranchPoint(99, 0)))
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
    }

    "throw an error for an edge which is referring to a non-existent node" in {
      val wrongTree = dummyTracing.trees(1).copy(edges = Seq(Edge(99, 5)))
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
    }

    "throw an error for edge with same source and target state" in {
      val wrongTree = dummyTracing.trees(1).copy(edges = Edge(5, 5) +: dummyTracing.trees(1).edges)
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
    }

    "throw an error for duplicate edge state" in {
      val wrongTree = dummyTracing.trees(1).copy(edges = Seq(Edge(4, 5), Edge(4, 5), Edge(5, 6)))
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
    }

    "throw an error for duplicate tree state" in {
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, dummyTracing.trees.head))

      assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
    }

    "throw an error for duplicate node state" in {
      val duplicatedNode = dummyTracing.trees(1).nodes.head
      val wrongTree = dummyTracing.trees(1).copy(nodes = Seq(duplicatedNode, duplicatedNode))
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
    }

    "throw an error for missing groupId state" in {
      val wrongTree = dummyTracing.trees(1).copy(groupId = Some(9999))
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
    }

    "throw an error for duplicate groupId state" in {
      val newTracing = dummyTracing.copy(treeGroups = TreeGroup("Group", 3) +: dummyTracing.treeGroups)

      assert(!isParseSuccessful(writeAndParseTracing(newTracing)))
    }
  }
}
