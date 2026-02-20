package models.organization

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Empty, Failure, Fox, FoxImplicits, Full}
import com.typesafe.scalalogging.LazyLogging
import models.job.{JobDAO, JobService}
import play.api.libs.json.{JsObject, Json}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class CreditTransactionService @Inject()(creditTransactionDAO: CreditTransactionDAO)(implicit val ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  def hasEnoughCredits(organizationId: String, milliCreditsToSpend: Int)(implicit ctx: DBAccessContext): Fox[Boolean] =
    creditTransactionDAO.getMilliCreditBalance(organizationId).map(balance => balance >= milliCreditsToSpend)

  def reserveCredits(organizationId: String, milliCreditsToSpend: Int, comment: String)(
      implicit ctx: DBAccessContext): Fox[CreditTransaction] = {
    val pendingCreditTransaction = CreditTransaction(ObjectId.generate,
                                                     organizationId,
                                                     None,
                                                     None,
                                                     -milliCreditsToSpend,
                                                     comment,
                                                     CreditTransactionState.Pending,
                                                     CreditState.Pending)
    for {
      _ <- creditTransactionDAO.insertNewPendingTransaction(pendingCreditTransaction)
      insertedTransaction <- creditTransactionDAO.findOne(pendingCreditTransaction._id)
    } yield insertedTransaction
  }

  def completeTransactionOfJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      transactionBox <- creditTransactionDAO.findTransactionForJob(jobId).shiftBox
      _ <- transactionBox match {
        case Full(transaction) =>
          for {
            _ <- creditTransactionDAO.commitTransaction(transaction._id)
          } yield ()
        case Empty      => Fox.successful(()) // Assume transaction-less Job
        case f: Failure => f.toFox
      }

    } yield ()

  def refundTransactionForJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      transactionBox <- creditTransactionDAO.findTransactionForJob(jobId).shiftBox
      _ <- transactionBox match {
        case Full(transaction) =>
          for {
            _ <- creditTransactionDAO.refundTransaction(transaction._id)
          } yield ()
        case Empty      => Fox.successful(()) // Assume transaction-less Job
        case f: Failure => f.toFox
      }
    } yield ()

  // This method is explicitly named this way to warn that this method should only be called when starting a job has failed.
  // Else refunding should be done via jobId.
  def refundTransactionWhenStartingJobFailed(creditTransaction: CreditTransaction)(
      implicit ctx: DBAccessContext): Fox[Unit] = creditTransactionDAO.refundTransaction(creditTransaction._id)

  def addJobIdToTransaction(creditTransaction: CreditTransaction, jobId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    creditTransactionDAO.addJobIdToTransaction(creditTransaction, jobId)

  def findTransactionOfJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[CreditTransaction] =
    creditTransactionDAO.findTransactionForJob(jobId)

}

class CreditTransactionPublicWritesService @Inject()(jobDAO: JobDAO, jobService: JobService) {

  def publicWrites(transaction: CreditTransaction)(implicit ctx: DBAccessContext, ec: ExecutionContext): Fox[JsObject] =
    for {
      jobOpt <- Fox.runOptional(transaction._paidJob)(jobDAO.findOne)
      jobJsOpt <- Fox.runOptional(jobOpt)(jobService.publicWrites)
    } yield
      Json.obj(
        "id" -> transaction._id,
        "organization_id" -> transaction._organization,
        "relatedTransaction" -> transaction._relatedTransaction,
        "paidJob" -> jobJsOpt,
        "creditChange" -> transaction.milliCreditDelta,
        "comment" -> transaction.comment,
        "transactionState" -> transaction.transactionState,
        "creditState" -> transaction.creditState,
        "expirationDate" -> transaction.expirationDate,
        "createdAt" -> transaction.createdAt,
        "updatedAt" -> transaction.updatedAt
      )

}
