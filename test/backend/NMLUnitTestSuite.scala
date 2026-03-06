package backend

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto

import java.io.ByteArrayInputStream
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.geometry.{AdditionalAxisProto, Vec2IntProto}
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, FetchedAnnotationLayer}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat
import models.annotation.SharedParsingParameters
import models.annotation.nml.{NmlParseSuccessWithoutFile, NmlParser, NmlWriter}
import models.dataset.{Dataset, DatasetDAOLike}
import models.user.User
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Empty, Failure, Fox, Full}
import org.apache.commons.io.output.ByteArrayOutputStream
import org.scalatest.Assertion
import org.scalatest.wordspec.AnyWordSpec
import play.api.i18n.{DefaultMessagesApi, Messages, MessagesProvider}
import play.api.libs.json.Json
import play.api.test.FakeRequest
import play.silhouette.api.LoginInfo
import play.silhouette.impl.providers.CredentialsProvider

import scala.concurrent.{ExecutionContext, Future}

class NMLUnitTestSuite extends AnyWordSpec {

  implicit private val ec: ExecutionContext = scala.concurrent.ExecutionContext.global
  implicit private val ctx: DBAccessContext = GlobalAccessContext
  implicit private val messagesProvider: MessagesProvider = new MessagesProvider {
    val m = new DefaultMessagesApi()
    override def messages: Messages = m.preferred({ FakeRequest("GET", "/") })
  }

