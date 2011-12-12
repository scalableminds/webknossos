package models

import java.util.{UUID, Date}
import play.api.Play.current
import play.mvc._
import com.mongodb.casbah.Imports._
import scala.collection.JavaConverters._
import org.joda.time.DateTime
import com.novus.salat.global._
import com.novus.salat.dao.SalatDAO
/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 10.12.11
 * Time: 12:58
 */
case class LoginToken(_id: ObjectId = new ObjectId, token: String, userEmail: String, expires: Date)

object LoginToken extends BasicDAO[LoginToken]("logintokens"){
  def create(user:User){
    val loginToken = LoginToken(
      token = generateToken,
      userEmail = user.email,
      expires = new Date
    )
    insert(loginToken)
  }

  def generateToken = UUID.randomUUID().toString().replaceAll("-","");
}
