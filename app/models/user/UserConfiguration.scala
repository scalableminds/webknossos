package models.user

import play.api.db._
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

case class UserConfiguration(
    settings: Map[String, JsValue]) {

  def settingsOrDefaults = {
    UserConfiguration.defaultConfiguration.settings ++ settings
  }
}

object UserConfiguration {

  val defaultConfiguration = UserConfiguration(
    Map(
      "moveValue" -> JsNumber(1),
      "rotateValue" -> JsNumber(0.01),
      "scaleValue" -> JsNumber(0.05),
      "mouseRotateValue" -> JsNumber(0.004),
      "routeClippingDistance" -> JsNumber(100),
      "lockZoom" -> JsBoolean(true),
      "displayCrosshair" -> JsBoolean(true),
      "interpolation" -> JsBoolean(false),
      "fourBit" -> JsBoolean(true),
      "briConNames" -> JsArray(Seq(JsString("default"), JsString("st08x2"), JsString("07x2"))),
      "brightness" -> JsArray(Seq(JsNumber(0), JsNumber(-90), JsNumber(-70))),
      "contrast" -> JsArray(Seq(JsNumber(1), JsNumber(2.4), JsNumber(2.4))),
      "quality" -> JsNumber(0),
      "zoomXY" -> JsNumber(2),
      "zoomYZ" -> JsNumber(2),
      "zoomXZ" -> JsNumber(2),
      "displayPreviewXY" -> JsBoolean(false),
      "displayPreviewYZ" -> JsBoolean(false),
      "displayPreviewXZ" -> JsBoolean(false),
      "newNodeNewTree" -> JsBoolean(false),
      "nodesAsSpheres" -> JsBoolean(false),
      "mouseInversionX" -> JsNumber(-1),
      "mouseInversionY" -> JsNumber(-1),
      "mouseActive" -> JsBoolean(true),
      "keyboardActive" -> JsBoolean(true),
      "gamepadActive" -> JsBoolean(false),
      "motionsensorActive" -> JsBoolean(false),
      "firstVisToggle" -> JsBoolean(true)))

  val MaxSettings = defaultConfiguration.settings.size

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
