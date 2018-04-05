/*
 * Copyright (C) 2011-2018 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.security

import com.scalableminds.util.reactivemongo.{DBAccessContext, DBAccessContextPayload}
import models.user.User


case class SharingTokenContainer(sharingToken: String) extends DBAccessContextPayload

object URLSharing {

  def fallbackTokenAccessContext(sharingToken: Option[String])(implicit ctx: DBAccessContext) = {
    ctx.data match {
      case Some(user: User) => ctx
      case _ => DBAccessContext(sharingToken.map(SharingTokenContainer(_)))
    }
  }
}
