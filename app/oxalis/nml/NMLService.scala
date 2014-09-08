package oxalis.nml

import models.tracing.skeleton.SkeletonTracingLike
import play.api.libs.Files
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
object NMLService {

  def toNML[T <: SkeletonTracingLike](t: T) = {
    val prettyPrinter = new PrettyPrinter(100, 2)
    Xml.toXML(t).map(prettyPrinter.format(_))
  }

  def extractFromNML(file: File) =
    NMLParser.parse(file)

  def extractFromZip(file: File) =
    ZipIO.unzip(file).map(nml => NMLParser.parse(nml))

  def extractFromFile(file: File, fileName: String) = {
    if (fileName.endsWith(".zip")) {
      Logger.trace("Extracting from ZIP file")
      extractFromZip(file)
    } else {
      Logger.trace("Extracting from NML file")
      List(extractFromNML(file))
    }
  }

  def extractFromFiles(files: Seq[play.api.mvc.MultipartFormData.FilePart[Files.TemporaryFile]])= {

    val m = files map { file =>
      val nmls = extractFromFile(file.ref.file, file.filename)
      nmls.map(f => (file.filename -> f))
    }
    val a = m.flatten
    a
  }
}
