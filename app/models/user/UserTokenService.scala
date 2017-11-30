/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.user

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Play.current
import play.api.i18n.Messages.Implicits._

object UserTokenService {

  def userForTokenOpt(tokenOpt: Option[String])(implicit ctx: DBAccessContext): Fox[User] = tokenOpt match {
    case Some(token) => userForToken(token)
    case _ => Fox.empty
  }

  def userForToken(token: String)(implicit ctx: DBAccessContext): Fox[User] = {
    for {
      userToken <- UserTokenDAO.findByToken(token) ?~> Messages("error.invalidToken")
      user <- userToken.user ?~> Messages("error.invalidToken")
    } yield {
      user
    }
  }
}
