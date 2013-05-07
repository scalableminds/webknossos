package models.user

import play.api.Play.current
import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import brainflight.security.SCrypt._
import scala.collection.mutable.Stack
import play.api.libs.json.JsValue
import play.api.libs.json.JsBoolean
import play.api.libs.json._
import models.basics.BasicSettings

case class UserConfiguration(
    settings: Map[String, JsValue]) {

  def settingsOrDefaults = {
    UserConfiguration.defaultConfiguration.settings ++ settings
  }
}

object UserConfiguration extends BasicSettings{

  val defaultConfiguration = UserConfiguration(
    Map(
      "moveValue" -> JsNumber(10),
      "moveValue3d" -> JsNumber(10),
      "rotateValue" -> JsNumber(0.01),
      "crosshairSize" -> JsNumber(0.1),
      "scaleValue" -> JsNumber(0.05),
      "mouseRotateValue" -> JsNumber(0.004),
      "routeClippingDistance" -> JsNumber(50),
      "routeClippingDistanceArbitrary" -> JsNumber(64),
      "dynamicSpaceDirection" -> JsBoolean(true),
      "displayCrosshair" -> JsBoolean(true),
      "interpolation" -> JsBoolean(false),
      "fourBit" -> JsBoolean(true),
      "briConNames" -> JsArray(Seq(JsString("default"), JsString("st08x2"), JsString("07x2"))),
      "brightness" -> JsArray(Seq(JsNumber(0), JsNumber(-90), JsNumber(-70))),
      "contrast" -> JsArray(Seq(JsNumber(1), JsNumber(2.4), JsNumber(2.4))),
      "quality" -> JsNumber(0),
      "zoom" -> JsNumber(2),
      "scale" -> JsNumber(1),
      "displayPreviewXY" -> JsBoolean(false),
      "displayPreviewYZ" -> JsBoolean(false),
      "displayPreviewXZ" -> JsBoolean(false),
      "newNodeNewTree" -> JsBoolean(false),
      "nodesAsSpheres" -> JsBoolean(false),
      "inverseX" -> JsBoolean(false),
      "inverseY" -> JsBoolean(false),
      "keyboardDelay" -> JsNumber(200),
      "mouseActive" -> JsBoolean(true),
      "keyboardActive" -> JsBoolean(true),
      "gamepadActive" -> JsBoolean(false),
      "motionsensorActive" -> JsBoolean(false),
      "firstVisToggle" -> JsBoolean(true),
      "particleSize" -> JsNumber(5)))

}