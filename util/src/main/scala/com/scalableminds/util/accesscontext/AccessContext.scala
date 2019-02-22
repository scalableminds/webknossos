package com.scalableminds.util.accesscontext

trait DBAccessContextPayload

trait DBAccessContext {
  def data: Option[DBAccessContextPayload] = None

  def globalAccess: Boolean = false
}

case class AuthorizedAccessContext(t: DBAccessContextPayload) extends DBAccessContext {
  override def data = Some(t)
}

case object UnAuthorizedAccessContext extends DBAccessContext

case object GlobalAccessContext extends DBAccessContext {
  override val globalAccess = true
}

object DBAccessContext {
  def apply(payload: Option[DBAccessContextPayload]) =
    payload match {
      case Some(p) => AuthorizedAccessContext(p)
      case _       => UnAuthorizedAccessContext
    }
}
