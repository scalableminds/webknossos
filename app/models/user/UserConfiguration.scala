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
  settings: Map[String, JsValue] ){
    
  def settingsOrDefaults = {
    UserConfiguration.defaultConfiguration.settings ++ settings
  }
}

object UserConfiguration {
  val MaxSettings = 50

  val defaultConfiguration = UserConfiguration(
    Map(
      "moveValue" -> JsNumber( 1 ),
      "rotateValue" -> JsNumber( 0.01 ),
      "scaleValue" -> JsNumber( 0.05 ),
      "mouseRotateValue" -> JsNumber( 0.004 ),
      "routeClippingDistance" -> JsNumber( 100 ),
      "lockZoom" -> JsBoolean( true ),
      "displayCrosshair" -> JsBoolean( true ),
      "interpolation" -> JsBoolean( true ),
      "quality" -> JsNumber( 0 ),
      "zoomXY" -> JsNumber( 0 ),
      "zoomYZ" -> JsNumber( 0 ),
      "zoomXZ" -> JsNumber( 0 ),
      "displayPreviewXY" -> JsBoolean( false ),
      "displayPreviewYZ" -> JsBoolean( false ),
      "displayPreviewXZ" -> JsBoolean( false ),
      "newNodeNewTree" -> JsBoolean( false ),
      "nodesAsSpheres" -> JsBoolean( false ),
      "mouseInversionX" -> JsNumber( -1 ),
      "mouseInversionY" -> JsNumber( -1 ),
      "mouseActive" -> JsBoolean( true ),
      "keyboardActive" -> JsBoolean( true ),
      "gamepadActive" -> JsBoolean( false ),
      "motionsensorActive" -> JsBoolean( false ) ) )

  def isValidSetting( field: Tuple2[String, JsValue] ) = {
    val ( _, value ) = field
    ( value.asOpt[String] ).isDefined || ( value.asOpt[Int] ).isDefined || ( value.asOpt[Boolean] ).isDefined
  }
}