package oxalis.mail

import com.scalableminds.util.mail.Mail
import javax.inject.Inject
import models.user.User
import models.team.Organization
import play.api.i18n.Messages
import utils.WkConf
import views._

class DefaultMails @Inject()(conf: WkConf) {

  /**
    * Base url used in emails
    */
  val uri = conf.Http.uri

  val defaultFrom = "no-reply@webknossos.org"

  val demoSender = conf.Mail.demoSender

  val newOrganizationMailingList = conf.WebKnossos.newOrganizationMailingList

  def registerAdminNotifyerMail(user: User, email: String, brainDBResult: Option[String], organization: Organization) =
    Mail(
      from = email,
      headers = Map("Sender" -> defaultFrom),
      subject =
        s"webKnossos | A new user (${user.name}) registered on $uri for ${organization.displayName} (${organization.name})",
      bodyHtml = html.mail.registerAdminNotify(user, brainDBResult, uri).body,
      recipients = List(organization.newUserMailingList)
    )

  def overLimitMail(user: User, projectName: String, taskId: String, annotationId: String, organization: Organization) =
    Mail(
      from = defaultFrom,
      subject = s"webKnossos | Time limit reached. ${user.abreviatedName} in $projectName",
      bodyHtml = html.mail.timeLimit(user.name, projectName, taskId, annotationId, uri).body,
      recipients = List(organization.overTimeMailingList)
    )

  def registerMail(name: String, receiver: String, brainDBresult: Option[String], enableAutoVerify: Boolean)(
      implicit messages: Messages) =
    Mail(
      from = defaultFrom,
      subject = "Welcome to webKnossos",
      bodyHtml = html.mail.register(name, brainDBresult.map(Messages(_)), enableAutoVerify).body,
      recipients = List(receiver)
    )

  def registerMailDemo(name: String, receiver: String)(implicit messages: Messages) =
    Mail(
      from = demoSender,
      subject = "Welcome to webKnossos",
      bodyHtml = html.mail.registerDemo(name).body,
      recipients = List(receiver)
    )

  def activatedMail(name: String, receiver: String) =
    Mail(from = defaultFrom,
         subject = "webKnossos | Account activated",
         bodyHtml = html.mail.validated(name, uri).body,
         recipients = List(receiver))

  def changePasswordMail(name: String, receiver: String) =
    Mail(from = defaultFrom,
         subject = "webKnossos | Password changed",
         bodyHtml = html.mail.passwordChanged(name, uri).body,
         recipients = List(receiver))

  def resetPasswordMail(name: String, receiver: String, token: String) =
    Mail(
      from = defaultFrom,
      subject = "webKnossos | Password Reset",
      bodyHtml = html.mail.resetPassword(name, uri, token).body,
      recipients = List(receiver)
    )

  def newOrganizationMail(organizationName: String, creatorEmail: String, domain: String) =
    Mail(
      from = defaultFrom,
      subject = s"webKnossos | New Organization created on ${domain}",
      bodyHtml = html.mail.newOrganization(organizationName, creatorEmail, domain).body,
      recipients = List(newOrganizationMailingList)
    )
}
