package mail

import com.scalableminds.util.time.Instant
import com.typesafe.scalalogging.LazyLogging
import models.organization.{Organization, PricingPlan, PricingPlanFeatures}
import models.user.{MultiUser, MultiUserDAO}

import javax.inject.Inject

/* Emails about organizations and their pricing plans, as well as the requests users send to the WEBKNOSSOS team
   (help and upgrade requests). */
class OrganizationEmailService @Inject() (
    multiUserDAO: MultiUserDAO,
    defaultMails: DefaultMails,
    mailSender: MailSender
) extends LazyLogging {

  // Tells the WEBKNOSSOS team that a new organization was created.
  def sendNewOrganizationEmail(organization: Organization, creatorEmail: String, host: String): Unit =
    mailSender.send(defaultMails.newOrganizationMail(organization.name, creatorEmail, host))

  def sendHelpEmail(multiUser: MultiUser, organization: Organization, message: String, currentUrl: String): Unit =
    mailSender.send(defaultMails.helpMail(multiUser, organization.name, message, currentUrl))

  def sendUpgradeRequestEmail(
      multiUser: MultiUser,
      organization: Organization,
      requestedChanges: Seq[String],
      note: Option[String]
  ): Unit =
    mailSender.send(defaultMails.upgradeRequestMail(multiUser, organization.name, requestedChanges, note))

  /** Notifies the organization owner and all of its admins that the organization was moved to a higher pricing tier,
    * highlighting the features they gained. Does nothing if the plan change was not an upgrade. Runs in the background
    * and never fails, as the plan update it belongs to has already been persisted by then. Failures are logged instead.
    */
  def sendPricingPlanUpgradedEmails(
      organization: Organization,
      previousPlan: PricingPlan.PricingPlan,
      newPlan: PricingPlan.PricingPlan
  ): Unit =
    PricingPlanFeatures.unlockedBy(previousPlan, newPlan).foreach { unlockedFeatures =>
      mailSender.inBackground(
        s"the pricing plan upgrade of organization ${organization._id} from $previousPlan to $newPlan"
      ) {
        for {
          recipients <- multiUserDAO.findMultiUsersOfOrganizationOwnerAndAdmins(organization._id)
          _ = recipients.foreach(recipient =>
            mailSender.send(defaultMails.pricingPlanUpgradedMail(recipient, organization.name, unlockedFeatures))
          )
          _ = logger.info(
            s"Notified ${recipients.length} owner/admins of organization ${organization._id} about the pricing plan upgrade from $previousPlan to $newPlan."
          )
        } yield ()
      }
    }

  // Which reminders are due, and that each is sent only once, is decided by the PricingPlanExpiryReminderService.
  def sendPricingPlanExpiryReminderEmails(
      recipients: List[MultiUser],
      organization: Organization,
      paidUntil: Instant,
      daysRemaining: Long
  ): Unit =
    recipients.foreach(recipient =>
      mailSender.send(defaultMails.pricingPlanExpiryReminderMail(recipient, organization, paidUntil, daysRemaining))
    )
}
