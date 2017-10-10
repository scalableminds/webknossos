/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.user

import java.math.BigInteger
import java.security.SecureRandom

import com.scalableminds.util.reactivemongo.DBAccessContext
import models.basics.SecuredBaseDAO
import play.api.libs.json.Json
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

case class UserToken(_user: BSONObjectID,
                     token: String = UserToken.generateRandomToken,
                     expirationTime: Long = System.currentTimeMillis + UserToken.expirationTime.toMillis)

object UserToken {
  val expirationTime = 24.hours

  private val generator = new SecureRandom()
  implicit val jsonFormat = Json.format[UserToken]

  def generateRandomToken =
    new BigInteger(130, generator).toString(32)
}



object UserTokenDAO extends SecuredBaseDAO[UserToken] {

  val collectionName = "userTokens"

  val formatter = UserToken.jsonFormat

  underlying.indexesManager.ensure(Index(Seq("token" -> IndexType.Ascending)))

  def findByToken(token: String)(implicit ctx: DBAccessContext) = {
    findOne("token", token)
  }

  def removeExpiredTokens()(implicit ctx: DBAccessContext) = {
    remove(Json.obj("expirationTime" -> Json.obj("$lte" -> System.currentTimeMillis)))
  }
}
