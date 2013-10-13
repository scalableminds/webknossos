package braingames.binary.models

import java.io.File
import play.api.libs.json._
import braingames.util.JsonHelper._
import braingames.util.FileIO
import net.liftweb.common._
import net.liftweb.common.Box._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 17:44
 */
trait SettingsFile{
  def extractSettingsFromFile[T](file: File, settingsReads: Reads[T]): Box[T] = {
    if (file.isFile) {
      JsonFromFile(file).flatMap{
        _.validate(settingsReads) match{
          case JsSuccess(e ,_) => Full(e)
          case e : JsError => Failure(e.toString)
        }
      }
    } else 
      Empty
  }

  def writeSettingsToFile[T](settings: T, file: File)(implicit writer: Writes[T]) = {
    FileIO.printToFile(file) {
      printer =>
        printer.print(writer.writes(settings).toString)
    }
  }
}
