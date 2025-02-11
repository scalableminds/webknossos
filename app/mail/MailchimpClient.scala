package mail

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.user.{MultiUser, MultiUserDAO, User}
import MailchimpTag.MailchimpTag
import play.api.libs.json.{Json, OFormat}
import play.api.libs.ws.WSResponse
import utils.WkConf

import scala.concurrent.ExecutionContext

class MailchimpClient @Inject() (wkConf: WkConf, rpc: RPC, multiUserDAO: MultiUserDAO) extends LazyLogging {

  private lazy val conf = wkConf.Mail.Mailchimp

  def registerUser(user: User, multiUser: MultiUser, tag: MailchimpTag): Unit =
    if (conf.host.nonEmpty) {
      val emailMd5 = SCrypt.md5(multiUser.email)
      logger.info(s"Registering user ${user._id} for Mailchimp, tag=${MailchimpTag.format(tag)}")
      for {
        _ <- registerUser(user.firstName, user.lastName, multiUser.email, emailMd5)
        _ <- tagByEmailMd5(emailMd5, tag)
      } yield ()
      ()
    }

  private def registerUser(firstName: String, lastName: String, email: String, emailMd5: String): Fox[WSResponse] = {
    val uri = s"${conf.host}/lists/${conf.listId}/members/$emailMd5"
    val userBody = Json.obj(
      "email_address" -> email,
      "status" -> "subscribed",
      "merge_fields" -> Json.obj(
        "FNAME" -> firstName,
        "LNAME" -> lastName
      )
    )
    rpc(uri).silent.withBasicAuth(conf.user, conf.password).putJson(userBody)
  }

  def tagUser(user: User, tag: MailchimpTag): Unit =
    if (conf.host.nonEmpty) {
      for {
        multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
        _ = tagMultiUser(multiUser, tag)
      } yield ()
      ()
    }

  def tagMultiUser(multiUser: MultiUser, tag: MailchimpTag): Unit =
    if (conf.host.nonEmpty) {
      val emailMd5 = SCrypt.md5(multiUser.email)
      tagByEmailMd5(emailMd5, tag)
      ()
    }

  private def tagByEmailMd5(emailMd5: String, tag: MailchimpTag): Fox[WSResponse] = {
    val uri = s"${conf.host}/lists/${conf.listId}/members/$emailMd5/tags"
    val tagBody = Json.obj(
      "tags" -> List(Json.obj("name" -> MailchimpTag.format(tag), "status" -> "active"))
    )
    rpc(uri).silent.withBasicAuth(conf.user, conf.password).postJson(tagBody)
  }

  def tagsForMultiUser(multiUser: MultiUser)(implicit ec: ExecutionContext): Fox[List[MailchimpTag]] =
    if (conf.host.isEmpty)
      Fox.successful(List.empty)
    else {
      val emailMd5 = SCrypt.md5(multiUser.email)
      val uri = s"${conf.host}/lists/${conf.listId}/members/$emailMd5/tags"
      for {
        response: MailchimpTagsResponse <- rpc(uri).silent
          .withBasicAuth(conf.user, conf.password)
          .getWithJsonResponse[MailchimpTagsResponse]
      } yield response.tags.flatMap(t => MailchimpTag.fromString(t.name))
    }

}

case class MailchimpTagsResponse(tags: List[MailchimpTagResponse])
case class MailchimpTagResponse(name: String, date_added: String)

object MailchimpTagResponse {
  implicit val jsonFormat: OFormat[MailchimpTagResponse] = Json.format[MailchimpTagResponse]
}
object MailchimpTagsResponse {
  implicit val jsonFormat: OFormat[MailchimpTagsResponse] = Json.format[MailchimpTagsResponse]
}
