package com.scalableminds.brainflight.model

import net.liftmodules.mongoauth.model.ExtSession
import net.liftmodules.mongoauth.model.LoginToken
import net.liftmodules.mongoauth.MongoAuth
import net.liftmodules.mongoauth.ProtoAuthUser
import net.liftmodules.mongoauth.ProtoAuthUserMeta

import net.liftweb._
import common._
import http._
import mongodb.record.field._
import util.Helpers
import net.liftweb.common._
import net.liftweb.util._
import net.liftweb.util.Helpers._

import com.scalableminds.brainflight.lib._
import net.liftweb.http.S._
import net.liftweb.record.{Record, TypedField}
import net.liftweb.mongodb.record.BsonRecord
import net.liftweb.record.field.{StringField, PasswordField}
import net.liftweb.mongodb.record.field.{BsonRecordListField, ObjectIdRefListField, Password, MongoPasswordField}
import org.bson.types.ObjectId
import util.Vendor._

/**
* The singleton that has methods for accessing the database
*/
object User extends User with ProtoAuthUserMeta[User] with Loggable {
  override def collectionName = "users" // define the MongoDB collection name
  import mongodb.BsonDSL._

  ensureIndex((email.name -> 1), true)
  ensureIndex((username.name -> 1), true)

  def findByStringId(id: String): Box[User] =
    if (ObjectId.isValid(id)) find(new ObjectId(id))
    else Empty

  def findByEmail(eml: String): Box[User] = find(email.name, eml)
  def findByUsername(uname: String): Box[User] = find(username.name, uname)

  override def onLogIn: List[User => Unit] = List(user => User.loginCredentials.remove())

  override def onLogOut: List[Box[User] => Unit] = List(
    // when the user is going to get logged out, the current route needs to get saved
    SessionRoute.saveRoute _,
    x => logger.debug("User.onLogOut called."),
    boxedUser => boxedUser.foreach { u =>
      LoginToken.deleteAllByUserId(u.id.is)
      ExtSession.deleteExtCookie()
      ExtSession.deleteAllByUserId(u.id.is)
    }
  )

  val skipEmailValidation = false
  
  /*
   * MongoAuth vars
   */
  // site settings
  private lazy val sysUsername = MongoAuth.systemUsername.vend
  private lazy val indexUrl = MongoAuth.indexUrl.vend
  private lazy val loginTokenAfterUrl = MongoAuth.loginTokenAfterUrl.vend
  private lazy val verifyTokenAfterUrl  = "/"

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
        case Full(_) => 
          S.param("verify") match {
            case Full(_) =>
              respUrl = verifyTokenAfterUrl
            case _ =>
              respUrl = loginTokenAfterUrl
          }
        case _ => S.error("User not found")
      }
      case _ => S.warning("Login token not provided")
    }

    Full(RedirectResponse(respUrl))
  }

  // send an email to the user with a link for logging in
  def sendLoginToken(user: User): Unit = {
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
      """.format(MongoAuth.siteName.vend, token.url, sysUsername).stripMargin

    sendMail(
      From(MongoAuth.systemFancyEmail),
      Subject("%s Password Help".format(MongoAuth.siteName.vend)),
      To(user.fancyEmail),
      PlainMailBodyType(msgTxt)
    )
  }
  // send an email to the user with a link for logging in
  def verifyEmailAddress(user: User): Unit = {
    import net.liftweb.util.Mailer._

    val token = LoginToken.createForUserId(user.id.is)

    val msgTxt =
      """
        |Thanks for registering an account on our site.
        |
        |If you did not request this, you can safely ignore it. It will expire
        |48 hours from the time this message was sent.
        |
        |Follow the link below or copy and paste it into your internet browser to activate your account.
        |
        |%s
        |
        |Thanks,
        |%s
      """.format(token.url+"&verify=true", sysUsername).stripMargin

    sendMail(
      From(MongoAuth.systemFancyEmail),
      Subject("%s Account activation".format(MongoAuth.siteName.vend)),
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

  def createExtSession(uid: ObjectId) = ExtSession.createExtSession(uid)

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

    // used during login process
    object loginCredentials extends SessionVar[LoginCredentials](LoginCredentials(""))

    def createUserFromCredentials = createRecord.email(loginCredentials.is.email)
  }

  case class LoginCredentials(val email: String, val isRememberMe: Boolean = false)


/**
* A "User" class that includes first name, last name, password
*/

class User extends ProtoAuthUser[User] with ObjectIdPk[User] {
  def meta = User

  def userIdAsString: String = id.toString

  // all routes the user creates are connected to his user profile
  object flightRoutes extends ObjectIdRefListField(this, FlightRoute)

    /*
     * FieldContainers for various LiftScreeens.
     */
  def accountScreenFields = new FieldContainer {
      def allFields = List(username, email)
    }

    def profileScreenFields = new FieldContainer {
      def allFields = List(username, email)
    }

    def registerScreenFields = new FieldContainer {
      def allFields = List(username, email)
    }
}