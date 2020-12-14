package oxalis.mail

import java.net.URL

import com.scalableminds.util.mail.Mail
import javax.inject.Inject
import models.user.User
import models.team.Organization
import play.api.i18n.Messages
import utils.WkConf
import views._

import scala.util.Try

class DefaultMails @Inject()(conf: WkConf) {

  private val uri = conf.Http.uri
  private val defaultSender = conf.Mail.defaultSender
  private val wkOrgSender = conf.Mail.demoSender
  private val newOrganizationMailingList = conf.WebKnossos.newOrganizationMailingList

  def registerAdminNotifyerMail(name: String,
                                email: String,
                                brainDBResult: Option[String],
                                organization: Organization): Mail =
    Mail(
      from = defaultSender,
      subject =
        s"webKnossos | A new user ($name, $email) registered on $uri for ${organization.displayName} (${organization.name})",
      bodyHtml = html.mail.notifyAdminNewUser(name, brainDBResult, uri).body,
      recipients = List(organization.newUserMailingList)
    )

  def overLimitMail(user: User,
                    projectName: String,
                    taskId: String,
                    annotationId: String,
                    organization: Organization): Mail =
    Mail(
      from = defaultSender,
      subject = s"webKnossos | Time limit reached. ${user.abreviatedName} in $projectName",
      bodyHtml = html.mail.notifyAdminTimeLimit(user.name, projectName, taskId, annotationId, uri).body,
      recipients = List(organization.overTimeMailingList)
    )

  def newUserMail(name: String, receiver: String, brainDBresult: Option[String], enableAutoVerify: Boolean)(
    implicit messages: Messages): Mail =
    Mail(
      from = defaultSender,
      subject = "Welcome to webKnossos",
      bodyHtml = html.mail.newUser(name, brainDBresult.map(Messages(_)), enableAutoVerify).body,
      recipients = List(receiver)
    )

  def newUserWKOrgMail(name: String, receiver: String, enableAutoVerify: Boolean)(implicit messages: Messages): Mail =
    Mail(
      from = wkOrgSender,
      subject = "Welcome to webKnossos",
      bodyHtml = html.mail.newUserWKOrg(name, enableAutoVerify).body,
      recipients = List(receiver)
    )

  def newAdminWKOrgMail(name: String, receiver: String)(implicit messages: Messages): Mail =
    Mail(
      from = wkOrgSender,
      subject = "Welcome to webKnossos",
      bodyHtml = html.mail.newAdminWKOrg(name).body,
      recipients = List(receiver)
    )

  def activatedMail(name: String, receiver: String): Mail =
    Mail(from = defaultSender,
      subject = "webKnossos | Account activated",
      bodyHtml = html.mail.validateUser(name, uri).body,
      recipients = List(receiver))

  def changePasswordMail(name: String, receiver: String): Mail =
    Mail(from = defaultSender,
      subject = "webKnossos | Password changed",
      bodyHtml = html.mail.passwordChanged(name, uri).body,
      recipients = List(receiver))

  def resetPasswordMail(name: String, receiver: String, token: String): Mail =
    Mail(
      from = defaultSender,
      subject = "webKnossos | Password Reset",
      bodyHtml = html.mail.resetPassword(name, uri, token).body,
      recipients = List(receiver)
    )

  def newOrganizationMail(organizationDisplayName: String, creatorEmail: String, domain: String): Mail =
    Mail(
      from = defaultSender,
      subject = s"webKnossos | New Organization created on ${domain}",
      bodyHtml = html.mail.notifyAdminNewOrganization(organizationDisplayName, creatorEmail, domain).body,
      recipients = List(newOrganizationMailingList)
    )

  def inviteMail(receiver: String,
                 inviteTokenValue: String,
                 autoVerify: Boolean,
                 organizationDisplayName: String,
                 senderName: String): Mail = {
    val host = Try { new URL(uri) }.toOption.getOrElse(uri)
    Mail(
      from = defaultSender,
      subject = s"$senderName invited you to join their webKnossos organization at ${host}",
      bodyHtml = html.mail.invite(senderName, organizationDisplayName, inviteTokenValue, uri, autoVerify).body,
      recipients = List(receiver)
    )
  }
}
