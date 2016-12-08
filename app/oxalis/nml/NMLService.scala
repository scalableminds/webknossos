package oxalis.nml

import java.io.{File, OutputStream}
import java.nio.file.{Files, StandardCopyOption}
import javax.xml.stream.XMLOutputFactory

import scala.concurrent.Future
import scala.xml.PrettyPrinter

import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.xml.{XMLWrites, Xml}
import com.sun.xml.txw2.output.IndentingXMLStreamWriter
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Failure, Full}
import play.api.Logger
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._

/**
  * Company: scalableminds
  * User: tmbo
  * Date: 26.07.13
  * Time: 12:04
  */
object NMLService extends NMLParsingService with FoxImplicits with LazyLogging{
  private lazy val outputService = XMLOutputFactory.newInstance()

  def toNML[T](t: T, outputStream: OutputStream)(implicit w: XMLWrites[T]): Fox[Boolean] = {
    val writer = new IndentingXMLStreamWriter(outputService.createXMLStreamWriter(outputStream))
    Xml.toXML(t)(writer, w).futureBox.map{ result =>
      // Make sure all tags are properly closed
      writer.writeEndDocument()
      result
    }
  }
}

trait NMLParsingService {

  sealed trait NMLParseResult {
    def fileName: String

    def nml: Option[NML] = None

    def succeeded: Boolean
  }

  case class NMLParseSuccess(fileName: String, _nml: NML) extends NMLParseResult {
    def succeeded = true

    override def nml = Some(_nml)
  }

  case class NMLParseFailure(fileName: String, error: String) extends NMLParseResult {
    def succeeded = false
  }

  case class ZipParseResult(nmls: List[NMLParseResult] = Nil, otherFiles: Map[String, TemporaryFile] = Map.empty) {
    def combineWith(other: ZipParseResult) = {
      ZipParseResult(nmls ::: other.nmls, other.otherFiles ++ otherFiles)
    }
  }

  def extractFromNML(file: File, fileName: Option[String] = None): NMLParseResult = {
    val name = fileName getOrElse file.getName
    NMLParser.parse(file, name) match {
      case Full(nml)          => NMLParseSuccess(name, nml)
      case Failure(msg, _, _) => NMLParseFailure(name, msg)
      case Empty              => NMLParseFailure(name, "Failed to extract nml from file")
    }
  }

  def extractFromZip(file: File, zipFileName: Option[String] = None): ZipParseResult = {
    val name = zipFileName getOrElse file.getName
    var otherFiles = Map.empty[String, TemporaryFile]
    var parseResults = List.empty[NMLParseResult]
    ZipIO.withUnziped(file, includeHiddenFiles = false) { (filename, file) =>
      if (filename.endsWith(".nml")) {
        val result = NMLParser.parse(file, filename) match {
          case Full(nml)          =>
            NMLParseSuccess(name, nml)
          case Failure(msg, _, _) =>
            NMLParseFailure(name, msg)
          case Empty              =>
            NMLParseFailure(name, "Failed to extract nml from file")
        }
        parseResults ::= result
      } else {
        val tempFile = TemporaryFile(filename)
        Files.copy(file, tempFile.file.toPath, StandardCopyOption.REPLACE_EXISTING)
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
