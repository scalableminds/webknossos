package models.basics
import play.api.Logger
import play.api.libs.json._

trait BasicSettings{
  def defaultSettings: { def settings: Map[String, JsValue]}
 
  def MaxSettings = defaultSettings.settings.size

  def isValidSetting(field: Tuple2[String, JsValue]) = {
    val (key, _) = field
    defaultSettings.settings.get(key)
  }
}