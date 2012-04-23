package models

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

case class UserConfiguration( 
  settings: Map[String, JsValue]  
)

object UserConfiguration {
  val MaxSettings = 50
  
  val defaultConfiguration = UserConfiguration( 
    Map("mouseActive" -> JsBoolean(true))  
  )
  def isValidSetting( field: Tuple2[String, JsValue]) = {
    val (_,value) = field
    (value.asOpt[String]).isDefined || (value.asOpt[Int]).isDefined || (value.asOpt[Boolean]).isDefined
  }
}