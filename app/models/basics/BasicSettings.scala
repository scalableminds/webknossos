package models.basics

import play.api.libs.json._

trait BasicSettings{
  def defaultConfiguration: { def settings: Map[String, JsValue]}
  
  def MaxSettings = defaultConfiguration.settings.size
  
  def isValid(js: JsObject) = {
    js
      .fields
      .filter {
        case (s, _) =>
          defaultConfiguration.settings.find(_._1 == s).isEmpty
      }
      .isEmpty
  }

  def isValidSetting(field: Tuple2[String, JsValue]) = {
    val (key, _) = field
    defaultConfiguration.settings.get(key)
  }
}