package mail

import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import models.organization.{Organization, PricingPlan, PricingPlanFeatures}
import models.user.MultiUser
import utils.WkConf
import views.*

import java.net.URI
import java.util.Locale
import javax.inject.Inject
import scala.util.Try

class DefaultMails @Inject() (conf: WkConf) extends Formatter {

  private val uri = conf.Http.uri
  private val defaultSender = conf.Mail.defaultSender
  private val supportEmail = conf.Mail.supportEmail
  private val newOrganizationMailingList = conf.WebKnossos.newOrganizationMailingList
  private val additionalFooter = conf.Mail.additionalFooter

  def registerAdminNotifierMail(
      name: String,
      email: String,
      organization: Organization,
      autoActivate: Boolean,
      recipient: String
  ): Mail =
    Mail(
      from = defaultSender,
      subject =
        s"WEBKNOSSOS | A new user ($name, $email) registered on $uri for ${organization.name} (${organization._id})",
      bodyHtml = html.mail.notifyAdminNewUser(name, uri, autoActivate, additionalFooter).body,
      recipients = List(recipient)
    )

  def overLimitMail(
      multiUser: MultiUser,
      projectName: String,
      taskId: String,
      annotationId: String,
      projectOwner: String
  ): Mail =
    Mail(
      from = defaultSender,
      subject = s"WEBKNOSSOS | Time limit reached. ${multiUser.abbreviatedName} in $projectName",
      bodyHtml = html.mail
        .notifyAdminTimeLimit(multiUser.fullName, projectName, taskId, annotationId, uri, additionalFooter)
        .body,
      recipients = List(projectOwner)
    )

  def newUserMail(name: String, recipient: String, enableAutoVerify: Boolean): Mail =
    Mail(
      from = defaultSender,
      subject = "Welcome to WEBKNOSSOS",
      bodyHtml = html.mail.newUser(name, enableAutoVerify, additionalFooter).body,
      recipients = List(recipient)
    )

  def activatedMail(name: String, recipient: String): Mail =
    Mail(
      from = defaultSender,
      subject = "WEBKNOSSOS | Account activated",
      bodyHtml = html.mail.validateUser(name, uri, additionalFooter).body,
      recipients = List(recipient)
    )

  def changePasswordMail(name: String, recipient: String): Mail =
    Mail(
      from = defaultSender,
      subject = "WEBKNOSSOS | Password changed",
      bodyHtml = html.mail.passwordChanged(name, uri, additionalFooter).body,
      recipients = List(recipient)
    )

  def resetPasswordMail(name: String, recipient: String, token: String): Mail =
    Mail(
      from = defaultSender,
      subject = "WEBKNOSSOS | Password Reset",
      bodyHtml = html.mail.resetPassword(name, uri, token, additionalFooter).body,
      recipients = List(recipient)
    )

  def newOrganizationMail(organizationName: String, creatorEmail: String, domain: String): Mail =
    Mail(
      from = defaultSender,
      subject = s"WEBKNOSSOS | New Organization created on $domain",
      bodyHtml = html.mail.notifyAdminNewOrganization(organizationName, creatorEmail, domain, additionalFooter).body,
      recipients = List(newOrganizationMailingList)
    )

  def inviteMail(
      recipient: String,
      inviteTokenValue: String,
      autoVerify: Boolean,
      organizationName: String,
      senderName: String
  ): Mail = {
    val host = Try(new URI(uri)).toOption.getOrElse(uri)
    Mail(
      from = defaultSender,
      subject = s"$senderName invited you to join their WEBKNOSSOS organization at $host",
      bodyHtml =
        html.mail.invite(senderName, organizationName, inviteTokenValue, uri, autoVerify, additionalFooter).body,
      recipients = List(recipient)
    )
  }

  def helpMail(multiUser: MultiUser, organizationName: String, message: String, currentUrl: String): Mail =
    Mail(
      from = defaultSender,
      subject = "Help requested // Feedback provided",
      bodyHtml = html.mail.help(multiUser.fullName, organizationName, message, currentUrl, additionalFooter).body,
      recipients = List(supportEmail, multiUser.email),
      replyTo = List(multiUser.email, supportEmail)
    )

  def extendPricingPlanMail(multiUser: MultiUser, organizationName: String): Mail =
    Mail(
      from = defaultSender,
      subject = "WEBKNOSSOS Plan Extension",
      bodyHtml = html.mail.extendPricingPlan(multiUser.fullName, additionalFooter, organizationName).body,
      recipients = List(supportEmail, multiUser.email),
      replyTo = List(multiUser.email, supportEmail)
    )

