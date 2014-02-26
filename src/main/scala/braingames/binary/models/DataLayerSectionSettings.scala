package braingames.binary.models

import play.api.libs.json.{JsSuccess, JsValue, Reads, Json}
import java.io.File
import scalax.file.Path

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 17:50
 */

sealed trait DataLayerSectionSettings {
  def sectionId: Option[String]

  def bboxSmall: List[List[Int]]

  def bboxBig: List[List[Int]]

  def resolutions: List[Int]
}

case class DataLayerSectionFullSettings(
                                         sectionId: Option[String],
                                         bboxSmall: List[List[Int]],
                                         bboxBig: List[List[Int]],
                                         resolutions: List[Int]) extends DataLayerSectionSettings

object DataLayerSectionFullSettings {
  val dataLayerSectionFullSettingsReads = Json.reads[DataLayerSectionFullSettings]
}

case class DataLayerSectionSimpleSettings(
                                           sectionId: Option[String],
                                           bbox: List[List[Int]],
                                           resolutions: List[Int]) extends DataLayerSectionSettings {
  val bboxSmall = bbox
  val bboxBig = bbox
}

object DataLayerSectionSimpleSettings {
  val dataLayerSectionSimpleSettingsReads = Json.reads[DataLayerSectionSimpleSettings]
}

object DataLayerSectionSettings extends SettingsFile[DataLayerSectionSettings] {

  import DataLayerSectionFullSettings._
  import DataLayerSectionSimpleSettings._

  val settingsFileName = "section.json"

  val settingsFileReads = new Reads[DataLayerSectionSettings] {
    def reads(json: JsValue) = {
      dataLayerSectionFullSettingsReads.reads(json) match {
        case s: JsSuccess[DataLayerSectionFullSettings] => s
        case _ => dataLayerSectionSimpleSettingsReads.reads(json)
      }
    }
  }
}
