package models.user

import java.util.UUID
import javax.inject._
import models.user.UserToken._

class UserTokenService @Inject() (userTokenDao:MongoUserTokenDao) {
  def find(id:UUID) = userTokenDao.find(id)
  def find(email: String) = userTokenDao.find(email)
  def save(token:UserToken2) = userTokenDao.save(token)
  def remove(id:UUID) = userTokenDao.remove(id)
}

/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import play.api.libs.concurrent.Execution.Implicits._

object UserTokenService {

  def userForTokenOpt(tokenOpt: Option[String])(implicit ctx: DBAccessContext): Fox[User] = tokenOpt match {
    case Some(token) => userForToken(token)
    case _ => Fox.empty
  }

  def userForToken(token: String)(implicit ctx: DBAccessContext): Fox[User] = {
    for {
      userToken <- UserTokenDAO.findByToken(token) ?~> "Could not match user access token"
      user <- userToken.user ?~> "Could not find user for user access token"
    } yield {
      user
    }
  }
}
