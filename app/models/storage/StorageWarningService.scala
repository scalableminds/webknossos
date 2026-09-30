package models.storage

import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import mail.{DefaultMails, Send}
import models.organization.{Organization, OrganizationDAO}
import models.user.MultiUserDAO
import org.apache.pekko.actor.ActorSystem
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

/* Warns the owner and the admins of an organization by email when its used storage crosses one of the configured
   thresholds (e.g. 90% and 100% of the included storage). Checked whenever the used storage was freshly scanned.
   The thresholds a warning was already sent for are recorded in the database, so that each one is only announced once.
   Once the usage drops clearly below a threshold again (e.g. after deleting data or upgrading the storage), it is
   re-armed. The margin prevents a new mail on every scan while the usage hovers around a threshold. */
class StorageWarningService @Inject() (
    organizationDAO: OrganizationDAO,
    multiUserDAO: MultiUserDAO,
    defaultMails: DefaultMails,
    conf: WkConf,
    actorSystem: ActorSystem
)(implicit ec: ExecutionContext)
    extends LazyLogging {

  import StorageWarningService.{crossedThresholdsPercent, rearmedThresholdsPercent, usagePercent}

  private lazy val Mailer = actorSystem.actorSelection("/user/mailActor")

  private def thresholdsPercent: List[Int] = conf.WebKnossos.StorageWarning.thresholdsPercent

  def warnIfThresholdCrossed(organization: Organization): Fox[Unit] =
    organization.includedStorageBytes match {
      case Some(includedStorageBytes) if conf.WebKnossos.StorageWarning.enabled && thresholdsPercent.nonEmpty =>
        for {
          usedStorageBytes <- organizationDAO.getUsedStorage(organization._id)
          percent = usagePercent(usedStorageBytes, includedStorageBytes)
          _ <- organizationDAO.deleteStorageWarnings(
            organization._id,
            rearmedThresholdsPercent(percent, thresholdsPercent)
          )
          crossed = crossedThresholdsPercent(percent, thresholdsPercent)
          _ <- Fox.runIf(crossed.nonEmpty)(warn(organization, usedStorageBytes, includedStorageBytes, crossed))
        } yield ()
      case _ => Fox.successful(()) // unlimited storage, nothing to warn about
    }

  private def warn(
      organization: Organization,
      usedStorageBytes: Long,
      includedStorageBytes: Long,
      crossedThresholdsPercent: Seq[Int]
  ): Fox[Unit] =
    for {
      // Recorded before sending, so that mails that cannot be delivered are not retried on every scan.
      // The count tells us how many of the thresholds were not recorded before; if none, the mails were already sent.
      newlyRecordedCount <- organizationDAO.insertStorageWarnings(organization._id, crossedThresholdsPercent)
      _ <- Fox.runIf(newlyRecordedCount > 0)(for {
        recipients <- multiUserDAO.findMultiUsersOfOrganizationOwnerAndAdmins(organization._id)
        _ = logger.info(
          s"Warning the owner and admins (${recipients.length}) of organization ${organization._id} that it uses $usedStorageBytes of $includedStorageBytes included storage bytes..."
        )
        _ = recipients.foreach(recipient =>
          Mailer ! Send(
            defaultMails.storageWarningMail(recipient, organization, usedStorageBytes, includedStorageBytes)
          )
        )
      } yield ())
    } yield ()
}

object StorageWarningService {

  // Usage must drop this many percentage points below a threshold before a warning for it is sent again.
  private val rearmMarginPercent = 5.0

  def usagePercent(usedStorageBytes: Long, includedStorageBytes: Long): Double =
    if (includedStorageBytes <= 0) { if (usedStorageBytes > 0) Double.PositiveInfinity else 0.0 }
    else usedStorageBytes.toDouble * 100 / includedStorageBytes

  def crossedThresholdsPercent(usagePercent: Double, thresholdsPercent: Seq[Int]): Seq[Int] =
    thresholdsPercent.filter(usagePercent >= _).sorted

  def rearmedThresholdsPercent(usagePercent: Double, thresholdsPercent: Seq[Int]): Seq[Int] =
    thresholdsPercent.filter(usagePercent < _ - rearmMarginPercent).sorted
}
