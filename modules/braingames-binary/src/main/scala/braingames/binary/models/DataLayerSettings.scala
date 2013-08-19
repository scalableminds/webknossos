package braingames.binary.models

import play.api.libs.json.Json
import java.io.File

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

object DataLayerSettings extends SettingsFile with Function4[String, String, Option[List[String]], Option[String], DataLayerSettings]{
  val dataLayerSettingsReads = Json.reads[DataLayerSettings]

  def fromFile(f: File): Option[DataLayerSettings] = {
    extractSettingsFromFile(
      new File(f.getPath + "/layer.json"),
      dataLayerSettingsReads)
  }
}
