package oxalis.nml

import models.tracing.skeleton.SkeletonTracingLike
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.mvc.MultipartFormData.FilePart
import scala.xml.PrettyPrinter

import com.scalableminds.util.xml.{XMLWrites, Xml}
import models.annotation.Annotation
import org.apache.commons.io.IOUtils
import java.io.File
import java.nio.file.{Files, Path, StandardCopyOption}

import play.api.{Logger, Play}
import com.scalableminds.util.io.ZipIO
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.Files.TemporaryFile

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 26.07.13
 * Time: 12:04
 */
object NMLService extends NMLParsingService {

  def toNML[T](t: T)(implicit w: XMLWrites[T]) = {
    val prettyPrinter = new PrettyPrinter(100, 2)
    Xml.toXML(t).map(prettyPrinter.format(_))
  }
}

trait NMLParsingService {
  sealed trait NMLParseResult{
    def fileName: String

    def nml: Option[NML] = None

    def succeeded: Boolean
  }

  case class NMLParseSuccess(fileName: String, _nml: NML) extends NMLParseResult{
    def succeeded = true

    override def nml = Some(_nml)
  }

  case class NMLParseFailure(fileName: String, error: String) extends NMLParseResult{
    def succeeded = false
  }

  case class ZipParseResult(nmls: List[NMLParseResult], otherFiles: Map[String, TemporaryFile])

  def extractFromNML(file: File, fileName: Option[String] = None): NMLParseResult = {
    val name = fileName getOrElse file.getName
    NMLParser.parse(file) match {
      case Full(nml) => NMLParseSuccess(name, nml)
      case Failure(msg, _, _) => NMLParseFailure(name, msg)
      case Empty => NMLParseFailure(name, "Failed to extract nml from file")
    }
  }

  def extractFromZip(file: File, zipFileName: Option[String] = None): ZipParseResult = {
    val name = zipFileName getOrElse file.getName
    var otherFiles = Map.empty[String, TemporaryFile]
    var parseResults = List.empty[NMLParseResult]
    ZipIO.withUnziped(file, includeHiddenFiles = false){ (filename, file) =>
      if(filename.endsWith(".nml")){
        val prefix = filename.replaceAll("\\.[^.]*$", "") + "_"
        val result = NMLParser.parse(file, filename) match {
          case Full(nml) =>
            NMLParseSuccess(name, nml.copy(trees = nml.trees.map(_.addNamePrefix(prefix))))
          case Failure(msg, _, _) =>
            NMLParseFailure(name, msg)
          case Empty => NMLParseFailure(name, "Failed to extract nml from file")
        }
        parseResults ::= result
      } else {
        val tempFile = TemporaryFile(filename)
        Files.copy(file, tempFile.file.toPath)
        otherFiles += (filename -> tempFile)
      }
    }
    ZipParseResult(parseResults, otherFiles)
  }

  def extractFromFile(file: File, fileName: String): ZipParseResult = {
    if (fileName.endsWith(".zip")) {
      Logger.trace("Extracting from ZIP file")
      extractFromZip(file, Some(fileName))
    } else {
      Logger.trace("Extracting from NML file")
      ZipParseResult(List(extractFromNML(file, Some(fileName))), Map.empty)
    }
  }
}
