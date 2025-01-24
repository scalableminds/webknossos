package models.organization

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.OrganizationCreditTransactionsRow
import com.scalableminds.webknossos.schema.Tables.OrganizationCreditTransactions
import models.organization.CreditTransactionState.TransactionState
import slick.lifted.Rep
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class CreditTransaction(_id: ObjectId = ObjectId.generate,
                             _organization: String,
                             creditChange: BigDecimal,
                             spentMoney: Option[BigDecimal],
                             comment: String,
                             _paidJob: Option[ObjectId],
                             state: TransactionState,
                             expirationDate: Option[Instant],
                             createdAt: Instant = Instant.now,
                             updatedAt: Instant = Instant.now,
                             isDeleted: Boolean = false)

class CreditTransactionDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[CreditTransaction, OrganizationCreditTransactionsRow, OrganizationCreditTransactions](sqlClient) {

  protected val collection = OrganizationCreditTransactions

  protected def idColumn(x: OrganizationCreditTransactions): Rep[String] = x._Id

  override protected def isDeletedColumn(x: OrganizationCreditTransactions): Rep[Boolean] = x.isDeleted

  override protected def parse(row: OrganizationCreditTransactionsRow): Fox[CreditTransaction] =
    for {
      state <- CreditTransactionState.fromString(row.state).toFox
      id <- ObjectId.fromString(row._Id)
      jobIdOpt <- Fox.runOptional(row._PaidJob)(ObjectId.fromStringSync)
    } yield {
      CreditTransaction(
        id,
        row._Organization,
        row.creditChange,
        row.spentMoney,
        row.comment,
        jobIdOpt,
        state,
        row.expirationDate.map(Instant.fromDate),
        Instant.fromSql(row.createdAt),
        Instant.fromSql(row.updatedAt),
        row.isDeleted
      )
    }

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"""(_id IN (SELECT _organization FROM webknossos.users_ WHERE _multiUser = (SELECT _multiUser FROM webknossos.users_ WHERE _id = $requestingUserId)))
      OR TRUE in (SELECT isSuperUser FROM webknossos.multiUsers_ WHERE _id IN (SELECT _multiUser FROM webknossos.users_ WHERE _id = $requestingUserId))"""
  // TODO: updateAccessQ
  override protected def anonymousReadAccessQ(sharingToken: Option[String]): SqlToken = q"FALSE"

  override def findAll(implicit ctx: DBAccessContext): Fox[List[CreditTransaction]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery".as[OrganizationCreditTransactionsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findOne(transactionId: String)(implicit ctx: DBAccessContext): Fox[CreditTransaction] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM $existingCollectionName WHERE _id = $transactionId AND $accessQuery"
          .as[OrganizationCreditTransactionsRow])
      parsed <- parseFirst(r, transactionId)
    } yield parsed

  def getCreditBalance(organizationId: String)(implicit ctx: DBAccessContext): Fox[BigDecimal] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT COALESCE(SUM(credit_change), 0) FROM $existingCollectionName WHERE _organization = $organizationId AND $accessQuery"
          .as[BigDecimal])
      firstRow <- r.headOption
    } yield firstRow

  def insertNewPendingTransaction(transaction: CreditTransaction)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      // TODO: check write access
      _ <- run(
        q"""INSERT INTO webknossos.organization_credit_transactions
          (_id, _organization, credit_change, spent_money, comment, _paid_job,
          state, expiration_date, created_at, updated_at, is_deleted)
          VALUES
          (${transaction._id}, ${transaction._organization}, ${transaction.creditChange.toString()}::DECIMAL,
          ${transaction.spentMoney.map(_.toString)}::DECIMAL, ${transaction.comment}, ${transaction._paidJob},
          'Pending', ${transaction.expirationDate}, ${transaction.createdAt},
          ${transaction.updatedAt}, ${transaction.isDeleted})
          """.asUpdate
      )
    } yield ()

  def addJobIdToTransaction(transaction: CreditTransaction, jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      // TODO: check write access
      _ <- run(
        q"""UPDATE webknossos.organization_credit_transactions
          SET _paid_job = $jobId, updated_at = NOW()
          WHERE _id = ${transaction._id}
          """.asUpdate
      )
    } yield ()

  def insertTransaction(transaction: CreditTransaction)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      // TODO: check write access
      _ <- run(
        q"""INSERT INTO webknossos.organization_credit_transactions
          (_id, _organization, credit_change, spent_money, comment, _paid_job,
          state, expiration_date, created_at, updated_at, is_deleted)
          VALUES
          (${transaction._id}, ${transaction._organization}, ${transaction.creditChange.toString()}::DECIMAL,
          ${transaction.spentMoney.map(_.toString)}::DECIMAL, ${transaction.comment}, ${transaction._paidJob},
          ${transaction.state}, ${transaction.expirationDate}, ${transaction.createdAt},
          ${transaction.updatedAt}, ${transaction.isDeleted})
          """.asUpdate
      )
    } yield ()

  def commitTransaction(transactionId: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      // TODO: check write access
      _ <- run(
        q"""UPDATE webknossos.organization_credit_transactions
          SET state = ${CreditTransactionState.Completed}, updated_at = NOW()
          WHERE _id = $transactionId
          """.asUpdate
      )
    } yield ()

  def refundTransaction(transactionId: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      // TODO: make this a proper sql transaction.
      //_ <- run(q"START TRANSACTION".as[Unit])
      // TODO: check write access
      updatedTransactionCount <- run(
        q"""UPDATE webknossos.organization_credit_transactions
          SET state = 'Refunded', updated_at = NOW()
          WHERE _id = $transactionId AND state = ${CreditTransactionState.Pending}
          """.asUpdate
      )
      _ <- bool2Fox(updatedTransactionCount == 1) ?~> s"Refunding failed. Transaction $transactionId not found or no longer pending."
      refundedTransaction <- findOne(transactionId)
      refundAmount = refundedTransaction.creditChange * -1
      _ <- bool2Fox(refundAmount >= 0) ?~> s"Refunds must not be negative."
      refundComment = refundedTransaction._paidJob
        .map(jobId => s"Refund for failed job $jobId.")
        .getOrElse(s"Refund for transaction ${refundedTransaction._id}.")
      // insert refund transaction
      _ <- run(q"""INSERT INTO webknossos.organization_credit_transactions
          (_id, _organization, credit_change, comment, _paid_job, state)
          VALUES
          (${ObjectId.generate}, ${refundedTransaction._organization}, ${refundAmount.toString()}::DECIMAL,
          $refundComment, ${refundedTransaction._paidJob}, ${CreditTransactionState.Completed})
          """.asUpdate)
      //_ <- run(q"COMMIT TRANSACTION".as[Unit])
    } yield ()

  def findTransactionForJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[CreditTransaction] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM $existingCollectionName WHERE _paid_job = $jobId AND $accessQuery"
          .as[OrganizationCreditTransactionsRow])
      parsed <- parseFirst(r, jobId)
    } yield parsed

}
