package models

import play.api.db._
import play.api.Play.current

import com.mongodb.casbah.Imports._
import com.novus.salat.global._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import brainflight.security.SCrypt._
import scala.collection.mutable.Stack

case class UserConfiguration( 
  settings: Map[String, String]  
)

object UserConfiguration {
  val defaultConfiguration = UserConfiguration( 
    Map("mouseActive" -> "true")  
  )
}