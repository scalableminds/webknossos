package models.organization

import com.scalableminds.util.Msg
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

  def hasEnoughCredits(organizationId: String, milliCreditsToSpend: Int)(using ctx: DBAccessContext): Fox[Boolean] =
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
    } yield pendingCreditTransaction
  }

  def completeTransactionOfJob(jobId: ObjectId)(using ctx: DBAccessContext): Fox[Unit] =
    for {
      transactionBox <- creditTransactionDAO.findPendingTransactionForJob(jobId).shiftBox
      _ <- transactionBox match {
        case Full(transaction) =>
          for {
            _ <- creditTransactionDAO.commitTransaction(transaction._id)
          } yield ()
        case Empty      => Fox.successful(()) // Assume transaction-less Job
        case f: Failure => f.toFox
      }

    } yield ()

  def refundTransactionForJob(jobId: ObjectId, isCancelled: Boolean = false)(using ctx: DBAccessContext): Fox[Unit] =
    for {
      transactionBox <- creditTransactionDAO.findPendingTransactionForJob(jobId).shiftBox
      _ <- transactionBox match {
        case Full(transaction) =>
          for {
            _ <- creditTransactionDAO.refundTransaction(transaction._id, isCancelled)
          } yield ()
        case Empty      => Fox.successful(()) // Assume transaction-less Job
        case f: Failure => f.toFox
      }
    } yield ()

  def reserveCreditsForRetry(jobId: ObjectId)(using ctx: DBAccessContext): Fox[Unit] =
    for {
      existingTransactionBox <- creditTransactionDAO.findTransactionForJob(jobId).shiftBox
      _ <- existingTransactionBox match {
        case Full(existingTransaction) =>
          val milliCreditsToSpend = -existingTransaction.milliCreditDelta
          for {
            _ <- Fox.assertTrue(hasEnoughCredits(existingTransaction._organization, milliCreditsToSpend)) ?~> Msg.Job.Credits.notEnoughCredits
            newTransaction = CreditTransaction(
              ObjectId.generate,
              existingTransaction._organization,
              None,
              Some(jobId),
              existingTransaction.milliCreditDelta,
              existingTransaction.comment,
              CreditTransactionState.Pending,
              CreditState.Pending
            )
            _ <- creditTransactionDAO.insertNewPendingTransaction(newTransaction)
          } yield ()
        case Empty      => Fox.successful(()) // Assume transaction-less (non-paid) Job
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

  def findTransactionOfJob(jobId: ObjectId)(using ctx: DBAccessContext): Fox[CreditTransaction] =
    creditTransactionDAO.findTransactionForJob(jobId)

  // For display purposes: pairs each expired free-credit grant with its revocation and replaces
  // both with a single net entry. Net-zero pairs (credits granted but never used) are returned
  // with milliCreditDelta == 0 so the caller can filter them out.
  def compactFreeCreditsForDisplay(transactions: List[CreditTransaction]): List[CreditTransaction] = {
    val revocationByGrantId: Map[ObjectId, CreditTransaction] =
      transactions.filter(_.creditState == CreditState.Revoking).flatMap(t => t._relatedTransaction.map(_ -> t)).toMap
    val revocationIds: Set[ObjectId] = revocationByGrantId.values.map(_._id).toSet
    transactions
      .filterNot(t => revocationIds.contains(t._id))
      .map(t =>
        revocationByGrantId.get(t._id) match {
          case Some(revocation) =>
            t.copy(
              milliCreditDelta = t.milliCreditDelta + revocation.milliCreditDelta,
              comment = s"${t.comment}: ${(t.milliCreditDelta + revocation.milliCreditDelta) / 1000.0} used"
            )
          case None => t
      })
  }

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
