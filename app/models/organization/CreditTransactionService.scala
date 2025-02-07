package models.organization

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.typesafe.scalalogging.LazyLogging
import org.apache.pekko.actor.ActorSystem
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationInt, FiniteDuration}

class CreditTransactionService @Inject()(creditTransactionDAO: CreditTransactionDAO,
                                         organizationService: OrganizationService,
                                         val lifecycle: ApplicationLifecycle,
                                         val system: ActorSystem)(implicit val ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with IntervalScheduler {

  def hasEnoughCredits(organizationId: String, creditsToSpent: BigDecimal)(
      implicit ctx: DBAccessContext): Fox[Boolean] =
    creditTransactionDAO.getCreditBalance(organizationId).map(balance => balance >= creditsToSpent)

  def reserveCredits(organizationId: String, creditsToSpent: BigDecimal, comment: String, paidJob: Option[ObjectId])(
      implicit ctx: DBAccessContext): Fox[CreditTransaction] =
    for {
      _ <- organizationService.ensureOrganizationHasPaidPlan(organizationId)
      pendingCreditTransaction = CreditTransaction(ObjectId.generate,
                                                   organizationId,
                                                   -creditsToSpent,
                                                   creditsToSpent,
                                                   None,
                                                   None,
                                                   comment,
                                                   paidJob,
                                                   CreditTransactionState.Pending,
                                                   None)
      _ <- creditTransactionDAO.insertNewPendingTransaction(pendingCreditTransaction)
      insertedTransaction <- creditTransactionDAO.findOne(pendingCreditTransaction._id)
    } yield insertedTransaction

  def doCreditTransaction(creditTransaction: CreditTransaction)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- organizationService.ensureOrganizationHasPaidPlan(creditTransaction._organization)
      _ <- creditTransactionDAO.insertTransaction(creditTransaction)
    } yield ()

  def completeTransactionOfJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      transaction <- creditTransactionDAO.findTransactionForJob(jobId)
      _ <- organizationService.ensureOrganizationHasPaidPlan(transaction._organization)
      _ <- creditTransactionDAO.commitTransaction(transaction._id)
    } yield ()

  def refundTransactionForJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      transaction <- creditTransactionDAO.findTransactionForJob(jobId)
      _ <- refundTransaction(transaction)
    } yield ()

  private def refundTransaction(creditTransaction: CreditTransaction)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- organizationService.ensureOrganizationHasPaidPlan(creditTransaction._organization)
      _ <- creditTransactionDAO.refundTransaction(creditTransaction._id)
    } yield ()

  // This method is explicitly named this way to warn that this method should only be called when starting a job has failed.
  // Else refunding should be done via jobId.
  def refundTransactionWhenStartingJobFailed(creditTransaction: CreditTransaction)(
      implicit ctx: DBAccessContext): Fox[Unit] = refundTransaction(creditTransaction)

  def addJobIdToTransaction(creditTransaction: CreditTransaction, jobId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    creditTransactionDAO.addJobIdToTransaction(creditTransaction, jobId)

  def publicWrites(transaction: CreditTransaction): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "id" -> transaction._id,
        "organization_id" -> transaction._organization,
        "creditChange" -> transaction.creditChange,
        "spentMoney" -> transaction.spentMoney,
        "comment" -> transaction.comment,
        "paidJobId" -> transaction._paidJob,
        "state" -> transaction.state,
        "expirationDate" -> transaction.expirationDate,
        "createdAt" -> transaction.createdAt,
        "updatedAt" -> transaction.updatedAt,
        "isDeleted" -> transaction.isDeleted
      ))

  def revokeExpiredCredits(): Fox[Unit] = creditTransactionDAO.runRevokeExpiredCredits()
  def handOutMonthlyFreeCredits(): Fox[Unit] = creditTransactionDAO.handOutMonthlyFreeCredits()

  override protected def tickerInterval: FiniteDuration = 1 minute

  // TODO: make this class a singleton or put this somewhere else as this is executed for each instance of the service
  override protected def tick(): Unit =
    for {
      _ <- Fox.successful(())
      _ = logger.info("Starting revoking expired credits...")
      _ <- revokeExpiredCredits()
      _ = logger.info("Finished revoking expired credits.")
      _ = logger.info("Staring handing out free monthly credits.")
      _ <- handOutMonthlyFreeCredits()
      _ = logger.info("Finished handing out free monthly credits.")
    } yield ()
  ()
}
