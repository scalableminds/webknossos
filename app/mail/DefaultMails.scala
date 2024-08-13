package mail

import models.organization.Organization
import models.user.User
import utils.WkConf
import views._

import java.net.URL
import javax.inject.Inject
import scala.util.Try

class DefaultMails @Inject()(conf: WkConf) {

  private val uri = conf.Http.uri
  private val defaultSender = conf.Mail.defaultSender
  private val newOrganizationMailingList = conf.WebKnossos.newOrganizationMailingList

  def registerAdminNotifierMail(name: String,
                                email: String,
                                organization: Organization,
                                autoActivate: Boolean,
                                recipient: String): Mail =
    Mail(
      from = defaultSender,
      subject =
        s"WEBKNOSSOS | A new user ($name, $email) registered on $uri for ${organization.name} (${organization._id})",
      bodyHtml = html.mail.notifyAdminNewUser(name, uri, autoActivate).body,
      recipients = List(recipient)
    )

  def overLimitMail(user: User, projectName: String, taskId: String, annotationId: String, projectOwner: String): Mail =
    Mail(
      from = defaultSender,
      subject = s"WEBKNOSSOS | Time limit reached. ${user.abbreviatedName} in $projectName",
      bodyHtml = html.mail.notifyAdminTimeLimit(user.name, projectName, taskId, annotationId, uri).body,
      recipients = List(projectOwner)
    )

  def newUserMail(name: String, recipient: String, enableAutoVerify: Boolean): Mail =
    Mail(
      from = defaultSender,
      subject = "Welcome to WEBKNOSSOS",
      bodyHtml = html.mail.newUser(name, enableAutoVerify).body,
      recipients = List(recipient)
    )

  def activatedMail(name: String, recipient: String): Mail =
    Mail(from = defaultSender,
         subject = "WEBKNOSSOS | Account activated",
         bodyHtml = html.mail.validateUser(name, uri).body,
         recipients = List(recipient))

  def changePasswordMail(name: String, recipient: String): Mail =
    Mail(from = defaultSender,
         subject = "WEBKNOSSOS | Password changed",
         bodyHtml = html.mail.passwordChanged(name, uri).body,
         recipients = List(recipient))

  def resetPasswordMail(name: String, recipient: String, token: String): Mail =
    Mail(
      from = defaultSender,
      subject = "WEBKNOSSOS | Password Reset",
      bodyHtml = html.mail.resetPassword(name, uri, token).body,
      recipients = List(recipient)
    )

  def newOrganizationMail(organizationName: String, creatorEmail: String, domain: String): Mail =
    Mail(
      from = defaultSender,
      subject = s"WEBKNOSSOS | New Organization created on $domain",
      bodyHtml = html.mail.notifyAdminNewOrganization(organizationName, creatorEmail, domain).body,
      recipients = List(newOrganizationMailingList)
    )

  def inviteMail(recipient: String,
                 inviteTokenValue: String,
                 autoVerify: Boolean,
                 organizationName: String,
                 senderName: String): Mail = {
    val host = Try { new URL(uri) }.toOption.getOrElse(uri)
    Mail(
      from = defaultSender,
      subject = s"$senderName invited you to join their WEBKNOSSOS organization at $host",
      bodyHtml = html.mail.invite(senderName, organizationName, inviteTokenValue, uri, autoVerify).body,
      recipients = List(recipient)
    )
  }

  def helpMail(user: User, userEmail: String, organizationName: String, message: String, currentUrl: String): Mail =
    Mail(
      from = defaultSender,
      subject = "Help requested // Feedback provided",
      bodyHtml = html.mail.help(user.name, organizationName, message, currentUrl).body,
      recipients = List("hello@webknossos.org", userEmail)
    )

  def extendPricingPlanMail(user: User, userEmail: String): Mail =
    Mail(
      from = defaultSender,
      subject = "WEBKNOSSOS Plan Extension Request",
      bodyHtml = html.mail.extendPricingPlan(user.name).body,
      recipients = List(userEmail)
    )