  def pricingPlanExpiryReminderMail(
      multiUser: MultiUser,
      organization: Organization,
      paidUntil: Instant,
      daysRemaining: Long
  ): Mail = {
    val pricingPlanLabel = PricingPlan.label(organization.pricingPlan)
    val expiryDate = formatDateOnly(paidUntil)
    Mail(
      from = defaultSender,
      subject = s"WEBKNOSSOS | Your $pricingPlanLabel plan expires on $expiryDate",
      bodyHtml = html.mail
        .pricingPlanExpiryReminder(
          multiUser.fullName,
          organization.name,
          pricingPlanLabel,
          expiryDate,
          daysRemaining,
          s"$uri/organization/overview",
          additionalFooter
        )
        .body,
      recipients = List(multiUser.email),
      replyTo = List(supportEmail)
    )
  }

  def upgradePricingPlanToTeamMail(multiUser: MultiUser, organizationName: String): Mail =
    Mail(
      from = defaultSender,
      subject = "WEBKNOSSOS Upgrade: Team Plan",
      bodyHtml = html.mail.upgradePricingPlanToTeam(multiUser.fullName, additionalFooter, organizationName).body,
      recipients = List(supportEmail, multiUser.email),
      replyTo = List(multiUser.email, supportEmail)
    )

  def upgradePricingPlanToPowerMail(multiUser: MultiUser, organizationName: String): Mail =
    Mail(
      from = defaultSender,
      subject = "WEBKNOSSOS Upgrade: Power Plan",
      bodyHtml = html.mail.upgradePricingPlanToPower(multiUser.fullName, additionalFooter, organizationName).body,
      recipients = List(supportEmail, multiUser.email),
      replyTo = List(multiUser.email, supportEmail)
    )

  def upgradePricingPlanUsersMail(multiUser: MultiUser, requestedUsers: Int, organizationName: String): Mail =
    Mail(
      from = defaultSender,
      subject = "WEBKNOSSOS Upgrade: Additional Users",
      bodyHtml =
        html.mail.upgradePricingPlanUsers(multiUser.fullName, requestedUsers, additionalFooter, organizationName).body,
      recipients = List(supportEmail, multiUser.email),
      replyTo = List(multiUser.email, supportEmail)
    )

  def upgradePricingPlanStorageMail(multiUser: MultiUser, requestedStorage: Int, organizationName: String): Mail =
    Mail(
      from = defaultSender,
      subject = "WEBKNOSSOS Upgrade: Additional Storage",
      bodyHtml = html.mail
        .upgradePricingPlanStorage(multiUser.fullName, requestedStorage, additionalFooter, organizationName)
        .body,
      recipients = List(supportEmail, multiUser.email),
      replyTo = List(multiUser.email, supportEmail)
    )

  def upgradeAiAddonMail(multiUser: MultiUser, organizationName: String, aiPlan: String, pricingPlan: String): Mail =
    Mail(
      from = defaultSender,
      subject = s"WEBKNOSSOS Upgrade: AI Add-on ($aiPlan)",
      bodyHtml =
        html.mail.upgradeAiAddon(multiUser.fullName, aiPlan, pricingPlan, additionalFooter, organizationName).body,
      recipients = List(supportEmail, multiUser.email),
      replyTo = List(multiUser.email, supportEmail)
    )

  def pricingPlanUpgradedMail(
      multiUser: MultiUser,
      organizationName: String,
      unlockedFeatures: PricingPlanFeatures
  ): Mail =
    Mail(
      from = defaultSender,
      subject = s"WEBKNOSSOS Upgrade: Your organization is now on the ${unlockedFeatures.planLabel} plan",
      bodyHtml = html.mail
        .pricingPlanUpgraded(
          multiUser.fullName,
          organizationName,
          unlockedFeatures.planLabel,
          unlockedFeatures.featureHighlights,
          uri,
          additionalFooter
        )
        .body,
      recipients = List(multiUser.email),
      replyTo = List(supportEmail)
    )

  def orderCreditsMail(multiUser: MultiUser, requestedCredits: Int): Mail =
    Mail(
      from = defaultSender,
      subject = "Request to buy WEBKNOSSOS credits",
      bodyHtml = html.mail.orderCredits(multiUser.fullName, requestedCredits, additionalFooter).body,
      recipients = List(multiUser.email)
    )

