package oxalis.nml

import models.tracing.skeleton.SkeletonTracingLike
import net.liftweb.common.{Empty, Failure, Full, Box}
import play.api.libs.Files
import play.api.mvc.MultipartFormData.FilePart
import scala.xml.PrettyPrinter
import com.scalableminds.util.xml.Xml
import models.annotation.Annotation
import org.apache.commons.io.IOUtils
import java.io.File
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

  def toNML[T <: SkeletonTracingLike](t: T) = {
    val prettyPrinter = new PrettyPrinter(100, 2)
    Xml.toXML(t).map(prettyPrinter.format(_))
  }
}

trait NMLParsingService {
  sealed trait NMLParseResult{
    def fileName: String

    def nml: Option[NML] = None
  }
  case class NMLParseSuccess(fileName: String, _nml: NML) extends NMLParseResult{
    override def nml = Some(_nml)
  }
  case class NMLParseFailure(fileName: String, error: String) extends NMLParseResult

  def extractFromNML(file: File, fileName: Option[String] = None): NMLParseResult = {
    val name = fileName getOrElse file.getName
    NMLParser.parse(file) match {
      case Full(nml) => NMLParseSuccess(name, nml)
      case Failure(msg, _, _) => NMLParseFailure(name, msg)
      case Empty => NMLParseFailure(name, "Failed to extract nml from file")
    }
  }

  def extractFromZip(file: File, fileName: Option[String] = None): List[NMLParseResult] = {
    val name = fileName getOrElse file.getName
    ZipIO.unzipWithFilenames(file).map{
      case (filename, nmlFile) =>
        val prefix = filename.replaceAll("\\.[^.]*$", "") + "_"
        NMLParser.parse(nmlFile) match {
          case Full(nml) =>
            NMLParseSuccess(name, nml.copy(trees = nml.trees.map(_.addNamePrefix(prefix))))
          case Failure(msg, _, _) =>
            NMLParseFailure(name, msg)
          case Empty => NMLParseFailure(name, "Failed to extract nml from file")
        }
    }
  }

  def extractFromFile(file: File, fileName: String): List[NMLParseResult] = {
    if (fileName.endsWith(".zip")) {
      Logger.trace("Extracting from ZIP file")
      extractFromZip(file, Some(fileName))
    } else {
      Logger.trace("Extracting from NML file")
      List(extractFromNML(file, Some(fileName)))
    }
  }

  def extractFromFiles(files: Seq[FilePart[Files.TemporaryFile]]) = files.flatMap { file =>
    extractFromFile(file.ref.file, file.filename)
  }
}
