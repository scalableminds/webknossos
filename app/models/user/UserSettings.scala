package models.user

import play.api.Play.current
import braingames.security.SCrypt._
import scala.collection.mutable.Stack
import play.api.libs.json.JsValue
import play.api.libs.json.JsBoolean
import play.api.libs.json._
import models.basics.BasicSettings

case class UserSettings(
    settings: Map[String, JsValue]) {

  def settingsOrDefaults = {
    UserSettings.defaultSettings.settings ++ settings
  }
}

object UserSettings extends BasicSettings{
  implicit val userConfigurationFormat = Json.format[UserSettings]

  val defaultSettings = UserSettings(
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
      "interpolation" -> JsBoolean(false),
      "fourBit" -> JsBoolean(false),
      "briConNames" -> JsArray(Seq(JsString("default"), JsString("st08x2"), JsString("07x2"))),
      "brightness" -> JsArray(Seq(JsNumber(0), JsNumber(-90), JsNumber(-70))),
      "contrast" -> JsArray(Seq(JsNumber(1), JsNumber(2.4), JsNumber(2.4))),
      "quality" -> JsNumber(0),
      "zoom" -> JsNumber(2),
      "scale" -> JsNumber(1),
      "displayTDViewXY" -> JsBoolean(true),
      "displayTDViewYZ" -> JsBoolean(true),
      "displayTDViewXZ" -> JsBoolean(true),
      "newNodeNewTree" -> JsBoolean(false),
      "inverseX" -> JsBoolean(false),
      "inverseY" -> JsBoolean(false),
      "keyboardDelay" -> JsNumber(200),
      "mouseActive" -> JsBoolean(true),
      "keyboardActive" -> JsBoolean(true),
      "gamepadActive" -> JsBoolean(false),
      "motionsensorActive" -> JsBoolean(false),
      "firstVisToggle" -> JsBoolean(true),
      "particleSize" -> JsNumber(5),
      "overrideNodeRadius" -> JsBoolean(true),
      "sortTreesByName" -> JsBoolean(false),
      "sortCommentsAsc" -> JsBoolean(true)))

}