  def orderCreditsRequestMail(multiUser: MultiUser, organizationName: String, messageBody: String): Mail =
    Mail(
      from = defaultSender,
      subject = "Request to buy WEBKNOSSOS credits",
      bodyHtml = html.mail
        .orderCreditsRequest(multiUser.fullName, multiUser.email, organizationName, messageBody, additionalFooter)
        .body,
      recipients = List(supportEmail)
    )

  def jobSuccessfulGenericMail(
      multiUser: MultiUser,
      datasetName: String,
      jobLink: String,
      jobTitle: String,
      jobDescription: String
  ): Mail =
    Mail(
      from = defaultSender,
      subject = s"$jobTitle is ready",
      bodyHtml = html.mail
        .jobSuccessfulGeneric(multiUser.fullName, datasetName, jobLink, jobTitle, jobDescription, additionalFooter)
        .body,
      recipients = List(multiUser.email)
    )

  def jobSuccessfulUploadConvertMail(multiUser: MultiUser, datasetName: String, jobLink: String): Mail =
    Mail(
      from = defaultSender,
      subject = "Your dataset is ready",
      bodyHtml = html.mail.jobSuccessfulUploadConvert(multiUser.fullName, datasetName, jobLink, additionalFooter).body,
      recipients = List(multiUser.email)
    )

  def jobSuccessfulNeuronSegmentationMail(multiUser: MultiUser, datasetName: String, jobLink: String): Mail =
    Mail(
      from = defaultSender,
      subject = "Your segmentation is ready",
      bodyHtml =
        html.mail.jobSuccessfulNeuronSegmentation(multiUser.fullName, datasetName, jobLink, additionalFooter).body,
      recipients = List(multiUser.email)
    )

  def jobSuccessfulMitoSegmentationMail(multiUser: MultiUser, datasetName: String, jobLink: String): Mail =
    Mail(
      from = defaultSender,
      subject = "Your mitochondria segmentation is ready",
      bodyHtml =
        html.mail.jobSuccessfulMitoSegmentation(multiUser.fullName, datasetName, jobLink, additionalFooter).body,
      recipients = List(multiUser.email)
    )

  def jobSuccessfulAlignmentMail(multiUser: MultiUser, datasetName: String, jobLink: String): Mail =
    Mail(
      from = defaultSender,
      subject = "Your alignment is ready",
      bodyHtml = html.mail.jobSuccessfulAlignment(multiUser.fullName, datasetName, jobLink, additionalFooter).body,
      recipients = List(multiUser.email)
    )

  def jobSuccessfulModelTrainingMail(multiUser: MultiUser, jobLink: String): Mail =
    Mail(
      from = defaultSender,
      subject = "Your model training is ready",
      bodyHtml = html.mail.jobSuccessfulModelTraining(multiUser.fullName, jobLink, additionalFooter).body,
      recipients = List(multiUser.email)
    )

  def jobFailedGenericMail(
      multiUser: MultiUser,
      datasetName: String,
      jobTitle: String,
      errorMessage: Option[String]
  ): Mail =
    Mail(
      from = defaultSender,
      subject = "Oops. Your WEBKNOSSOS job failed",
      bodyHtml =
        html.mail.jobFailedGeneric(multiUser.fullName, datasetName, jobTitle, errorMessage, additionalFooter).body,
      recipients = List(multiUser.email)
    )

  def jobFailedUploadConvertMail(multiUser: MultiUser, datasetName: String, errorMessage: Option[String]): Mail =
    Mail(
      from = defaultSender,
      subject = "Oops. Your dataset upload & conversion failed",
      bodyHtml = html.mail.jobFailedUploadConvert(multiUser.fullName, datasetName, errorMessage, additionalFooter).body,
      recipients = List(multiUser.email)
    )

  def storageWarningMail(
      multiUser: MultiUser,
      organization: Organization,
      usedStorageBytes: Long,
      includedStorageBytes: Long
  ): Mail = {
    val isExceeded = usedStorageBytes >= includedStorageBytes
    val usagePercent = if (includedStorageBytes > 0) usedStorageBytes * 100 / includedStorageBytes else 100L
    Mail(
      from = defaultSender,
      subject =
        if (isExceeded) s"WEBKNOSSOS | Your organization ${organization.name} has used up its storage"
        else s"WEBKNOSSOS | Your organization ${organization.name} has used $usagePercent% of its storage",
      bodyHtml = html.mail
        .storageWarning(
          multiUser.fullName,
          organization.name,
          formatBytes(usedStorageBytes),
          formatBytes(includedStorageBytes),
          usagePercent,
          isExceeded,
          s"$uri/organization/overview",
          additionalFooter
        )
        .body,
      recipients = List(multiUser.email),
      replyTo = List(supportEmail)
    )
  }

