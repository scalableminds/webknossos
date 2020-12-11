package oxalis.security

import com.scalableminds.util.accesscontext.{DBAccessContext, DBAccessContextPayload}
import models.user.User

import java.security.SecureRandom

case class SharingTokenContainer(sharingToken: String) extends DBAccessContextPayload {
  def toStringAnonymous: String =
    s"sharingToken ${sharingToken.take(4)}***"
}

case class UserSharingTokenContainer(user: User, sharingToken: Option[String]) extends DBAccessContextPayload {
  def toStringAnonymous: String =
    s"user ${user._id} with sharingToken ${sharingToken.take(4)}***"
}

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
