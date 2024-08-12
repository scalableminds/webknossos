package models.annotation

import java.io.{File, FileInputStream, InputStream}
import java.nio.file.{Files, Path, StandardCopyOption}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, TreeGroup}
import com.scalableminds.webknossos.datastore.VolumeTracing.{SegmentGroup, VolumeTracing}
import com.typesafe.scalalogging.LazyLogging
import files.TempFileService

import javax.inject.Inject
import models.annotation.nml.NmlResults._
import models.annotation.nml.{NmlParser, NmlResults}
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.common.Box.tryo
import play.api.i18n.MessagesProvider

case class UploadedVolumeLayer(tracing: VolumeTracing, dataZipLocation: String, name: Option[String]) {
  def getDataZipFrom(otherFiles: Map[String, File]): Option[File] =
    otherFiles.get(dataZipLocation)
}

class AnnotationUploadService @Inject()(tempFileService: TempFileService) extends LazyLogging {

  private def extractFromNmlFile(file: File,
                                 name: String,
                                 overwritingDatasetName: Option[String],
                                 overwritingOrganizationId: Option[String],
                                 isTaskUpload: Boolean)(implicit m: MessagesProvider): NmlParseResult =
    extractFromNml(new FileInputStream(file), name, overwritingDatasetName, overwritingOrganizationId, isTaskUpload)

  private def formatChain(chain: Box[Failure]): String = chain match {
    case Full(failure) =>
      " <~ " + failure.msg + formatChain(failure.chain)
    case _ => ""
  }

  private def extractFromNml(inputStream: InputStream,
                             name: String,
                             overwritingDatasetName: Option[String],
                             overwritingOrganizationId: Option[String],
                             isTaskUpload: Boolean,
                             basePath: Option[String] = None)(implicit m: MessagesProvider): NmlParseResult =
    NmlParser.parse(name, inputStream, overwritingDatasetName, overwritingOrganizationId, isTaskUpload, basePath) match {
      case Full((skeletonTracing, uploadedVolumeLayers, description, wkUrl)) =>
        NmlParseSuccess(name, skeletonTracing, uploadedVolumeLayers, description, wkUrl)
      case Failure(msg, _, chain) => NmlParseFailure(name, msg + chain.map(_ => formatChain(chain)).getOrElse(""))
      case Empty                  => NmlParseEmpty(name)
    }

  private def extractFromZip(file: File,
                             zipFileName: Option[String],
                             useZipName: Boolean,
                             overwritingDatasetName: Option[String],
                             overwritingOrganizationId: Option[String],
                             isTaskUpload: Boolean)(implicit m: MessagesProvider): MultiNmlParseResult = {
    val name = zipFileName getOrElse file.getName
    var otherFiles = Map.empty[String, File]
    var parseResults = List.empty[NmlParseResult]

    ZipIO.withUnziped(file) { (filename, inputStream) =>
      if (filename.toString.endsWith(".nml")) {
        val result =
          extractFromNml(inputStream,
                         filename.toString,
                         overwritingDatasetName,
                         overwritingOrganizationId,
                         isTaskUpload,
                         Some(file.getPath))
        parseResults ::= (if (useZipName) result.withName(name) else result)
      } else {
        val tempFile: Path = tempFileService.create(file.getPath.replaceAll("/", "_") + filename.toString)
        Files.copy(inputStream, tempFile, StandardCopyOption.REPLACE_EXISTING)
        otherFiles += (file.getPath + filename.toString -> tempFile.toFile)
      }
    }
    MultiNmlParseResult(parseResults, otherFiles)
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
        case NmlParseSuccess(name, Some(skeletonTracing), uploadedVolumeLayers, description, wkUrl) =>
          NmlParseSuccess(name, Some(renameTrees(name, skeletonTracing)), uploadedVolumeLayers, description, wkUrl)
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
      case NmlParseSuccess(name, Some(skeletonTracing), uploadedVolumeLayers, description, wkUrl) =>
        NmlParseSuccess(name,
                        Some(wrapTreesInGroup(name, skeletonTracing)),
                        wrapVolumeLayers(name, uploadedVolumeLayers),
                        description,
                        wkUrl)
      case r => r
    }
  }

  def extractFromFiles(files: Seq[(File, String)],
                       useZipName: Boolean,
                       overwritingDatasetName: Option[String] = None,
                       overwritingOrganizationId: Option[String] = None,
                       isTaskUpload: Boolean = false)(implicit m: MessagesProvider): MultiNmlParseResult =
    files.foldLeft(NmlResults.MultiNmlParseResult()) {
      case (acc, (file, name)) =>
        if (name.endsWith(".zip"))
          tryo(new java.util.zip.ZipFile(file)).map(ZipIO.forallZipEntries(_)(_.getName.endsWith(".zip"))) match {
            case Full(allZips) =>
              if (allZips)
                acc.combineWith(
                  extractFromFiles(
                    extractFromZip(file,
                                   Some(name),
                                   useZipName,
                                   overwritingDatasetName,
                                   overwritingOrganizationId,
                                   isTaskUpload).otherFiles.toSeq.map(tuple => (tuple._2, tuple._1)),
                    useZipName,
                    overwritingDatasetName,
                    overwritingOrganizationId,
                    isTaskUpload
                  ))
              else
                acc.combineWith(
                  extractFromFile(file,
                                  name,
                                  useZipName,
                                  overwritingDatasetName,
                                  overwritingOrganizationId,
                                  isTaskUpload))
            case _ => acc
          } else
          acc.combineWith(
            extractFromFile(file, name, useZipName, overwritingDatasetName, overwritingOrganizationId, isTaskUpload))
    }

  private def extractFromFile(file: File,
                              fileName: String,
                              useZipName: Boolean,
                              overwritingDatasetName: Option[String],
                              overwritingOrganizationId: Option[String],
                              isTaskUpload: Boolean)(implicit m: MessagesProvider): MultiNmlParseResult =
    if (fileName.endsWith(".zip")) {
      logger.trace("Extracting from Zip file")
      extractFromZip(file, Some(fileName), useZipName, overwritingDatasetName, overwritingOrganizationId, isTaskUpload)
    } else {
      logger.trace("Extracting from Nml file")
      val parseResult =
        extractFromNmlFile(file, fileName, overwritingDatasetName, overwritingOrganizationId, isTaskUpload)
      MultiNmlParseResult(List(parseResult), Map.empty)
    }

}
