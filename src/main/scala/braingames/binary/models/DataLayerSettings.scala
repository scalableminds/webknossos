package braingames.binary.models

import play.api.libs.json.Json
import java.io.File
import scalax.file.Path

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 17:47
 */
case class DataLayerSettings(
  typ: String,
  `class`: String,
  flags: Option[List[String]],
  fallback: Option[String])

object DataLayerSettings extends SettingsFile[DataLayerSettings] {
  val settingsFileReads = Json.reads[DataLayerSettings]

  val settingsFileName =  "layer.json"
}
