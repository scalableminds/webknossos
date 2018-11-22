package oxalis.security

import java.security.SecureRandom

import com.scalableminds.util.accesscontext.{
  AuthorizedAccessContext,
  DBAccessContext,
  DBAccessContextPayload,
  UnAuthorizedAccessContext
}
import models.user.User

case class SharingTokenContainer(sharingToken: String) extends DBAccessContextPayload

case class UserSharingTokenContainer(user: User, sharingToken: Option[String]) extends DBAccessContextPayload

object URLSharing {

  lazy val secureRandom = new SecureRandom()

  def fallbackTokenAccessContext(sharingToken: Option[String])(implicit ctx: DBAccessContext) =
    ctx.data match {
      case Some(user: User) => DBAccessContext(Some(UserSharingTokenContainer(user, sharingToken)))
      case _                => DBAccessContext(sharingToken.map(SharingTokenContainer(_)))
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
