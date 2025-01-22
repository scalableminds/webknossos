package models.organization

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsObject, Json}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class CreditTransactionService @Inject()(creditTransactionDAO: CreditTransactionDAO)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  def hasEnoughCredits(organizationId: String, creditsToSpent: BigDecimal): Fox[Boolean] =
    // TODO: get rid of global access context
    creditTransactionDAO.getCreditBalance(organizationId)(GlobalAccessContext).map(balance => balance >= creditsToSpent)

  def reserveCredits(organizationId: String,
                     creditsToSpent: BigDecimal,
                     comment: String,
                     paidJob: Option[ObjectId]): Fox[Unit] = {
    // TODO: get rid of global access context
    val pendingCreditTransaction = CreditTransaction(ObjectId.generate,
                                                     organizationId,
                                                     creditsToSpent,
                                                     None,
                                                     comment,
                                                     paidJob,
                                                     CreditTransactionState.Pending,
                                                     None)
    creditTransactionDAO.insertNewPendingTransaction(pendingCreditTransaction)(GlobalAccessContext)
  }

  def completeTransactionOfJob(jobId: ObjectId): Fox[Unit] =
    for {
      // TODO: get rid of global access context
      transaction <- creditTransactionDAO.findTransactionForJob(jobId)(GlobalAccessContext)
      _ <- creditTransactionDAO.commitTransaction(transaction._id.toString)(GlobalAccessContext)
    } yield ()

  def refundTransactionForJob(jobId: ObjectId): Fox[Unit] =
    for {
      // TODO: get rid of global access context
      transaction <- creditTransactionDAO.findTransactionForJob(jobId)(GlobalAccessContext)
      _ <- creditTransactionDAO.refundTransaction(transaction._id.toString)(GlobalAccessContext)
    } yield ()

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
