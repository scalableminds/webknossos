package models.annotation.nml

import java.io.{File, FileInputStream, InputStream}
import java.nio.file.{Files, StandardCopyOption}

import com.scalableminds.util.io.ZipIO
import com.scalableminds.webknossos.tracingstore.SkeletonTracing.{SkeletonTracing, TreeGroup}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.annotation.nml.NmlResults._
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import play.api.i18n.MessagesProvider
import play.api.libs.Files.{TemporaryFile, TemporaryFileCreator}

import scala.concurrent.ExecutionContext

class NmlService @Inject()(temporaryFileCreator: TemporaryFileCreator)(implicit ec: ExecutionContext)
    extends LazyLogging {

  def extractFromNml(file: File, name: String, overwritingDataSetName: Option[String], isTaskUpload: Boolean)(
      implicit m: MessagesProvider): NmlParseResult =
    extractFromNml(new FileInputStream(file), name, overwritingDataSetName, isTaskUpload)

  private def formatChain(chain: Box[Failure]): String = chain match {
    case Full(failure) =>
      " <~ " + failure.msg + formatChain(failure.chain)
    case _ => ""
  }

  def extractFromNml(inputStream: InputStream,
                     name: String,
                     overwritingDataSetName: Option[String],
                     isTaskUpload: Boolean,
                     basePath: Option[String] = None)(implicit m: MessagesProvider): NmlParseResult =
    NmlParser.parse(name, inputStream, overwritingDataSetName, isTaskUpload, basePath) match {
      case Full((skeletonTracing, volumeTracingWithDataLocation, description, organizationNameOpt)) =>
        NmlParseSuccess(name, skeletonTracing, volumeTracingWithDataLocation, description, organizationNameOpt)
      case Failure(msg, _, chain) => NmlParseFailure(name, msg + chain.map(_ => formatChain(chain)).getOrElse(""))
      case Empty                  => NmlParseEmpty(name)
    }

  def extractFromZip(file: File,
                     zipFileName: Option[String] = None,
                     useZipName: Boolean,
                     overwritingDataSetName: Option[String],
                     isTaskUpload: Boolean)(implicit m: MessagesProvider): ZipParseResult = {
    val name = zipFileName getOrElse file.getName
    var otherFiles = Map.empty[String, TemporaryFile]
    var parseResults = List.empty[NmlParseResult]

    ZipIO.withUnziped(file) { (filename, inputStream) =>
      if (filename.toString.endsWith(".nml")) {
        val result =
          extractFromNml(inputStream, filename.toString, overwritingDataSetName, isTaskUpload, Some(file.getPath))
        parseResults ::= (if (useZipName) result.withName(name) else result)
      } else {
        val tempFile = temporaryFileCreator.create(filename.toString)
        Files.copy(inputStream, tempFile.path, StandardCopyOption.REPLACE_EXISTING)
        otherFiles += (file.getPath + filename.toString -> tempFile)
      }
    }
    ZipParseResult(parseResults, otherFiles)
  }

  def wrapOrPrefixTrees(parseResults: List[NmlParseResult],
                        shouldCreateGroupForEachFile: Boolean): List[NmlParseResult] =
    if (shouldCreateGroupForEachFile)
      wrapTreesInGroups(parseResults)
    else
      addPrefixesToTreeNames(parseResults)

  private def addPrefixesToTreeNames(parseResults: List[NmlParseResult]): List[NmlParseResult] = {
    def renameTrees(name: String, tracing: SkeletonTracing): SkeletonTracing = {
      val prefix = name.replaceAll("\\.[^.]*$", "") + "_"
      tracing.copy(trees = tracing.trees.map(tree => tree.copy(name = prefix + tree.name)))
    }

    if (parseResults.length > 1) {
      parseResults.map {
        case NmlParseSuccess(name, Some(skeletonTracing), volumeTracingOpt, description, organizationNameOpt) =>
          NmlParseSuccess(name,
                          Some(renameTrees(name, skeletonTracing)),
                          volumeTracingOpt,
                          description,
                          organizationNameOpt)
        case r => r
      }
    } else {
      parseResults
    }
  }

  private def wrapTreesInGroups(parseResults: List[NmlParseResult]): List[NmlParseResult] = {
    def getMaximumGroupId(treeGroups: Seq[TreeGroup]) = if (treeGroups.isEmpty) 0 else treeGroups.map(_.groupId).max

    def wrapTreesInGroup(name: String, tracing: SkeletonTracing): SkeletonTracing = {
      val unusedGroupId = getMaximumGroupId(tracing.treeGroups) + 1
      val newTrees = tracing.trees.map(tree => tree.copy(groupId = Some(tree.groupId.getOrElse(unusedGroupId))))
      val newTreeGroups = Seq(TreeGroup(name, unusedGroupId, tracing.treeGroups))
      tracing.copy(trees = newTrees, treeGroups = newTreeGroups)
    }

    parseResults.map {
      case NmlParseSuccess(name, Some(skeletonTracing), volumeTracingOpt, description, organizationNameOpt) =>
        NmlParseSuccess(name,
                        Some(wrapTreesInGroup(name, skeletonTracing)),
                        volumeTracingOpt,
                        description,
                        organizationNameOpt)
      case r => r
    }
  }

  def extractFromFiles(files: Seq[(File, String)],
                       useZipName: Boolean,
                       overwritingDataSetName: Option[String] = None,
                       isTaskUpload: Boolean = false)(implicit m: MessagesProvider): ZipParseResult =
    files.foldLeft(NmlResults.ZipParseResult()) {
      case (acc, (file, name)) =>
        if (name.endsWith(".zip"))
          tryo(new java.util.zip.ZipFile(file)).map(ZipIO.forallZipEntries(_)(_.getName.endsWith(".zip"))) match {
            case Full(allZips) =>
              if (allZips)
                acc.combineWith(
                  extractFromFiles(
                    extractFromZip(file, Some(name), useZipName, overwritingDataSetName, isTaskUpload).otherFiles.toSeq
                      .map(tuple => (tuple._2.path.toFile, tuple._1)),
                    useZipName,
                    overwritingDataSetName,
                    isTaskUpload
                  ))
              else acc.combineWith(extractFromFile(file, name, useZipName, overwritingDataSetName, isTaskUpload))
            case _ => acc
          } else acc.combineWith(extractFromFile(file, name, useZipName, overwritingDataSetName, isTaskUpload))
    }

  def extractFromFile(file: File,
                      fileName: String,
                      useZipName: Boolean,
                      overwritingDataSetName: Option[String],
                      isTaskUpload: Boolean)(implicit m: MessagesProvider): ZipParseResult =
    if (fileName.endsWith(".zip")) {
      logger.trace("Extracting from Zip file")
      extractFromZip(file, Some(fileName), useZipName, overwritingDataSetName, isTaskUpload)
    } else {
      logger.trace("Extracting from Nml file")
      val parseResult = extractFromNml(file, fileName, overwritingDataSetName, isTaskUpload)
      ZipParseResult(List(parseResult), Map.empty)
    }

}
