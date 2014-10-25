package models.basics
import play.api.Logger
import play.api.libs.json._

trait BasicSettings{
  def default: { def configuration: Map[String, JsValue]}

  def MaxSettings = default.configuration.size

  def isValidSetting(field: Tuple2[String, JsValue]) = {
    val (key, _) = field
    default.configuration.get(key)
  }
}
