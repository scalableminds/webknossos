package net.liftmodules.mongoauth
package model

import org.bson.types.ObjectId

import net.liftweb._
import common._
import http.{LiftResponse, RedirectResponse, Req, S}
import mongodb.record.field._
import util.Helpers

class SimpleUser extends ProtoAuthUser[SimpleUser] with ObjectIdPk[SimpleUser] {
  def meta = SimpleUser

  def userIdAsString: String = id.toString
}

object SimpleUser extends SimpleUser with ProtoAuthUserMeta[SimpleUser] with Loggable {
  import mongodb.BsonDSL._

  //ensureIndex((email.name -> 1), true)
  //ensureIndex((username.name -> 1), true)

  def findByStringId(id: String): Box[SimpleUser] =
    if (ObjectId.isValid(id)) find(new ObjectId(id))
    else Empty

  override def onLogOut: List[Box[SimpleUser] => Unit] = List(
    x => logger.debug("User.onLogOut called."),
    boxedUser => boxedUser.foreach { u =>
      ExtSession.deleteExtCookie()
    }
  )

  /*
   * MongoAuth vars
   */
  private lazy val siteName = MongoAuth.siteName.vend
  private lazy val sysUsername = MongoAuth.systemUsername.vend
  private lazy val indexUrl = MongoAuth.indexUrl.vend
  private lazy val loginTokenAfterUrl = MongoAuth.loginTokenAfterUrl.vend

  /*
   * LoginToken
   */
  private def logUserInFromToken(uid: ObjectId): Box[Unit] = find(uid).map { user =>
    user.verified(true)
    user.save
    logUserIn(user, false)
    LoginToken.deleteAllByUserId(user.id.is)
  }

  override def handleLoginToken: Box[LiftResponse] = {
    var respUrl = indexUrl
    S.param("token").flatMap(LoginToken.findByStringId) match {
      case Full(at) if (at.expires.isExpired) => {
        S.error("Login token has expired")
        at.delete_!
      }
      case Full(at) => logUserInFromToken(at.userId.is) match {
        case Full(_) => respUrl = loginTokenAfterUrl
        case _ => S.error("User not found")
      }
      case _ => S.warning("Login token not provided")
    }

    Full(RedirectResponse(respUrl))
  }

  // send an email to the user with a link for logging in
  def sendLoginToken(user: SimpleUser): Unit = {
    import net.liftweb.util.Mailer._

    val token = LoginToken.createForUserId(user.id.is)

    val msgTxt =
      """
        |Someone requested a link to change your password on the %s website.
        |
        |If you did not request this, you can safely ignore it. It will expire
        |48 hours from the time this message was sent.
        |
        |Follow the link below or copy and paste it into your internet browser.
        |
        |%s
        |
        |Thanks,
        |%s
      """.format(siteName, token.url, sysUsername).stripMargin

    sendMail(
      From(MongoAuth.systemFancyEmail),
      Subject("%s Password Help".format(siteName)),
      To(user.fancyEmail),
      PlainMailBodyType(msgTxt)
    )
  }

  /*
   * ExtSession
   */
  private def logUserInFromExtSession(uid: ObjectId): Box[Unit] = find(uid).map { user =>
    //createExtSession(es.userId.value) // make sure cookie expiration gets updated
    logUserIn(user, false)
  }

  /*
  * Test for active ExtSession.
  */
  def testForExtSession: Box[Req] => Unit = {
    ignoredReq => {
      logger.debug("ExtSession currentUserId: "+currentUserId.toString)
      if (currentUserId.isEmpty) {
        ExtSession.handleExtSession match {
          case Full(es) => logUserInFromExtSession(es.userId.is)
          case Failure(msg, _, _) => logger.warn("Error logging user in with ExtSession: %s".format(msg))
          case Empty => logger.warn("Unknown error logging user in with ExtSession: Empty")
        }
      }
    }
  }
}