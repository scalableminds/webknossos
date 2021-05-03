package models.configuration

import play.api.libs.json.{JsValue, _}

case class UserConfiguration(configuration: Map[String, JsValue]) {

  def configurationOrDefaults: Map[String, JsValue] =
    UserConfiguration.default.configuration ++ configuration

}

object UserConfiguration {

  implicit val userConfigurationFormat: OFormat[UserConfiguration] = Json.format[UserConfiguration]

  val default: UserConfiguration = UserConfiguration(
    Map()
  )
}
