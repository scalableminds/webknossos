package com.scalableminds.util.accesscontext

trait DBAccessContextPayload {
  def toStringAnonymous: String
}

trait DBAccessContext {
  def data: Option[DBAccessContextPayload] = None

  def globalAccess: Boolean = false

  def toStringAnonymous: String =
    data match {
      case Some(payload: DBAccessContextPayload) => payload.toStringAnonymous
      case _                                     => "None"
    }
}

case class AuthorizedAccessContext(t: DBAccessContextPayload) extends DBAccessContext {
  override def data: Option[DBAccessContextPayload] = Some(t)
}

case object UnAuthorizedAccessContext extends DBAccessContext

case object GlobalAccessContext extends DBAccessContext {
  override val globalAccess = true

  override def toStringAnonymous: String = "Global"
}

object DBAccessContext {
  def apply(payload: Option[DBAccessContextPayload]): DBAccessContext =
    payload match {
      case Some(p) => AuthorizedAccessContext(p)
      case _       => UnAuthorizedAccessContext
    }
}
