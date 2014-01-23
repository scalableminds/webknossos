package models.basics
import play.api.Logger
import play.api.libs.json._

trait BasicSettings{
  def defaultSettings: { def settings: Map[String, JsValue]}
  
  def MaxSettings = defaultSettings.settings.size
  
  def isValid(js: JsObject) = {
    /*js
      .fields
      .filter {
        case (s, _) =>
          defaultSettings.settings.find(_._1 == s).isEmpty
      }
      .isEmpty*/ true
  }

  def isValidSetting(field: Tuple2[String, JsValue]) = {
    val (key, _) = field
    defaultSettings.settings.get(key)
  }
}