  def upgradePricingPlanToTeamMail(user: User, userEmail: String): Mail =
    Mail(
      from = defaultSender,
      subject = "WEBKNOSSOS Plan Upgrade Request",
      bodyHtml = html.mail.upgradePricingPlanToTeam(user.name).body,
      recipients = List(userEmail)
    )

  def upgradePricingPlanUsersMail(user: User, userEmail: String, requestedUsers: Int): Mail =
    Mail(
      from = defaultSender,
      subject = "Request to upgrade WEBKNOSSOS users",
      bodyHtml = html.mail.upgradePricingPlanUsers(user.name, requestedUsers).body,
      recipients = List(userEmail)
    )

  def upgradePricingPlanStorageMail(user: User, userEmail: String, requestedStorage: Int): Mail =
    Mail(
      from = defaultSender,
      subject = "Request to upgrade WEBKNOSSOS storage",
      bodyHtml = html.mail.upgradePricingPlanStorage(user.name, requestedStorage).body,
      recipients = List(userEmail)
    )

  def upgradePricingPlanRequestMail(user: User,
                                    userEmail: String,
                                    organizationName: String,
                                    messageBody: String): Mail =
    Mail(
      from = defaultSender,
      subject = "Request to upgrade WEBKNOSSOS plan",
      bodyHtml = html.mail.upgradePricingPlanRequest(user.name, userEmail, organizationName, messageBody).body,
      recipients = List("hello@webknossos.org")
    )

  def jobSuccessfulGenericMail(user: User,
                               userEmail: String,
                               datasetName: String,
                               jobLink: String,
                               jobTitle: String,
                               jobDescription: String): Mail =
    Mail(
      from = defaultSender,
      subject = s"$jobTitle is ready",
      bodyHtml = html.mail.jobSuccessfulGeneric(user.name, datasetName, jobLink, jobTitle, jobDescription).body,
      recipients = List(userEmail)
    )

  def jobSuccessfulUploadConvertMail(user: User, userEmail: String, datasetName: String, jobLink: String): Mail =
    Mail(
      from = defaultSender,
      subject = "Your dataset is ready",
      bodyHtml = html.mail.jobSuccessfulUploadConvert(user.name, datasetName, jobLink).body,
      recipients = List(userEmail)
    )

  def jobSuccessfulSegmentationMail(user: User,
                                    userEmail: String,
                                    datasetName: String,
                                    jobLink: String,
                                    jobTitle: String): Mail =
    Mail(
      from = defaultSender,
      subject = s"Your $jobTitle is ready",
      bodyHtml = html.mail.jobSuccessfulSegmentation(user.name, datasetName, jobLink, jobTitle).body,
      recipients = List(userEmail)
    )

  def jobFailedGenericMail(user: User, userEmail: String, datasetName: String, jobTitle: String): Mail =
    Mail(
      from = defaultSender,
      subject = "Oops. Your WEBKNOSSOS job failed",
      bodyHtml = html.mail.jobFailedGeneric(user.name, datasetName, jobTitle).body,
      recipients = List(userEmail)
    )

  def jobFailedUploadConvertMail(user: User, userEmail: String, datasetName: String): Mail =
    Mail(
      from = defaultSender,
      subject = "Oops. Your dataset upload & conversion failed",
      bodyHtml = html.mail.jobFailedUploadConvert(user.name, datasetName).body,
      recipients = List(userEmail)
    )

  def emailVerificationMail(user: User, userEmail: String, key: String): Mail = {
    val linkExpiry = conf.WebKnossos.User.EmailVerification.linkExpiry
      .map(duration => s"This link will expire in ${duration.toString()}. ")
      .getOrElse("")
    Mail(
      from = defaultSender,
      subject = "Verify Your Email at WEBKNOSSOS",
      bodyHtml = html.mail.verifyEmail(user.name, key, linkExpiry).body,
      recipients = List(userEmail)
    )
  }

}
