package braingames.binary.models

import java.io.File
import play.api.libs.json._
import braingames.util.JsonHelper._
import net.liftweb.common._
import net.liftweb.common.Box._
import scalax.file.Path
import braingames.io.FileIO

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 17:44
 */
trait SettingsFile[A] {
  def settingsFileName: String

  def settingsFileReads: Reads[A]

  def settingsFileInFolder(p: Path) = p / settingsFileName

  def fromSettingsFileIn(p: Path): Option[A] =
    extractSettingsFromFile(
      settingsFileInFolder(p),
      settingsFileReads)

  def extractSettingsFromFile[T](path: Path, settingsReads: Reads[T]): Box[T] = {
    if (path.isFile) {
      JsonFromFile(path).flatMap {
        _.validate(settingsReads) match {
          case JsSuccess(e, _) => Full(e)
          case e: JsError => Failure(e.toString)
        }
      }
    } else
      Empty
  }

  def writeSettingsToFile[T](settings: T, path: Path)(implicit writer: Writes[T]) = {
    path.fileOption.map(file =>
      FileIO.printToFile(file) {
        printer =>
          printer.print(writer.writes(settings).toString)
      })
  }
}
