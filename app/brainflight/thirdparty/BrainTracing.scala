package brainflight.thirdparty

import brainflight.security.SCrypt._
import models.user.User
import play.api.libs.ws.WS
import com.ning.http.client.Realm.AuthScheme
import play.api.libs.concurrent.execution.defaultContext
import play.api.Logger
import play.api.Play.current
import play.api.Play
import akka.dispatch.Promise
import play.api.libs.concurrent.Akka

object BrainTracing {
  val URL = "http://braintracing.org/oxalis_create_user.php"
  val USER = "brain"
  val PW = "trace"
  val LICENSE = "hu39rxpv7m"

  val isActive = Play.configuration.getBoolean("braintracing.active") getOrElse false
  
  implicit val excetutionContext = Akka.system.dispatcher
  
  def register(user: User, password: String): Promise[String] = {
    val pwHash = md5(password)
    if (isActive) {
      val result = Promise[String]()
      WS
        .url(URL)
        .withAuth(USER, PW, AuthScheme.BASIC)
        .withQueryString(
          "license" -> LICENSE,
          "firstname" -> user.firstName,
          "lastname" -> user.lastName,
          "email" -> user.email,
          "pword" -> pwHash)
        .get()
        .map { response =>
          result complete (response.status match {
            case 200 =>
              Right("braintracing.new")
            case 304 =>
              Right("braintracing.exists")
            case _ =>
              Right("braintraceing.error")
          })
          Logger.info("Creation of account %s returned Status: %s Body: %s".format(user.email, response.status, response.body))
        }
      result
    } else {
      Promise.successful("braintracing.new")
    }
  }
}