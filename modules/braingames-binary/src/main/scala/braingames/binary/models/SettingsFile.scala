package braingames.binary.models

import java.io.File
import play.api.libs.json.{Writes, Reads}
import braingames.util.JsonHelper._
import braingames.util.FileIO

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 17:44
 */
trait SettingsFile {
  def extractSettingsFromFile[T](file: File, settingsReads: Reads[T]): Option[T] = {
    if (file.isFile) {
      JsonFromFile(file)
        .validate(settingsReads)
        .asOpt
    } else None
  }

  def writeSettingsToFile[T](settings: T, file: File)(implicit writer: Writes[T]) = {
    FileIO.printToFile(file) {
      printer =>
        printer.print(writer.writes(settings).toString)
    }
  }
}
