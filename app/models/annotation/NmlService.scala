package models.annotation

import java.io.{File, FileInputStream, InputStream}
import java.nio.file.{Files, StandardCopyOption}
import java.util.UUID

import com.scalableminds.braingames.datastore.tracings.Tracing
import com.scalableminds.braingames.datastore.tracings.skeleton.NmlParser
import com.scalableminds.util.io.ZipIO
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Failure, Full}
import play.api.libs.Files.TemporaryFile


object NmlService extends LazyLogging {

  sealed trait NmlParseResult {
    def fileName: String

    def tracing: Option[Tracing] = None

    def succeeded: Boolean
  }

  case class NmlParseSuccess(fileName: String, _tracing: Tracing) extends NmlParseResult {
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
      parseResults.exists{
        case _: NmlParseFailure => true
        case _ => false
      }
    }
  }

  def extractFromNml(file: File, name: String): NmlParseResult = {
    extractFromNml(new FileInputStream(file), name)
  }

  def extractFromNml(inputStream: InputStream, name: String): NmlParseResult = {
    NmlParser.parse(UUID.randomUUID.toString, name, inputStream) match {
      case Full(tracing)          => NmlParseSuccess(name, tracing)
      case Failure(msg, _, _) => NmlParseFailure(name, msg)
      case Empty              => NmlParseEmpty(name)
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
}
