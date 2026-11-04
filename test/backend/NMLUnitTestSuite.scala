package backend

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto

import java.io.ByteArrayInputStream
import com.scalableminds.webknossos.datastore.SkeletonTracing.*
import com.scalableminds.webknossos.datastore.AnnotationBookmark.{
  AnnotationBookmarkProto,
  AnnotationBookmarkStateProto,
  BookmarkLayerStateProto,
  BookmarkMappingProto,
  BookmarkMeshProto,
  BookmarkTdCameraProto
}
import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkProto.ThumbnailViewportProto
import com.scalableminds.webknossos.datastore.AnnotationBookmark.AnnotationBookmarkStateProto.{
  MappingTypeProto,
  ViewModeProto
}
import com.scalableminds.webknossos.datastore.MetadataEntry.MetadataEntryProto
import com.scalableminds.webknossos.datastore.geometry.{
  AdditionalAxisProto,
  AdditionalCoordinateProto,
  Vec2DoubleProto,
  Vec2IntProto,
  Vec3DoubleProto,
  Vec3IntProto
}
import com.scalableminds.webknossos.tracingstore.annotation.BookmarkThumbnailSize
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, FetchedAnnotationLayer}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat
import models.annotation.SharedParsingParameters
import models.annotation.nml.{
  NmlAnnotationLayerRef,
  NmlBookmarkToWrite,
  NmlBookmarks,
  NmlParseSuccessWithoutFile,
  NmlParser,
  NmlSkeletonLayerRef,
  NmlVolumeLayerRef,
  NmlWriter
}
import models.dataset.{Dataset, DatasetDAOLike}
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.box.{Empty, Failure, Full}
import com.scalableminds.util.tools.Fox
import org.apache.commons.io.output.ByteArrayOutputStream
import org.scalatest.Assertion
import org.scalatest.wordspec.AsyncWordSpec

import scala.concurrent.{ExecutionContext, Future}

class NMLUnitTestSuite extends AsyncWordSpec {

  implicit private val ec: ExecutionContext = scala.concurrent.ExecutionContext.global
  implicit private val ctx: DBAccessContext = GlobalAccessContext

