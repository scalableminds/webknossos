package oxalis.security

import com.scalableminds.util.accesscontext.{DBAccessContext, DBAccessContextPayload}
import models.user.User

case class SharingTokenContainer(sharingToken: String) extends DBAccessContextPayload {
  def toStringAnonymous: String =
    s"sharingToken ${sharingToken.take(4)}***"
}

case class UserSharingTokenContainer(user: User, sharingToken: Option[String]) extends DBAccessContextPayload {
  def toStringAnonymous: String =
    s"user ${user._id} with sharingToken ${sharingToken.take(4)}***"
}

object URLSharing {

  def fallbackTokenAccessContext(sharingToken: Option[String])(implicit ctx: DBAccessContext): DBAccessContext =
    ctx.data match {
      case Some(user: User) => DBAccessContext(Some(UserSharingTokenContainer(user, sharingToken)))
      case _                => DBAccessContext(sharingToken.map(SharingTokenContainer))
    }

}
