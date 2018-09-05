package models.annotation.nml

import java.io.{File, FileInputStream, InputStream}
import java.nio.file.{Files, StandardCopyOption}

import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, TreeGroup}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.Files.TemporaryFile

import scala.concurrent.ExecutionContext.Implicits.global


object NmlService extends LazyLogging {

  sealed trait NmlParseResult {
    def fileName: String

    def bothTracingOpts: Option[(Option[SkeletonTracing], Option[(VolumeTracing, String)])] = None
    def description: Option[String] = None

    def succeeded: Boolean

    def toSkeletonSuccessFox: Fox[NmlParseSuccess] = this match {
      case NmlParseFailure(fileName, error) =>
        Fox.failure(s"Couldn’t parse file: $fileName. $error")
      case NmlParseSuccess(fileName, Some(skeletonTracing), _, description) =>
        Fox.successful(NmlParseSuccess(fileName, Some(skeletonTracing), None, description))
      case _ =>
        Fox.failure("Couldn’t parse file")
    }
  }

  case class NmlParseSuccess(fileName: String, skeletonTracing: Option[SkeletonTracing], volumeTracingWithDataLocation: Option[(VolumeTracing, String)], _description: String) extends NmlParseResult {
    def succeeded = true

    override def bothTracingOpts = Some((skeletonTracing, volumeTracingWithDataLocation))
    override def description = Some(_description)
  }

  case class NmlParseFailure(fileName: String, error: String) extends NmlParseResult {
    def succeeded = false
  }

  case class NmlParseEmpty(fileName: String) extends NmlParseResult {
    def succeeded = false
  }

  case class ZipParseResult(parseResults: List[NmlParseResult] = Nil, otherFiles: Map[String, TemporaryFile] = Map.empty) {
    def combineWith(other: ZipParseResult) = {
      ZipParseResult(parseResults ::: other.parseResults, other.otherFiles ++ otherFiles)
    }

    def isEmpty = {
      !parseResults.exists(_.succeeded)
    }

    def containsFailure = {
      parseResults.exists {
        case _: NmlParseFailure => true
        case _ => false
      }
    }
  }

  def extractFromNml(file: File, name: String): NmlParseResult = {
    extractFromNml(new FileInputStream(file), name)
  }

  def extractFromNml(inputStream: InputStream, name: String): NmlParseResult = {
    NmlParser.parse(name, inputStream) match {
      case Full((skeletonTracing, volumeTracingWithDataLocation, description)) => NmlParseSuccess(name, skeletonTracing, volumeTracingWithDataLocation, description)
      case Failure(msg, _, _) => NmlParseFailure(name, msg)
      case Empty => NmlParseEmpty(name)
    }
  }

  def extractFromZip(file: File, zipFileName: Option[String] = None): ZipParseResult = {
    val name = zipFileName getOrElse file.getName
    var otherFiles = Map.empty[String, TemporaryFile]
    var parseResults = List.empty[NmlParseResult]
    ZipIO.withUnziped(file, includeHiddenFiles = false) { (filename, file) =>
      if (filename.toString.endsWith(".nml")) {
        val result = extractFromNml(file, filename.toString)
        parseResults ::= result
      } else {
        val tempFile = TemporaryFile(filename.toString)
        Files.copy(file, tempFile.file.toPath, StandardCopyOption.REPLACE_EXISTING)
        otherFiles += (filename.toString -> tempFile)
      }
    }
    ZipParseResult(parseResults, otherFiles)
  }

  def addPrefixesToTreeNames(parseResults: List[NmlParseResult]): List[NmlParseResult] = {
    def renameTrees(name: String, tracing: SkeletonTracing): SkeletonTracing = {
      val prefix = name.replaceAll("\\.[^.]*$", "") + "_"
      tracing.copy(trees = tracing.trees.map(tree => tree.copy(name = prefix + tree.name)))
    }

    if (parseResults.length > 1) {
      parseResults.map(r =>
        r match {
          case NmlParseSuccess(name, Some(skeletonTracing), volumeTracingOpt, description) =>
            NmlParseSuccess(name, Some(renameTrees(name, skeletonTracing)), volumeTracingOpt, description)
          case _ => r
        }
      )
    } else {
      parseResults
    }
  }

  def wrapTreesInGroups(parseResults: List[NmlParseResult]): List[NmlParseResult] = {
    def getMaximumGroupId(treeGroups: Seq[TreeGroup]) = if (treeGroups.isEmpty) 0 else treeGroups.map(_.groupId).max

    def wrapTreesInGroup(name: String, tracing: SkeletonTracing): SkeletonTracing = {
      val unusedGroupId = getMaximumGroupId(tracing.treeGroups) + 1
      val newTrees = tracing.trees.map(tree => tree.copy(groupId = Some(tree.groupId.getOrElse(unusedGroupId))))
      val newTreeGroups = Seq(TreeGroup(name, unusedGroupId, tracing.treeGroups))
      tracing.copy(trees = newTrees, treeGroups = newTreeGroups)
    }

    if (parseResults.length > 1) {
      parseResults.map(r =>
        r match {
          case NmlParseSuccess(name, Some(skeletonTracing), volumeTracingOpt, description) =>
            NmlParseSuccess(name, Some(wrapTreesInGroup(name, skeletonTracing)), volumeTracingOpt, description)
          case _ => r
        }
      )
    } else {
      parseResults
    }
  }

  def extractFromFile(file: File, fileName: String): ZipParseResult = {
    if (fileName.endsWith(".zip")) {
      logger.trace("Extracting from Zip file")
      extractFromZip(file, Some(fileName))
    } else {
      logger.trace("Extracting from Nml file")
      val parseResult = extractFromNml(file, fileName)
      ZipParseResult(List(parseResult), Map.empty)
    }
  }

  def splitVolumeAndSkeletonTracings(tracings: List[(Option[SkeletonTracing], Option[(VolumeTracing, String)])]): (List[SkeletonTracing], List[(VolumeTracing, String)]) = {
    val skeletons = tracings.flatMap(_._1)
    val volumes = tracings.flatMap(_._2)
    (skeletons, volumes)
  }
}