  private val mockDatasetDAO = new DatasetDAOLike {
    override def findOneByIdOrNameAndOrganization(
        datasetIdOpt: Option[ObjectId],
        datasetName: String,
        organizationId: String)(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[Dataset] =
      Fox.successful(
        Dataset(
          _id = ObjectId.dummyId,
          _dataStore = "dummy",
          _organization = "testOrganization",
          _publication = None,
          _uploader = None,
          _folder = ObjectId.dummyId,
          inboxSourceHash = None,
          directoryName = "dummy_dataset",
          isPublic = false,
          isUsable = true,
          isVirtual = false,
          name = "dummy_dataset",
          voxelSize = None,
          sharingToken = None,
          status = "",
          logoUrl = None
        ))(scala.concurrent.ExecutionContext.global)
  }

  private val nmlParser = new NmlParser(mockDatasetDAO)

  def writeAndParseTracing(skeletonTracing: SkeletonTracing): Fox[NmlParseSuccessWithoutFile] = {
    val annotationLayers = List(
      FetchedAnnotationLayer("dummySkeletonTracingId",
                             AnnotationLayer.defaultSkeletonLayerName,
                             Left(skeletonTracing),
                             None))
    val nmlFunctionStream =
      new NmlWriter()(scala.concurrent.ExecutionContext.global).toNmlStream(
        "",
        AnnotationProto("", 0L, Seq.empty, 0L),
        annotationLayers,
        None,
        None,
        None,
        "testOrganization",
        "http://wk.test",
        "dummy_dataset",
        ObjectId.dummyId,
        User(
          ObjectId.dummyId,
          ObjectId.dummyId,
          "testOrganization",
          "Sample",
          "User",
          Instant.zero,
          Json.obj(),
          LoginInfo(CredentialsProvider.ID, ObjectId.dummyId.toString),
          isAdmin = true,
          isOrganizationOwner = true,
          isDatasetManager = true,
          isUnlisted = false,
          isDeactivated = false,
          lastTaskTypeId = None
        ),
        None,
        volumeDataZipFormat = VolumeDataZipFormat.wkw,
        requestingUser = None
      )
    val os = new ByteArrayOutputStream()
    for {
      _ <- nmlFunctionStream.writeTo(os)
      array = os.toByteArray
      is = new ByteArrayInputStream(array)
      parsingParams = SharedParsingParameters(useZipName = false,
                                              overwritingDatasetId = None,
                                              userOrganizationId = "testOrganization",
                                              isTaskUpload = true)
      parsed <- nmlParser.parse("", is, parsingParams, basePath = None)
    } yield parsed
  }

  def assertParsingFailed(parsedTracingFox: Fox[NmlParseSuccessWithoutFile]): Future[Assertion] =
    parsedTracingFox.futureBox.map {
      case Full(tuple) =>
        assert(!tuple.isInstanceOf[NmlParseSuccessWithoutFile])
      case _: Failure => succeed
      case Empty      => fail()
    }

  private val dummyTracing = Dummies.skeletonTracing

  "NML writing and parsing" should {
    "yield the same state" in {
      writeAndParseTracing(dummyTracing).futureBox.map {
        case Full(tuple) =>
          tuple match {
            case NmlParseSuccessWithoutFile(tracing, _, _, _, _) =>
              assert(tracing == dummyTracing)
            case _ => fail()
          }
        case _ => fail()
      }
    }
  }

  "NML writing and parsing" should {
    "add missing isExpanded props with a default of true" in {
      val treeGroupsWithOmittedIsExpanded = dummyTracing.treeGroups.map(
        treeGroup =>
          new TreeGroup(name = treeGroup.name,
                        groupId = treeGroup.groupId,
                        children = treeGroup.children,
                        isExpanded = if (treeGroup.isExpanded.getOrElse(true)) None else Some(false)))
      val dummyTracingWithOmittedIsExpandedTreeGroupProp =
        dummyTracing.copy(treeGroups = treeGroupsWithOmittedIsExpanded)
      writeAndParseTracing(dummyTracingWithOmittedIsExpandedTreeGroupProp).futureBox.map {
        case Full(tuple) =>
          tuple match {
            case NmlParseSuccessWithoutFile(tracing, _, _, _, _) =>
              assert(tracing == dummyTracing)
            case _ => fail()
          }
        case _ => fail()
      }
    }
  }

  "NML Parser" should {
    "throw an error for invalid comment with a non-existent nodeId" in {
      // the comment nodeId is referring to a non-existent node therefore invalid
      val wrongTree = dummyTracing.trees(1).copy(comments = Seq(Comment(99, "test")))
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assertParsingFailed(writeAndParseTracing(newTracing))
    }
    "throw an error for a branchPoint with a non-existent nodeId" in {
      val wrongTree = dummyTracing.trees(1).copy(branchPoints = Seq(BranchPoint(99, 0)))
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assertParsingFailed(writeAndParseTracing(newTracing))
    }

    "throw an error for an edge which is referring to a non-existent node" in {
      val wrongTree = dummyTracing.trees(1).copy(edges = Seq(Edge(99, 5)))
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assertParsingFailed(writeAndParseTracing(newTracing))
    }

    "throw an error for edge with same source and target state" in {
      val wrongTree = dummyTracing.trees(1).copy(edges = Edge(5, 5) +: dummyTracing.trees(1).edges)
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assertParsingFailed(writeAndParseTracing(newTracing))
    }

    "throw an error for duplicate edge state" in {
      val wrongTree = dummyTracing.trees(1).copy(edges = Seq(Edge(4, 5), Edge(4, 5), Edge(5, 6)))
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assertParsingFailed(writeAndParseTracing(newTracing))
    }

    "throw an error for duplicate tree state" in {
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, dummyTracing.trees.head))

      assertParsingFailed(writeAndParseTracing(newTracing))
    }

    "throw an error for duplicate node state" in {
      val duplicatedNode = dummyTracing.trees(1).nodes.head
      val wrongTree = dummyTracing.trees(1).copy(nodes = Seq(duplicatedNode, duplicatedNode))
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assertParsingFailed(writeAndParseTracing(newTracing))
    }

    "throw an error for missing groupId state" in {
      val wrongTree = dummyTracing.trees(1).copy(groupId = Some(9999))
      val newTracing = dummyTracing.copy(trees = Seq(dummyTracing.trees.head, wrongTree))

      assertParsingFailed(writeAndParseTracing(newTracing))
    }

    "throw an error for duplicate groupId state" in {
      val newTracing = dummyTracing.copy(treeGroups = TreeGroup("Group", 3) +: dummyTracing.treeGroups)

      assertParsingFailed(writeAndParseTracing(newTracing))
    }

    "throw an error for multiple additional coordinates of the same name" in {
      val newTracing = dummyTracing.copy(
        additionalAxes = Seq(new AdditionalAxisProto("t", 0, Vec2IntProto(0, 10)),
                             new AdditionalAxisProto("t", 1, Vec2IntProto(10, 20))))

      assertParsingFailed(writeAndParseTracing(newTracing))
    }
  }
}
