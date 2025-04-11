package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext

import java.io.{File, FileInputStream, InputStream}
import java.nio.file.{Files, Path, StandardCopyOption}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, TreeGroup}
import com.scalableminds.webknossos.datastore.VolumeTracing.{SegmentGroup, VolumeTracing}
import com.typesafe.scalalogging.LazyLogging
import files.TempFileService

import javax.inject.Inject
import models.annotation.nml.NmlResults._
import models.annotation.nml.{NmlParseSuccessWithoutFile, NmlParser, NmlResults}
import net.liftweb.common.{Empty, Failure, Full}
import net.liftweb.common.Box.tryo
import play.api.i18n.MessagesProvider

import scala.concurrent.{ExecutionContext, Future}

case class UploadedVolumeLayer(tracing: VolumeTracing, dataZipLocation: String, name: Option[String]) {
  def getDataZipFrom(otherFiles: Map[String, File]): Option[File] =
    otherFiles.get(dataZipLocation)
}

case class SharedParsingParameters(useZipName: Boolean,
                                   overwritingDatasetId: Option[String] = None,
                                   userOrganizationId: String,
                                   isTaskUpload: Boolean = false)

class AnnotationUploadService @Inject()(tempFileService: TempFileService, nmlParser: NmlParser)
    extends LazyLogging
    with FoxImplicits
    with Formatter {

  private def extractFromNmlFile(file: File, name: String, sharedParsingParameters: SharedParsingParameters)(
      implicit m: MessagesProvider,
      ec: ExecutionContext,
      ctx: DBAccessContext): Future[NmlParseResult] =
    extractFromNml(new FileInputStream(file), name, sharedParsingParameters)

  private def extractFromNml(inputStream: InputStream,
                             name: String,
                             sharedParsingParameters: SharedParsingParameters,
                             basePath: Option[String] = None)(implicit m: MessagesProvider,
                                                              ec: ExecutionContext,
                                                              ctx: DBAccessContext): Future[NmlParseResult] = {
    val parserOutput =
      nmlParser.parse(
        name,
        inputStream,
        sharedParsingParameters,
        basePath
      )
    parserOutput.futureBox.map {
      case Full(NmlParseSuccessWithoutFile(skeletonTracing, uploadedVolumeLayers, datasetId, description, wkUrl)) =>
        NmlParseSuccess(name, skeletonTracing, uploadedVolumeLayers, datasetId, description, wkUrl)
      case f: Failure => NmlParseFailure(name, formatFailureChain(f, messagesProviderOpt = Some(m)))
      case Empty      => NmlParseEmpty(name)
    }
  }

  private def extractFromZip(file: File, zipFileName: Option[String], sharedParsingParameters: SharedParsingParameters,
  )(implicit m: MessagesProvider, ec: ExecutionContext, ctx: DBAccessContext): Fox[MultiNmlParseResult] = {
    val name = zipFileName getOrElse file.getName
    var otherFiles = Map.empty[String, File]
    var pendingResults = List.empty[Fox[NmlParseResult]]

    ZipIO.withUnziped(file) { (filename, inputStream) =>
      if (filename.toString.endsWith(".nml")) {
        val parsedResult = for {
          result <- extractFromNml(inputStream, filename.toString, sharedParsingParameters, Some(file.getPath))
        } yield if (sharedParsingParameters.useZipName) result.withName(name) else result
        pendingResults ::= parsedResult
      } else {
        val tempFile: Path = tempFileService.create(file.getPath.replaceAll("/", "_") + filename.toString)
        Files.copy(inputStream, tempFile, StandardCopyOption.REPLACE_EXISTING)
        otherFiles += (file.getPath + filename.toString -> tempFile.toFile)
      }
    }
    Fox.combined(pendingResults).map(parsedResults => MultiNmlParseResult(parsedResults, otherFiles))
  }

  def wrapOrPrefixGroups(parseResults: List[NmlParseResult],
                         shouldCreateGroupForEachFile: Boolean): List[NmlParseResult] =
    if (shouldCreateGroupForEachFile)
      wrapInGroups(parseResults)
    else
      addPrefixesToGroupItemNames(parseResults)

  private def addPrefixesToGroupItemNames(parseResults: List[NmlParseResult]): List[NmlParseResult] = {
    def renameTrees(name: String, tracing: SkeletonTracing): SkeletonTracing = {
      val prefix = name.replaceAll("\\.[^.]*$", "") + "_"
      tracing.copy(trees = tracing.trees.map(tree => tree.copy(name = prefix + tree.name)))
    }

    // Segments are not renamed in this case. Segment ids are adjusted in the separate merge step.

    if (parseResults.length > 1) {
      parseResults.map {
        case NmlParseSuccess(name, skeletonTracing, uploadedVolumeLayers, datasetId, description, wkUrl) =>
          NmlParseSuccess(name, renameTrees(name, skeletonTracing), uploadedVolumeLayers, datasetId, description, wkUrl)
        case r => r
      }
    } else {
      parseResults
    }
  }

  private def wrapInGroups(parseResults: List[NmlParseResult]): List[NmlParseResult] = {
    def getMaximumTreeGroupId(treeGroups: Seq[TreeGroup]): Int =
      if (treeGroups.isEmpty) 0
      else Math.max(treeGroups.map(_.groupId).max, getMaximumTreeGroupId(treeGroups.flatMap(_.children)))

    def getMaximumSegmentGroupId(segmentGroups: Seq[SegmentGroup]): Int =
      if (segmentGroups.isEmpty) 0
      else Math.max(segmentGroups.map(_.groupId).max, getMaximumSegmentGroupId(segmentGroups.flatMap(_.children)))

    def wrapTreesInGroup(name: String, tracing: SkeletonTracing): SkeletonTracing = {
      val unusedGroupId = getMaximumTreeGroupId(tracing.treeGroups) + 1
      val newTrees = tracing.trees.map(tree => tree.copy(groupId = Some(tree.groupId.getOrElse(unusedGroupId))))
      val newTreeGroups = Seq(TreeGroup(name, unusedGroupId, tracing.treeGroups, isExpanded = Some(true)))
      tracing.copy(trees = newTrees, treeGroups = newTreeGroups)
    }

    def wrapSegmentsInGroup(name: String, tracing: VolumeTracing): VolumeTracing = {
      val unusedGroupId = getMaximumSegmentGroupId(tracing.segmentGroups) + 1
      val newSegments =
        tracing.segments.map(segment => segment.copy(groupId = Some(segment.groupId.getOrElse(unusedGroupId))))
      val newSegmentGroups = Seq(SegmentGroup(name, unusedGroupId, tracing.segmentGroups))
      tracing.copy(segments = newSegments, segmentGroups = newSegmentGroups)
    }

    def wrapVolumeLayers(name: String, volumeLayers: List[UploadedVolumeLayer]): List[UploadedVolumeLayer] =
      volumeLayers.map(v => v.copy(tracing = wrapSegmentsInGroup(name, v.tracing)))

    parseResults.map {
      case NmlParseSuccess(name, skeletonTracing, uploadedVolumeLayers, datasetId, description, wkUrl) =>
        NmlParseSuccess(name,
                        wrapTreesInGroup(name, skeletonTracing),
                        wrapVolumeLayers(name, uploadedVolumeLayers),
                        datasetId,
                        description,
                        wkUrl)
      case r => r
    }
  }

  def extractFromFiles(files: Seq[(File, String)], sharedParams: SharedParsingParameters)(
      implicit m: MessagesProvider,
      ec: ExecutionContext,
      ctx: DBAccessContext): Fox[MultiNmlParseResult] =
    Fox.foldLeft(files.iterator, NmlResults.MultiNmlParseResult()) {
      case (collectedResults, (file, name)) =>
        if (name.endsWith(".zip")) {
          tryo(new java.util.zip.ZipFile(file)).map(ZipIO.forallZipEntries(_)(_.getName.endsWith(".zip"))) match {
            case Full(allZips) =>
              if (allZips) {
                for {
                  parsedZipResult <- extractFromZip(file, Some(name), sharedParams)
                  otherFiles = parsedZipResult.otherFiles.toSeq.map(tuple => (tuple._2, tuple._1))
                  parsedFileResults <- extractFromFiles(otherFiles, sharedParams)
                } yield collectedResults.combineWith(parsedFileResults)
              } else {
                for {
                  parsedFile <- extractFromFile(file, name, sharedParams)
                } yield collectedResults.combineWith(parsedFile)
              }
            case _ => Fox.successful(collectedResults)
          }
        } else {
          for {
            parsedFromFile <- extractFromFile(file, name, sharedParams)
          } yield collectedResults.combineWith(parsedFromFile)

        }
    }

  private def extractFromFile(file: File, fileName: String, sharedParsingParameters: SharedParsingParameters)(
      implicit m: MessagesProvider,
      ec: ExecutionContext,
      ctx: DBAccessContext): Fox[MultiNmlParseResult] =
    if (fileName.endsWith(".zip")) {
      logger.trace("Extracting from Zip file")
      extractFromZip(file, Some(fileName), sharedParsingParameters)
    } else {
      logger.trace("Extracting from Nml file")
      for {
        parseResult <- Fox.future2Fox(extractFromNmlFile(file, fileName, sharedParsingParameters))
      } yield MultiNmlParseResult(List(parseResult), Map.empty)
    }

}
