package models.organization

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.OrganizationCreditTransactionsRow
import com.scalableminds.webknossos.schema.Tables.OrganizationCreditTransactions
import models.organization.CreditTransactionState.TransactionState
import slick.dbio.DBIO
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class CreditTransaction(_id: ObjectId = ObjectId.generate,
                             _organization: String,
                             creditChange: BigDecimal,
                             refundableCreditChange: BigDecimal,
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
        row.refundableCreditChange,
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

  // Any user from an organization can update their credit transactions as for now all users can start paid jobs.
  override protected def updateAccessQ(requestingUserId: ObjectId): SqlToken = readAccessQ(requestingUserId)

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
      _ <- assertUpdateAccess(transaction._id)
      _ <- run(
        q"""INSERT INTO webknossos.organization_credit_transactions
          (_id, _organization, credit_change, refundable_credit_change, spent_money, comment, _paid_job,
          state, expiration_date, created_at, updated_at, is_deleted)
          VALUES
          (${transaction._id}, ${transaction._organization}, ${transaction.creditChange.toString()}::DECIMAL,
          ${transaction.refundableCreditChange.toString()}::DECIMAL, ${transaction.spentMoney.map(_.toString)}::DECIMAL,
          ${transaction.comment}, ${transaction._paidJob}, 'Pending', ${transaction.expirationDate},
          ${transaction.createdAt}, ${transaction.updatedAt}, ${transaction.isDeleted})
          """.asUpdate
      )
    } yield ()

  def addJobIdToTransaction(transaction: CreditTransaction, jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(transaction._id)
      _ <- run(
        q"""UPDATE webknossos.organization_credit_transactions
          SET _paid_job = $jobId, updated_at = NOW()
          WHERE _id = ${transaction._id}
          """.asUpdate
      )
    } yield ()

  def insertTransaction(transaction: CreditTransaction)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(transaction._id)
      _ <- run(
        q"""INSERT INTO webknossos.organization_credit_transactions
          (_id, _organization, credit_change, refundable_credit_change, spent_money, comment, _paid_job,
          state, expiration_date, created_at, updated_at, is_deleted)
          VALUES
          (${transaction._id}, ${transaction._organization}, ${transaction.creditChange.toString()}::DECIMAL,
          ${transaction.refundableCreditChange.toString()}::DECIMAL, ${transaction.spentMoney.map(_.toString)}::DECIMAL,
          ${transaction.comment}, ${transaction._paidJob}, ${transaction.state}, ${transaction.expirationDate},
          ${transaction.createdAt}, ${transaction.updatedAt}, ${transaction.isDeleted})
          """.asUpdate
      )
    } yield ()

  def commitTransaction(transactionId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(transactionId)
      _ <- run(
        q"""UPDATE webknossos.organization_credit_transactions
          SET state = ${CreditTransactionState.Completed}, refundable_credit_change = 0::DECIMAL, updated_at = NOW()
          WHERE _id = $transactionId AND state
          """.asUpdate
      )
    } yield ()

  def refundTransaction(transactionId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(transactionId)
      transactionToRefund <- findOne(transactionId)
      refundComment = transactionToRefund._paidJob
        .map(jobId => s"Refund for failed job $jobId.")
        .getOrElse(s"Refund for transaction $transactionId.")
      setToRefunded = q"""UPDATE webknossos.organization_credit_transactions
          SET state = ${CreditTransactionState.Refunded}, updated_at = NOW()
          WHERE _id = $transactionId AND state = ${CreditTransactionState.Pending}
          AND credit_change < 0
          """.asUpdate
      insertRefundTransaction = q"""
        INSERT INTO webknossos.organization_credit_transactions
          (_id, _organization, credit_change, refundable_credit_change, refunded_transaction_id, comment, _paid_job, state)
        VALUES (
          ${ObjectId.generate},
          ${transactionToRefund._organization},
          (
            SELECT refundable_credit_change * -1
            FROM webknossos.organization_credit_transactions
            WHERE _id = $transactionId
              AND state = ${CreditTransactionState.Refunded}
              AND credit_change < 0
          ),
          0::DECIMAL,
          $transactionId,
          $refundComment,
          ${transactionToRefund._paidJob},
          ${CreditTransactionState.Completed}
        )
      """.asUpdate
      updatedRows <- run(DBIO.sequence(List(setToRefunded, insertRefundTransaction)).transactionally)
      _ <- bool2Fox(updatedRows.forall(_ == 1)) ?~> s"Failed to refund transaction ${transactionToRefund._id} properly."
    } yield ()

  def reduceRefundableCredits(transaction: CreditTransaction, amountToSubtract: BigDecimal): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.organization_credit_transactions
          SET refundable_credit_change = refundable_credit_change - $amountToSubtract, updated_at = NOW()
          WHERE _id = ${transaction._id}
          """.asUpdate)
    } yield ()

  def findTransactionForJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[CreditTransaction] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM $existingCollectionName WHERE _paid_job = $jobId AND $accessQuery"
          .as[OrganizationCreditTransactionsRow])
      parsed <- parseFirst(r, jobId)
    } yield parsed

// TODO: Maybe remove this outer while loop here.
  private def findAllOrganizationsWithExpiredCredits: Fox[List[String]] =
    for {
      r <- run(q"""SELECT DISTINCT _organization
        FROM webknossos.organization_credit_transactions
        WHERE expiration_date <= NOW()
        AND state = ${CreditTransactionState.Completed}
      AND credit_change > 0""".as[String])
    } yield r.toList

  private def revokeExpiredCreditsForOrganization(organizationId: String): Fox[Unit] =
    // TODO: Make this a transaction to have either all credits revoked of the organization or none
    for {
      transactionsWithExpiredCredits <- run(q"""SELECT *
            FROM webknossos.organization_credit_transactions
            WHERE _organization = $organizationId
              AND expiration_date <= NOW()
              AND state = 'Completed'
              AND credit_change > 0
            ORDER BY created_at DESC
         """.as[OrganizationCreditTransactionsRow])
      parsed <- parseAll(transactionsWithExpiredCredits)
      // TODO Warp in start transaction and commit transaction and on failure rollback
      _ <- Fox.serialCombined(parsed)(revokeExpiredCreditsTransaction)
    } yield ()

  // TODO: renaming this function
  private def revokeExpiredCreditsTransaction(transaction: CreditTransaction): Fox[(CreditTransaction, BigDecimal)] =
    for {
      // Sums up all spent credits since the transaction which are completed and subtracts refunded transactions.
      spentCreditsSinceTransactionNegResult <- run(q"""SELECT COALESCE(SUM(credit_change), 0)
              FROM webknossos.organization_credit_transactions
              WHERE _organization = ${transaction._organization}
                AND created_at > free_credits_transaction.created_at
                AND
                  (credit_change < 0 AND state = 'Completed')
                  OR
                  (credit_change > 0 AND state = 'Completed' AND refunded_transaction_id IS NOT NULL);
         """.as[BigDecimal])
      // Sums up all spent credits since the transaction which are already marked as completely spent.
      alreadySpentFreeTokensResult <- run(q"""SELECT COALESCE(SUM(credit_change), 0)
              FROM webknossos.organization_credit_transactions
              WHERE _organization = ${transaction._organization}
                AND created_at > free_credits_transaction.created_at
                AND credit_change > 0
                AND state = 'SPENT';
         """.as[BigDecimal])
      spentCreditsSinceTransactionNegative <- spentCreditsSinceTransactionNegResult.headOption.toFox
      alreadySpentFreeTokens <- alreadySpentFreeTokensResult.headOption.toFox
      spentCreditsSinceTransactionPositive = spentCreditsSinceTransactionNegative * -1
      freeCreditsAvailable = transaction.creditChange + alreadySpentFreeTokens
      creditsToRevoke <- if (spentCreditsSinceTransactionPositive >= freeCreditsAvailable) {
        // Fully spent, update state to 'SPENT', no need to increase revoked_credit_count
        for {
          _ <- run(q"""UPDATE webknossos.organization_credit_transactions
                SET state = ${CreditTransactionState.Spent}, updated_at = NOW()
                WHERE id = free_credits_transaction.id;
             """.asUpdate)
        } yield BigDecimal(0)
      } else {
        val amountToSubtractFromRefundableCredits = freeCreditsAvailable - spentCreditsSinceTransactionPositive
        for {
          leftOverCreditsToRevoke <- revokeRefundableCreditsFromPendingTransactions(
            amountToSubtractFromRefundableCredits,
            transaction)
          stateOfExpiredTransaction = if (leftOverCreditsToRevoke == transaction.creditChange)
            CreditTransactionState.Revoked
          else {
            if (leftOverCreditsToRevoke > 0) CreditTransactionState.PartiallyRevoked else CreditTransactionState.Spent
          }
          _ <- run(q"""UPDATE webknossos.organization_credit_transactions
                SET state = $stateOfExpiredTransaction, updated_at = NOW()
                WHERE id = free_credits_transaction.id;
             """.asUpdate)
          // TODO: All revoking should be done in a single transaction
          // Thus we only return the amount left over to be revoked and the transaction is self.
          /*
          revokingTransaction = CreditTransaction(ObjectId.generate,
                                                transaction._organization,
                                                -leftOverCreditsToRevoke,
                                                0,
                                                None,
            s"Revoked expired credits ",
                                                None,
                                                CreditTransactionState.Completed,
                                                None,
                                                Instant.now,
                                                Instant.now) */
        } yield leftOverCreditsToRevoke
      }

    } yield (transaction, creditsToRevoke)

  private def revokeRefundableCreditsFromPendingTransactions(amountToSubtract: BigDecimal,
                                                             transaction: CreditTransaction): Fox[BigDecimal] = {
    val pendingTransactionsSince = transaction.createdAt
    for {
      qualifiedTransactionsResult <- run(q"""SELECT *
            FROM webknossos.organization_credit_transactions
            WHERE _organization = ${transaction._organization}
              AND created_at > $pendingTransactionsSince
              AND credit_change < 0
              AND state = ${CreditTransactionState.Pending}
            ORDER BY created_at ASC
         """.as[OrganizationCreditTransactionsRow])
      qualifiedTransactions <- parseAll(qualifiedTransactionsResult)
      leftOverCredits <- Fox.foldLeft(qualifiedTransactions.iterator, amountToSubtract) {
        case (leftOverCreditsToRevoke, transaction) =>
          if (transaction.refundableCreditChange <= 0) {
            Fox.successful(leftOverCreditsToRevoke)
          } else {
            val creditsToSubtract = leftOverCreditsToRevoke.min(transaction.refundableCreditChange)
            for {
              _ <- reduceRefundableCredits(transaction, creditsToSubtract)
            } yield leftOverCreditsToRevoke - creditsToSubtract
          }

      }
    } yield leftOverCredits // Still left over credits to revoke
  }

  // TOOD: Send slack notification when revoking credits failed for an organization (send a summary of the failed organizations)
  def runRevokeExpiredCredits(): Fox[Unit] =
    for {
      _ <- run(q"CALL webknossos.revoke_expired_credits()".asUpdate)
    } yield ()
}
