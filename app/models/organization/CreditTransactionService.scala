package models.organization

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsObject, Json}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class CreditTransactionService @Inject()(creditTransactionDAO: CreditTransactionDAO,
                                         organizationService: OrganizationService)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

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
                                                   None,
                                                   comment,
                                                   paidJob,
                                                   CreditTransactionState.Pending,
                                                   None)
      _ <- creditTransactionDAO.insertNewPendingTransaction(pendingCreditTransaction)
      insertedTransaction <- creditTransactionDAO.findOne(pendingCreditTransaction._id)
    } yield insertedTransaction

  def doCreditTransaction(creditTransaction: CreditTransaction): Fox[Unit] =
    for {
      _ <- organizationService.ensureOrganizationHasPaidPlan(creditTransaction._organization)
      _ <- creditTransactionDAO.insertTransaction(creditTransaction)
    } yield ()

  def completeTransactionOfJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      transaction <- creditTransactionDAO.findTransactionForJob(jobId)
      _ <- organizationService.ensureOrganizationHasPaidPlan(transaction._organization)
      _ <- creditTransactionDAO.commitTransaction(transaction._id.toString)
    } yield ()

  def refundTransactionForJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      transaction <- creditTransactionDAO.findTransactionForJob(jobId)
      _ <- refundTransaction(transaction)
    } yield ()

  private def refundTransaction(creditTransaction: CreditTransaction)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- organizationService.ensureOrganizationHasPaidPlan(creditTransaction._organization)
      _ <- creditTransactionDAO.refundTransaction(creditTransaction._id.toString)
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

}
