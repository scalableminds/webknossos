package models.storage

import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import mail.OrganizationEmailService
import models.organization.{EmailThresholdType, Organization, OrganizationDAO}
import models.user.MultiUserDAO
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
    organizationEmailService: OrganizationEmailService,
    conf: WkConf
)(implicit ec: ExecutionContext)
    extends LazyLogging {

  import StorageWarningService.{crossedThresholdsPercent, isExceeded, rearmedThresholdsPercent, usagePercent}

  private def thresholdsPercent: List[Int] = conf.WebKnossos.StorageWarningEmails.thresholdsPercent

  def sendWarningEmailIfThresholdCrossed(organization: Organization): Fox[Unit] =
    organization.includedStorageBytes match {
      case Some(includedStorageBytes) if conf.WebKnossos.StorageWarningEmails.enabled && thresholdsPercent.nonEmpty =>
        for {
          usedStorageBytes <- organizationDAO.getUsedStorage(organization._id)
          percent = usagePercent(usedStorageBytes, includedStorageBytes)
          _ <- organizationDAO.deleteNotifiedEmailThresholds(
            organization._id,
            EmailThresholdType.StorageWarning,
            rearmedThresholdsPercent(percent, thresholdsPercent)
          )
          crossed = crossedThresholdsPercent(percent, thresholdsPercent)
          _ <- Fox.runIf(crossed.nonEmpty)(warn(organization, usedStorageBytes, includedStorageBytes, percent, crossed))
        } yield ()
      case _ => Fox.successful(()) // unlimited storage, nothing to warn about
    }

  private def warn(
      organization: Organization,
      usedStorageBytes: Long,
      includedStorageBytes: Long,
      usagePercent: Double,
      crossedThresholdsPercent: Seq[Int]
  ): Fox[Unit] =
    for {
      // Resolved before recording, so that a failed lookup does not suppress the warning until it is re-armed.
      recipients <- multiUserDAO.findMultiUsersOfOrganizationOwnerAndAdmins(organization._id)
      _ <- Fox.fromBool(recipients.nonEmpty) ?~> "Organization has neither an owner nor an admin to notify"
      // Recorded before sending, so that mails that cannot be delivered are not retried on every scan.
      // The count tells us how many of the thresholds were not recorded before; if none, the mails were already sent.
      newlyRecordedCount <- organizationDAO.insertNotifiedEmailThresholds(
        organization._id,
        EmailThresholdType.StorageWarning,
        crossedThresholdsPercent
      )
      _ = if (newlyRecordedCount > 0) {
        logger.info(
          s"Warning the owner and admins (${recipients.length}) of organization ${organization._id} that it uses $usedStorageBytes of $includedStorageBytes included storage bytes..."
        )
        organizationEmailService.sendStorageWarningEmails(
          recipients,
          organization,
          usedStorageBytes,
          includedStorageBytes,
          usagePercent,
          isExceeded(usagePercent)
        )
      }
    } yield ()
}

object StorageWarningService {

  // Usage must drop this many percentage points below a threshold before a warning for it is sent again.
  private val rearmMarginPercent = 5.0

  def usagePercent(usedStorageBytes: Long, includedStorageBytes: Long): Double =
    if (includedStorageBytes <= 0) { if (usedStorageBytes > 0) Double.PositiveInfinity else 0.0 }
    else usedStorageBytes.toDouble * 100 / includedStorageBytes

  def isExceeded(usagePercent: Double): Boolean = usagePercent >= 100

  def crossedThresholdsPercent(usagePercent: Double, thresholdsPercent: Seq[Int]): Seq[Int] =
    thresholdsPercent.filter(usagePercent >= _).sorted

  def rearmedThresholdsPercent(usagePercent: Double, thresholdsPercent: Seq[Int]): Seq[Int] =
    thresholdsPercent.filter(usagePercent < _ - rearmMarginPercent).sorted
}
