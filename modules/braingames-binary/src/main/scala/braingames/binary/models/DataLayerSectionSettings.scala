package braingames.binary.models

import play.api.libs.json.Json
import java.io.File

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 17:50
 */

case class DataLayerSectionSettings(
  sectionId: Option[Int],
  bbox: List[List[Int]],
  resolutions: List[Int])

object DataLayerSectionSettings extends SettingsFile with Function3[Option[Int], List[List[Int]], List[Int], DataLayerSectionSettings]{
  val dataLayerSectionSettingsReads = Json.reads[DataLayerSectionSettings]

  def fromFile(f: File): Option[DataLayerSectionSettings] = {
    extractSettingsFromFile(
      new File(f.getPath + "/section.json"),
      dataLayerSectionSettingsReads)
  }
}
