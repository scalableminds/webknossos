/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.user

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import models.basics.SecuredBaseDAO
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID

case class LoginToken(_user: BSONObjectID, token: String, expirationTime: Long, _id: BSONObjectID = BSONObjectID.generate)

object LoginToken {
  implicit val loginTokenFormat = Json.format[LoginToken]
}

object LoginTokenDAO extends SecuredBaseDAO[LoginToken] {
  val collectionName = "loginTokens"

  val formatter = LoginToken.loginTokenFormat

  def findBy(token: String)(implicit ctx: DBAccessContext): Fox[LoginToken] = {
    findOne(Json.obj("token" -> token, "expirationTime" -> Json.obj("$gte" -> System.currentTimeMillis)))
  }
}
