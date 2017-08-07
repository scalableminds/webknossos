package models.configuration

import models.basics.BasicSettings
import play.api.libs.json.{JsBoolean, JsValue, _}

case class UserConfiguration(configuration: Map[String, JsValue]) {

  def configurationOrDefaults = {
    UserConfiguration.default.configuration ++ configuration
  }

}

object UserConfiguration extends BasicSettings {

  implicit val userConfigurationFormat = Json.format[UserConfiguration]

  val default = UserConfiguration(
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
      "zoom" -> JsNumber(2),
      "scale" -> JsNumber(1),
      "tdViewDisplayPlanes" -> JsBoolean(true),
      "isosurfaceDisplay" -> JsBoolean(false),
      "isosurfaceBBsize" -> JsNumber(1),
      "isosurfaceResolution" -> JsNumber(80),
      "newNodeNewTree" -> JsBoolean(false),
      "inverseX" -> JsBoolean(false),
      "inverseY" -> JsBoolean(false),
      "keyboardDelay" -> JsNumber(200),
      "particleSize" -> JsNumber(5),
      "overrideNodeRadius" -> JsBoolean(true),
      "sortTreesByName" -> JsBoolean(false),
      "sortCommentsAsc" -> JsBoolean(true),
      "sphericalCapRadius" -> JsNumber(140),
      "renderComments" -> JsBoolean(false)))

}