  def annotationSharedMail(
      multiUser: MultiUser,
      sharerName: String,
      annotationId: ObjectId,
      annotationName: String,
      datasetName: String,
      teamNames: List[String]
  ): Mail =
    Mail(
      from = defaultSender,
      subject = s"WEBKNOSSOS | $sharerName shared an annotation with you",
      bodyHtml = html.mail
        .annotationShared(
          multiUser.fullName,
          sharerName,
          annotationName,
          datasetName,
          teamNames,
          annotationUrl(annotationId),
          additionalFooter
        )
        .body,
      recipients = List(multiUser.email)
    )

  def annotationTransferredMail(
      multiUser: MultiUser,
      issuerName: String,
      annotationId: ObjectId,
      annotationName: String,
      datasetName: String
  ): Mail =
    Mail(
      from = defaultSender,
      subject = s"WEBKNOSSOS | $issuerName transferred an annotation to you",
      bodyHtml = html.mail
        .annotationTransferred(
          multiUser.fullName,
          issuerName,
          annotationName,
          datasetName,
          annotationUrl(annotationId),
          additionalFooter
        )
        .body,
      recipients = List(multiUser.email)
    )

  def datasetSharedMail(
      multiUser: MultiUser,
      sharerName: String,
      datasetId: ObjectId,
      datasetName: String,
      teamNames: List[String]
  ): Mail =
    Mail(
      from = defaultSender,
      subject = s"WEBKNOSSOS | $sharerName shared the dataset $datasetName with you",
      bodyHtml = html.mail
        .datasetShared(
          multiUser.fullName,
          sharerName,
          datasetName,
          teamNames,
          // The dataset name is left out, as it may contain characters that are not valid in a URL path.
          s"$uri/datasets/$datasetId/view",
          additionalFooter
        )
        .body,
      recipients = List(multiUser.email)
    )

  def accessChangedMail(
      multiUser: MultiUser,
      issuerName: String,
      organizationName: String,
      changes: List[String]
  ): Mail =
    Mail(
      from = defaultSender,
      subject = s"WEBKNOSSOS | Your access in $organizationName has changed",
      bodyHtml = html.mail
        .accessChanged(multiUser.fullName, issuerName, organizationName, changes, s"$uri/dashboard", additionalFooter)
        .body,
      recipients = List(multiUser.email)
    )

  def taskAssignedMail(
      multiUser: MultiUser,
      issuerName: String,
      projectName: String,
      taskTypeName: String,
      annotationId: ObjectId
  ): Mail =
    Mail(
      from = defaultSender,
      subject = s"WEBKNOSSOS | $issuerName assigned a task to you",
      bodyHtml = html.mail
        .taskAssigned(
          multiUser.fullName,
          issuerName,
          projectName,
          taskTypeName,
          annotationUrl(annotationId),
          additionalFooter
        )
        .body,
      recipients = List(multiUser.email)
    )

  private def annotationUrl(annotationId: ObjectId): String = s"$uri/annotations/$annotationId"

  // Decimal units, matching how storage is shown in the organization overview.
  private def formatBytes(numBytes: Long): String = {
    val units = List("B", "KB", "MB", "GB", "TB", "PB")
    val exponent =
      if (numBytes < 1000) 0 else math.min((math.log10(numBytes.toDouble) / 3).toInt, units.length - 1)
    val value = numBytes / math.pow(1000, exponent)
    if (exponent == 0) s"$numBytes B" else "%.1f %s".formatLocal(Locale.ROOT, value, units(exponent))
  }

  def emailVerificationMail(multiUser: MultiUser, key: String): Mail = {
    val linkExpiry = conf.WebKnossos.User.EmailVerification.linkExpiry
      .map(duration => s"This link will expire in ${duration.toString()}. ")
      .getOrElse("")
    Mail(
      from = defaultSender,
      subject = "Verify Your Email at WEBKNOSSOS",
      bodyHtml = html.mail.verifyEmail(multiUser.fullName, key, linkExpiry, additionalFooter).body,
      recipients = List(multiUser.email)
    )
  }

}
