/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

trait DBAccessContextPayload

trait DBAccessContext {
  def data: Option[DBAccessContextPayload] = None

  def globalAccess: Boolean = false
}

case class SharingTokenContainer(sharingToken: String) extends DBAccessContextPayload

case class AuthorizedAccessContext(t: DBAccessContextPayload) extends DBAccessContext {
  override def data = Some(t)
}

case object UnAuthorizedAccessContext extends DBAccessContext

case object GlobalAccessContext extends DBAccessContext {
  override val globalAccess = true
}

object DBAccessContext{
  def apply(payload: Option[DBAccessContextPayload]) = {
    payload match{
      case Some(p) => AuthorizedAccessContext(p)
      case _ => UnAuthorizedAccessContext
    }
  }

  def fallbackTokenAccessContext(sharingToken: Option[String])(implicit ctx: DBAccessContext) = {
    ctx.data match {
      //case Some(user: User) => ctx
      case _ => DBAccessContext(sharingToken.map(SharingTokenContainer(_)))
    }
  }

}
