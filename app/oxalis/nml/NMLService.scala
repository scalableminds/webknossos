package oxalis.nml

import models.tracing.skeleton.SkeletonTracingLike
import scala.xml.PrettyPrinter
import braingames.xml.Xml
import models.annotation.Annotation
import org.apache.commons.io.IOUtils
import java.io.File
import play.api.{Logger, Play}
import braingames.util.ZipIO
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 26.07.13
 * Time: 12:04
 */
object NMLService {

  def toNML[T <: SkeletonTracingLike](t: T) = {
    val prettyPrinter = new PrettyPrinter(100, 2)
    Xml.toXML(t).map(prettyPrinter.format(_))
  }

  def extractFromNML(file: File) =
    new NMLParser(file).parse

  def extractFromZip(file: File): List[NML] =
    ZipIO.unzip(file).map(nml => (new NMLParser(nml)).parse).flatten

  def extractFromFile(file: File, fileName: String): List[NML] = {
    if (fileName.endsWith(".zip")) {
      Logger.trace("Extracting from ZIP file")
      extractFromZip(file)
    } else {
      Logger.trace("Extracting from NML file")
      List(extractFromNML(file)).flatten
    }
  }
}
