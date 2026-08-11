package models.organization

import com.scalableminds.util.box.{Empty, Failure, Full}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.typesafe.scalalogging.LazyLogging
import mail.{DefaultMails, Send}
import models.user.MultiUserDAO
import org.apache.pekko.actor.ActorSystem
import play.api.inject.ApplicationLifecycle
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.*

/* Reminds the owner and the admins of an organization by email that its pricing plan is about to expire.
   One reminder is sent per configured lead time (e.g. 30, 14 and 7 days before expiry). The lead times a reminder
   was already sent for are recorded in the database, keyed by the expiry date. That way, extending the plan arms
   the reminders again, and no duplicate mails are sent if the server is restarted. */
class PricingPlanExpiryReminderService @Inject() (
    organizationDAO: OrganizationDAO,
    multiUserDAO: MultiUserDAO,
    defaultMails: DefaultMails,
    conf: WkConf,
    val lifecycle: ApplicationLifecycle,
    val actorSystem: ActorSystem
)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with LazyLogging {

  import PricingPlanExpiryReminderService.{crossedLeadTimesDays, daysUntil, leadTimesDaysFor}

  private lazy val Mailer = actorSystem.actorSelection("/user/mailActor")

  private def allLeadTimesDays: List[Int] =
    conf.WebKnossos.PricingPlanExpiryReminder.leadTimesDays ++ conf.WebKnossos.PricingPlanExpiryReminder.trialLeadTimesDays

  override protected def tickerEnabled: Boolean =
    conf.WebKnossos.PricingPlanExpiryReminder.enabled && allLeadTimesDays.nonEmpty

  override protected def tickerInterval: FiniteDuration = conf.WebKnossos.PricingPlanExpiryReminder.tickerInterval

  override protected def tickerInitialDelay: FiniteDuration = 5 minutes

  override protected def tick(): Fox[Unit] =
    for {
      now <- Instant.nowFox
      organizations <- organizationDAO.findAllWithPlanExpiringBefore(now + (allLeadTimesDays.max days))
      _ <- Fox.serialCombined(organizations)(organization => tryAndLog(organization, remindIfDue(organization, now)))
    } yield ()

  private def remindIfDue(organization: Organization, now: Instant): Fox[Unit] =
    for {
      paidUntil <- organization.paidUntil.toFox
      daysRemaining = daysUntil(paidUntil, now)
      leadTimesDays = leadTimesDaysFor(
        organization.pricingPlan,
        conf.WebKnossos.PricingPlanExpiryReminder.leadTimesDays,
        conf.WebKnossos.PricingPlanExpiryReminder.trialLeadTimesDays
      )
      dueLeadTimesDays = crossedLeadTimesDays(daysRemaining, leadTimesDays)
      _ <- Fox.runIf(dueLeadTimesDays.nonEmpty)(remind(organization, paidUntil, daysRemaining, dueLeadTimesDays))
    } yield ()

  private def remind(
      organization: Organization,
      paidUntil: Instant,
      daysRemaining: Long,
      dueLeadTimesDays: List[Int]
  ): Fox[Unit] =
    for {
      recipients <- multiUserDAO.findMultiUsersOfOrganizationOwnerAndAdmins(organization._id)
      _ <- Fox.fromBool(recipients.nonEmpty) ?~> "Organization has neither an owner nor an admin to notify"
      // Recorded before sending, so that mails that cannot be delivered are not retried on every tick.
      // The count tells us how many of the lead times were not recorded before; if none, the mails were already sent.
      newlyRecordedCount <- organizationDAO.insertPlanExpiryReminders(organization._id, paidUntil, dueLeadTimesDays)
      _ = if (newlyRecordedCount > 0) {
        logger.info(
          s"Reminding the owner and admins (${recipients.length}) of organization ${organization._id} that its ${organization.pricingPlan} plan expires in $daysRemaining days..."
        )
        // One mail per recipient, so that each is addressed by their own name and does not see the other addresses.
        recipients.foreach(recipient =>
          Mailer ! Send(defaultMails.pricingPlanExpiryReminderMail(recipient, organization, paidUntil, daysRemaining))
        )
      }
    } yield ()

  private def tryAndLog(organization: Organization, result: Fox[Unit]): Fox[Unit] =
    for {
      box <- result.shiftBox
      _ = box match {
        case Full(_)    => ()
        case f: Failure =>
          logger.warn(s"Could not send pricing plan expiry reminder for organization ${organization._id}: $f")
        case Empty =>
          logger.warn(s"Could not send pricing plan expiry reminder for organization ${organization._id}: Empty")
      }
    } yield ()
}

object PricingPlanExpiryReminderService {

  // Rounded up, so that a plan expiring in 6 days and 12 hours is reported as expiring in 7 days.
  def daysUntil(instant: Instant, now: Instant): Long =
    math.ceil((instant.epochMillis - now.epochMillis).toDouble / (1 day).toMillis).toLong

  // The configured lead times that the remaining time has already fallen below, ascending.
  def crossedLeadTimesDays(daysRemaining: Long, leadTimesDays: Seq[Int]): List[Int] =
    leadTimesDays.filter(_ >= daysRemaining).sorted.toList

  // Trials run for a short time only, so they get their own (shorter) set of lead times.
  def leadTimesDaysFor(
      pricingPlan: PricingPlan.PricingPlan,
      leadTimesDays: Seq[Int],
      trialLeadTimesDays: Seq[Int]
  ): Seq[Int] =
    if (PricingPlan.isTrialPlan(pricingPlan)) trialLeadTimesDays else leadTimesDays
}
