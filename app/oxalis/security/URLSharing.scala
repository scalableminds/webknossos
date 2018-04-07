/*
 * Copyright (C) 2011-2018 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.security

import java.security.SecureRandom

import com.scalableminds.util.reactivemongo.{DBAccessContext, DBAccessContextPayload}
import models.user.User


case class SharingTokenContainer(sharingToken: String) extends DBAccessContextPayload

object URLSharing {

  lazy val secureRandom = new SecureRandom()

  def fallbackTokenAccessContext(sharingToken: Option[String])(implicit ctx: DBAccessContext) = {
    ctx.data match {
      case Some(user: User) => ctx
      case _ => DBAccessContext(sharingToken.map(SharingTokenContainer(_)))
    }
  }

  def generateToken = {
    val symbols = ('a' to 'z') ++ ('0' to '9')
    val length = 10
    val sb = new StringBuilder
    for (i <- 1 to length) {
      sb.append(symbols(secureRandom.nextInt(symbols.length)))
    }
    sb.toString
  }
}
