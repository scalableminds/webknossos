package models.security

import java.util.{ UUID, Date }
import play.mvc._
import com.mongodb.casbah.Imports._
import scala.collection.JavaConverters._
import models.context._
import models.basics.BasicDAO
import models.user.User
import models.basics.DAOCaseClass
/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 10.12.11
 * Time: 12:58
 */
case class LoginToken(_id: ObjectId = new ObjectId, token: String, userEmail: String, expires: Date) extends DAOCaseClass[LoginToken]{
  val dao = LoginToken
}

object LoginToken extends BasicDAO[LoginToken]("logintokens") {
  def create(user: User) = {
    insertOne(LoginToken(
      token = generateToken,
      userEmail = user.email,
      expires = new Date))
  }

  def generateToken = UUID.randomUUID().toString().replaceAll("-", "");
}
