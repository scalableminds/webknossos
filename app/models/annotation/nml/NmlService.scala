package models.annotation.nml

import java.io.{File, FileInputStream, InputStream}
import java.nio.file.{Files, StandardCopyOption}

import com.scalableminds.braingames.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.braingames.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.util.io.ZipIO
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Failure, Full}
import play.api.libs.Files.TemporaryFile


object NmlService extends LazyLogging {

  sealed trait NmlParseResult {
    def fileName: String

    def tracing: Option[(Either[SkeletonTracing, (VolumeTracing, String)], String)] = None

    def succeeded: Boolean
  }

  case class NmlParseSuccess(fileName: String, _tracing: (Either[SkeletonTracing, (VolumeTracing, String)], String)) extends NmlParseResult {
    def succeeded = true

    override def tracing = Some(_tracing)
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
      case Full(tracing) => NmlParseSuccess(name, tracing)
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
    ZipParseResult(addPrefixesToTreeNames(parseResults), otherFiles)
  }

  private def addPrefixesToTreeNames(parseResults: List[NmlParseResult]): List[NmlParseResult] = {
    def renameTrees(name: String, tracing: SkeletonTracing): SkeletonTracing = {
      val prefix = name.replaceAll("\\.[^.]*$", "") + "_"
      tracing.copy(trees = tracing.trees.map(tree => tree.copy(name = prefix + tree.name)))
    }

    if (parseResults.length > 1) {
      parseResults.map(r =>
        r match {
          case NmlParseSuccess(name, (Left(skeletonTracing), description)) => NmlParseSuccess(name, (Left(renameTrees(name, skeletonTracing)), description))
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

  def splitVolumeAndSkeletonTracings(tracings: List[(Either[SkeletonTracing, (VolumeTracing, String)], String)]): (List[(SkeletonTracing, String)], List[(VolumeTracing, String, String)]) = {
    val (skeletons, volumes) = tracings.partition(_._1.isLeft)
    (skeletons.map(s => (s._1.left.get, s._2)), volumes.map(v => (v._1.right.get._1, v._1.right.get._2, v._2)))
  }
}
