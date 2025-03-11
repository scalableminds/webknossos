package models.organization

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full
import play.api.libs.json.{JsObject, Json}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class CreditTransactionService @Inject()(creditTransactionDAO: CreditTransactionDAO,
                                         organizationService: OrganizationService)(implicit val ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  def hasEnoughCredits(organizationId: String, creditsToSpend: BigDecimal)(
      implicit ctx: DBAccessContext): Fox[Boolean] =
    creditTransactionDAO.getCreditBalance(organizationId).map(balance => balance >= creditsToSpend)

  def reserveCredits(organizationId: String, creditsToSpent: BigDecimal, comment: String)(
      implicit ctx: DBAccessContext): Fox[CreditTransaction] =
    for {
      _ <- organizationService.assertOrganizationHasPaidPlan(organizationId)
      pendingCreditTransaction = CreditTransaction(ObjectId.generate,
                                                   organizationId,
                                                   None,
                                                   None,
                                                   -creditsToSpent,
                                                   comment,
                                                   CreditTransactionState.Pending,
                                                   CreditState.Pending)
      _ <- creditTransactionDAO.insertNewPendingTransaction(pendingCreditTransaction)
      insertedTransaction <- creditTransactionDAO.findOne(pendingCreditTransaction._id)
    } yield insertedTransaction

  def insertCreditTransaction(creditTransaction: CreditTransaction)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- organizationService.assertOrganizationHasPaidPlan(creditTransaction._organization)
      _ <- creditTransactionDAO.insertTransaction(creditTransaction)
    } yield ()

  def completeTransactionOfJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      transaction <- creditTransactionDAO.findTransactionForJob(jobId)
      _ <- organizationService.assertOrganizationHasPaidPlan(transaction._organization)
      _ <- creditTransactionDAO.commitTransaction(transaction._id)
    } yield ()

  def refundTransactionForJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      transaction <- creditTransactionDAO.findTransactionForJob(jobId)
      _ <- refundTransaction(transaction)
    } yield ()

  private def refundTransaction(creditTransaction: CreditTransaction)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- organizationService.assertOrganizationHasPaidPlan(creditTransaction._organization)
      _ <- creditTransactionDAO.refundTransaction(creditTransaction._id)
    } yield ()

  // This method is explicitly named this way to warn that this method should only be called when starting a job has failed.
  // Else refunding should be done via jobId.
  def refundTransactionWhenStartingJobFailed(creditTransaction: CreditTransaction)(
      implicit ctx: DBAccessContext): Fox[Unit] = refundTransaction(creditTransaction)

  def addJobIdToTransaction(creditTransaction: CreditTransaction, jobId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    creditTransactionDAO.addJobIdToTransaction(creditTransaction, jobId)

  def findTransactionOfJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Option[CreditTransaction]] =
    creditTransactionDAO.findTransactionForJob(jobId).futureBox.flatMap {
      case Full(transaction) => Fox.successful(Some(transaction))
      case _                 => Fox.successful(None)
    }

  def publicWrites(transaction: CreditTransaction): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "id" -> transaction._id,
        "organization_id" -> transaction._organization,
        "relatedTransaction" -> transaction._relatedTransaction,
        "paidJobId" -> transaction._paidJob,
        "creditChange" -> transaction.creditChange,
        "comment" -> transaction.comment,
        "transactionState" -> transaction.transactionState,
        "creditState" -> transaction.creditState,
        "expirationDate" -> transaction.expirationDate,
        "createdAt" -> transaction.createdAt,
        "updatedAt" -> transaction.updatedAt,
        "isDeleted" -> transaction.isDeleted
      ))

}
