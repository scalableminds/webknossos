package models.configuration

import play.api.libs.json.{JsBoolean, JsValue, _}

case class UserConfiguration(configuration: Map[String, JsValue]) {

  def configurationOrDefaults: Map[String, JsValue] =
    UserConfiguration.default.configuration ++ configuration

}

object UserConfiguration {

  implicit val userConfigurationFormat: OFormat[UserConfiguration] = Json.format[UserConfiguration]

  val default: UserConfiguration = UserConfiguration(
    Map(
      "moveValue" -> JsNumber(300),
      "moveValue3d" -> JsNumber(300),
      "rotateValue" -> JsNumber(0.01),
      "crosshairSize" -> JsNumber(0.1),
      "scaleValue" -> JsNumber(0.05),
      "mouseRotateValue" -> JsNumber(0.004),
      "clippingDistance" -> JsNumber(50),
      "clippingDistanceArbitrary" -> JsNumber(64),
      "dynamicSpaceDirection" -> JsBoolean(true),
      "displayCrosshair" -> JsBoolean(true),
      "scale" -> JsNumber(1),
      "isosurfaceDisplay" -> JsBoolean(false),
      "isosurfaceBBsize" -> JsNumber(1),
      "isosurfaceResolution" -> JsNumber(80),
      "newNodeNewTree" -> JsBoolean(false),
      "highlightCommentedNodes" -> JsBoolean(false),
      "keyboardDelay" -> JsNumber(200),
      "particleSize" -> JsNumber(5),
      "overrideNodeRadius" -> JsBoolean(true),
      "sortTreesByName" -> JsBoolean(false),
      "sortCommentsAsc" -> JsBoolean(true),
      "sphericalCapRadius" -> JsNumber(140),
      "layoutScaleValue" -> JsNumber(1),
      "renderComments" -> JsBoolean(false)
    ))
}
