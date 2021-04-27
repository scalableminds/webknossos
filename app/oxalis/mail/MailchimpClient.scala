package oxalis.mail

import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.user.{MultiUser, User}
import play.api.libs.json.Json
import utils.WkConf

import scala.concurrent.ExecutionContext

class MailchimpClient @Inject()(wkConf: WkConf, rpc: RPC)(implicit ec: ExecutionContext) extends LazyLogging {

  private lazy val conf = wkConf.Mail.Mailchimp

  def registerUser(user: User, multiUser: MultiUser): Fox[Unit] = {
    if (conf.host.isEmpty) return Fox.successful(())
    val emailMd5 = SCrypt.md5(multiUser.email)
    val uri = s"${conf.host}/lists/${conf.listId}/members/$emailMd5"
    val userBody = Json.obj(
      "email_address" -> multiUser.email,
      "status" -> "subscribed",
      "merge_fields" -> Json.obj(
        "FNAME" -> user.firstName,
        "LNAME" -> user.lastName,
      )
    )
    logger.info(s"Registering user ${user._id} for Mailchimp")
    for {
      _ <- rpc(uri).silent.withBasicAuth(conf.user, conf.password).put(userBody)
    } yield ()
  }

}