  private val mockDatasetDAO = new DatasetDAOLike {
    override def findOneByIdOrNameAndOrganization(
        datasetIdOpt: Option[ObjectId],
        datasetName: String,
        organizationId: String
    )(using ctx: DBAccessContext): Fox[Dataset] =
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
        )
      )
  }

  private val nmlParser = new NmlParser(mockDatasetDAO)

  private val skeletonTracingId = "dummySkeletonTracingId"
  private val volumeTracingId = "dummyVolumeTracingId"
  private val volumeLayerName = "My Volume"

  private def writeToXmlBytes(
      skeletonTracing: SkeletonTracing,
      bookmarks: Seq[NmlBookmarkToWrite] = Seq.empty,
      datasetLayerNames: Option[Set[String]] = None
  ): Fox[Array[Byte]] = {
    val skeletonLayer = FetchedAnnotationLayer(
      skeletonTracingId,
      AnnotationLayer.defaultSkeletonLayerName,
      Left(skeletonTracing),
      None
    )
    val volumeLayer = FetchedAnnotationLayer(volumeTracingId, volumeLayerName, Right(Dummies.volumeTracing), None)
    // The volume layer is only needed for bookmarks, keep the other tests skeleton-only.
    val annotationLayers = if (bookmarks.isEmpty) List(skeletonLayer) else List(skeletonLayer, volumeLayer)
    val nmlFunctionStream =
      new NmlWriter().toNmlStream(
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
        ObjectId.dummyId,
        "Sample User",
        None,
        volumeDataZipFormat = VolumeDataZipFormat.wkw,
        requestingUser = None,
        bookmarks = bookmarks,
        datasetLayerNames = datasetLayerNames
      )
    val os = new ByteArrayOutputStream()
    for {
      _ <- nmlFunctionStream.writeTo(os)
    } yield os.toByteArray
  }

  private def parseXmlBytes(xmlBytes: Array[Byte]): Fox[NmlParseSuccessWithoutFile] = {
    val is = new ByteArrayInputStream(xmlBytes)
    val parsingParams = SharedParsingParameters(
      useZipName = false,
      overwritingDatasetId = None,
      userOrganizationId = "testOrganization",
      isTaskUpload = true
    )
    nmlParser.parse("", is, parsingParams, basePath = None)
  }

  private def writeAndParseTracing(skeletonTracing: SkeletonTracing): Fox[NmlParseSuccessWithoutFile] =
    for {
      xmlBytes <- writeToXmlBytes(skeletonTracing)
      parsed <- parseXmlBytes(xmlBytes)
    } yield parsed

  def assertParsingFailed(parsedTracingFox: Fox[NmlParseSuccessWithoutFile]): Future[Assertion] =
    parsedTracingFox.futureBox.map {
      case Full(tuple) =>
        assert(!tuple.isInstanceOf[NmlParseSuccessWithoutFile])
      case _: Failure => succeed
      case Empty      => fail()
    }

  private val dummyTracing = Dummies.skeletonTracing

  "NML writing and parsing" should {
    "yield the same state" in
      writeAndParseTracing(dummyTracing).futureBox.map {
        case Full(tuple) =>
          tuple match {
            case NmlParseSuccessWithoutFile(tracing, _, _, _, _, _) =>
              assert(tracing == dummyTracing)
          }
        case _ => fail()
      }
  }

  "NML writing and parsing" should {
    "add missing isExpanded props with a default of true" in {
      val treeGroupsWithOmittedIsExpanded = dummyTracing.treeGroups.map(treeGroup =>
        new TreeGroup(
          name = treeGroup.name,
          groupId = treeGroup.groupId,
          children = treeGroup.children,
          isExpanded = if (treeGroup.isExpanded.getOrElse(true)) None else Some(false)
        )
      )
      val dummyTracingWithOmittedIsExpandedTreeGroupProp =
        dummyTracing.copy(treeGroups = treeGroupsWithOmittedIsExpanded)
      writeAndParseTracing(dummyTracingWithOmittedIsExpandedTreeGroupProp).futureBox.map {
        case Full(tuple) =>
          tuple match {
            case NmlParseSuccessWithoutFile(tracing, _, _, _, _, _) =>
              assert(tracing == dummyTracing)
          }
        case _ => fail()
      }
    }
  }

  "NML writing and parsing" should {
    "deduplicate nodes with the same id when writing, keeping the rest of the tree intact" in {
      val duplicatedNode = dummyTracing.trees.head.nodes.head
      val treeWithDuplicateNode =
        dummyTracing.trees.head.copy(nodes = dummyTracing.trees.head.nodes :+ duplicatedNode)
      val newTracing = dummyTracing.copy(trees = treeWithDuplicateNode +: dummyTracing.trees.tail)

      writeAndParseTracing(newTracing).futureBox.map {
        case Full(tuple) =>
          tuple match {
            case NmlParseSuccessWithoutFile(tracing, _, _, _, _, _) =>
              assert(tracing == dummyTracing)
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

    "throw an error for a raw NML with a duplicated node id" in {
      // Mutates the XML directly because NmlWriter would deduplicate the nodes while writing.
      val nodeTagPattern = """<node[^>]*/>""".r
      writeToXmlBytes(dummyTracing).futureBox.flatMap {
        case Full(xmlBytes) =>
          val xml = new String(xmlBytes, "UTF-8")
          val firstNodeTag = nodeTagPattern.findFirstIn(xml).getOrElse(fail("no <node> tag found in written NML"))
          val xmlWithDuplicatedNode = xml.replaceFirst(
            java.util.regex.Pattern.quote(firstNodeTag),
            java.util.regex.Matcher.quoteReplacement(firstNodeTag + firstNodeTag)
          )
          assertParsingFailed(parseXmlBytes(xmlWithDuplicatedNode.getBytes("UTF-8")))
        case _ => Future.successful(fail("failed to write dummy tracing to XML"))
      }
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
        additionalAxes = Seq(
          new AdditionalAxisProto("t", 0, Vec2IntProto(0, 10)),
          new AdditionalAxisProto("t", 1, Vec2IntProto(10, 20))
        )
      )

      assertParsingFailed(writeAndParseTracing(newTracing))
    }
  }

  private val fullBookmark = AnnotationBookmarkProto(
    id = 3,
    created = 1730000000000L,
    name = Some("A <special> \"bookmark\""),
    description = Some("multi\nline"),
    state = AnnotationBookmarkStateProto(
      position = Vec3IntProto(1, 2, 3),
      mode = ViewModeProto.flight,
      zoomStep = 1.25,
      rotation = Vec3DoubleProto(10.5, 20, 30),
      activeNodeId = Some(1),
      additionalCoordinates = Seq(AdditionalCoordinateProto("t", 4)),
      nativelyRenderedLayerName = Some(volumeTracingId),
      clippingDistance = 55.5,
      clipSkeletonToCurrentSection = true,
      tdCamera = Some(
        BookmarkTdCameraProto(Vec3DoubleProto(1.5, 2.5, 3.5), Vec3DoubleProto(0, 0, -1), -100, 100, 80, -80)
      ),
      showSkeletons = Some(false),
      layers = Seq(
        BookmarkLayerStateProto(
          layerName = "color",
          isDisabled = Some(false),
          intensityRange = Some(Vec2DoubleProto(0, 255)),
          color = Some(Vec3DoubleProto(255, 128, 0)),
          isInverted = Some(true),
          gammaCorrectionValue = Some(1.5)
        ),
        BookmarkLayerStateProto(
          layerName = volumeTracingId,
          mapping = Some(BookmarkMappingProto(volumeTracingId, MappingTypeProto.AGGLOMERATE)),
          meshFileName = Some("meshfile_1"),
          meshes = Seq(
            BookmarkMeshProto(
              segmentId = -2L, // the largest uint64 values are negative as Long
              seedPosition = Vec3IntProto(4, 5, 6),
              isPrecomputed = true,
              meshFileName = Some("meshfile_1")
            ),
            BookmarkMeshProto(
              segmentId = 7L,
              seedPosition = Vec3IntProto(7, 8, 9),
              isPrecomputed = false,
              mappingName = Some("agglomerate_view_5"),
              mappingType = Some(MappingTypeProto.JSON)
            )
          )
        ),
        BookmarkLayerStateProto(layerName = skeletonTracingId, isDisabled = Some(true))
      )
    ),
    createdAtVersion = 0L,
    metadata = Seq(
      MetadataEntryProto("key", stringValue = Some("value")),
      MetadataEntryProto("list", stringListValue = Seq("a", "b"))
    ),
    thumbnailVersion = 0L,
    thumbnailViewport = Some(ThumbnailViewportProto.TD)
  )

  private val minimalBookmark = AnnotationBookmarkProto(
    id = 5,
    created = 1L,
    state = AnnotationBookmarkStateProto(
      position = Vec3IntProto(0, 0, 0),
      mode = ViewModeProto.orthogonal,
      zoomStep = 1,
      rotation = Vec3DoubleProto(0, 0, 0),
      clippingDistance = 50,
      clipSkeletonToCurrentSection = false
    ),
    createdAtVersion = 0L,
    thumbnailVersion = 0L
  )

  // Replaces the encoded references to the NML layers with the tracingIds used in the test.
  private def decodeLayerReferences(bookmark: AnnotationBookmarkProto): AnnotationBookmarkProto = {
    def decode(name: String): Option[String] = NmlAnnotationLayerRef.decode(name) match {
      case Some(NmlVolumeLayerRef(`volumeLayerName`)) => Some(volumeTracingId)
      case Some(NmlSkeletonLayerRef)                  => Some(skeletonTracingId)
      case Some(_)                                    => None
      case None                                       => Some(name)
    }
    NmlBookmarks.rewriteLayerReferences(bookmark, decode, decode)
  }

  private def writeAndParseBookmarks(
      bookmarks: Seq[NmlBookmarkToWrite],
      datasetLayerNames: Option[Set[String]] = None
  ): Fox[NmlParseSuccessWithoutFile] =
    for {
      xmlBytes <- writeToXmlBytes(dummyTracing, bookmarks, datasetLayerNames)
      parsed <- parseXmlBytes(xmlBytes)
    } yield parsed

  "NML writing and parsing of bookmarks" should {
    "yield the same bookmarks, with references to the NML layers instead of tracingIds" in
      writeAndParseBookmarks(
        Seq(
          NmlBookmarkToWrite(fullBookmark, Map(BookmarkThumbnailSize.small -> Array[Byte](1))),
          NmlBookmarkToWrite(minimalBookmark, Map.empty)
        )
      ).futureBox.map {
        case Full(parsed) =>
          assert(parsed.bookmarks.map(b => decodeLayerReferences(b.bookmark)) == Seq(fullBookmark, minimalBookmark))
          assert(
            NmlAnnotationLayerRef
              .decode(parsed.bookmarks.head.bookmark.state.layers(1).layerName)
              .contains(NmlVolumeLayerRef(volumeLayerName))
          )
          assert(
            parsed.bookmarks.map(_.thumbnailLocations) == Seq(
              Map(BookmarkThumbnailSize.small -> NmlBookmarks.thumbnailLocation(3, BookmarkThumbnailSize.small)),
              Map.empty
            )
          )
        case _ => fail()
      }

    "not write the versions of bookmarks" in
      writeAndParseBookmarks(
        Seq(NmlBookmarkToWrite(minimalBookmark.withCreatedAtVersion(12).withThumbnailVersion(13), Map.empty))
      ).futureBox.map {
        case Full(parsed) => assert(parsed.bookmarks.map(_.bookmark) == Seq(minimalBookmark))
        case _            => fail()
      }

    "drop references to layers that do not exist" in {
      val bookmark = minimalBookmark.withState(
        minimalBookmark.state.copy(
          nativelyRenderedLayerName = Some("deletedVolumeTracingId"),
          layers = Seq(
            BookmarkLayerStateProto(layerName = "color"),
            BookmarkLayerStateProto(layerName = "deletedVolumeTracingId"),
            BookmarkLayerStateProto(layerName = volumeTracingId)
          )
        )
      )
      writeAndParseBookmarks(Seq(NmlBookmarkToWrite(bookmark, Map.empty)), Some(Set("color"))).futureBox.map {
        case Full(parsed) =>
          val parsedState = decodeLayerReferences(parsed.bookmarks.head.bookmark).state
          assert(parsedState.nativelyRenderedLayerName.isEmpty)
          assert(parsedState.layers.map(_.layerName) == Seq("color", volumeTracingId))
        case _ => fail()
      }
    }

    "not write the thumbnail viewport of bookmarks without thumbnails" in
      writeAndParseBookmarks(
        Seq(NmlBookmarkToWrite(minimalBookmark.withThumbnailViewport(ThumbnailViewportProto.XY), Map.empty))
      ).futureBox.map {
        case Full(parsed) => assert(parsed.bookmarks.map(_.bookmark) == Seq(minimalBookmark))
        case _            => fail()
      }

    "fail for thumbnails with different viewports" in
      writeToXmlBytes(
        dummyTracing,
        Seq(
          NmlBookmarkToWrite(
            minimalBookmark.withThumbnailViewport(ThumbnailViewportProto.XY),
            Map(BookmarkThumbnailSize.small -> Array[Byte](1), BookmarkThumbnailSize.large -> Array[Byte](1))
          )
        )
      ).futureBox.flatMap {
        case Full(xmlBytes) =>
          val xml = new String(xmlBytes, "UTF-8")
          val xmlWithDifferentViewports = xml.replaceFirst("viewport=\"xy\"", "viewport=\"yz\"")
          assert(xmlWithDifferentViewports != xml)
          assertParsingFailed(parseXmlBytes(xmlWithDifferentViewports.getBytes("UTF-8")))
        case _ => Future.successful(fail("failed to write bookmark to XML"))
      }

    "fail for duplicate bookmark ids" in
      assertParsingFailed(
        writeAndParseBookmarks(
          Seq(NmlBookmarkToWrite(minimalBookmark, Map.empty), NmlBookmarkToWrite(minimalBookmark, Map.empty))
        )
      )

    "fail for a bookmark without position" in
      writeToXmlBytes(dummyTracing, Seq(NmlBookmarkToWrite(minimalBookmark, Map.empty))).futureBox.flatMap {
        case Full(xmlBytes) =>
          val xml = new String(xmlBytes, "UTF-8")
          val xmlWithoutPosition = xml.replaceFirst("""<position [^>]*/>""", "")
          assert(xmlWithoutPosition != xml)
          assertParsingFailed(parseXmlBytes(xmlWithoutPosition.getBytes("UTF-8")))
        case _ => Future.successful(fail("failed to write bookmark to XML"))
      }
  }
}
