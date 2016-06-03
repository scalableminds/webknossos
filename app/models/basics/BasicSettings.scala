package models.basics

import scala.language.reflectiveCalls

import play.api.libs.json._

trait BasicSettings{
  def default: { def configuration: Map[String, JsValue]}

  def MaxSettings = default.configuration.size

  def isValidSetting(field: (String, JsValue)) = {
    val (key, _) = field
    default.configuration.get(key)
  }
}
