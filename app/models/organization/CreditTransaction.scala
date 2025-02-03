package models.organization

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.OrganizationCreditTransactionsRow
import com.scalableminds.webknossos.schema.Tables.OrganizationCreditTransactions
import models.organization.CreditTransactionState.TransactionState
import slick.dbio.DBIO
import slick.jdbc.GetResult
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import slick.sql.SqlAction
import telemetry.SlackNotificationService
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

case class CreditTransaction(_id: ObjectId = ObjectId.generate,
                             _organization: String,
                             creditChange: BigDecimal,
                             refundableCreditChange: BigDecimal,
                             refunded_transaction_id: Option[ObjectId] = None,
                             spentMoney: Option[BigDecimal],
                             comment: String,
                             _paidJob: Option[ObjectId],
                             state: TransactionState,
                             expirationDate: Option[Instant],
                             createdAt: Instant = Instant.now,
                             updatedAt: Instant = Instant.now,
                             isDeleted: Boolean = false)

class CreditTransactionDAO @Inject()(slackNotificationService: SlackNotificationService, sqlClient: SqlClient)(
    implicit ec: ExecutionContext)
    extends SQLDAO[CreditTransaction, OrganizationCreditTransactionsRow, OrganizationCreditTransactions](sqlClient) {

  protected val collection = OrganizationCreditTransactions

  protected def idColumn(x: OrganizationCreditTransactions): Rep[String] = x._Id

  override protected def isDeletedColumn(x: OrganizationCreditTransactions): Rep[Boolean] = x.isDeleted

  override protected def parse(row: OrganizationCreditTransactionsRow): Fox[CreditTransaction] =
    for {
      state <- CreditTransactionState.fromString(row.state).toFox
      id <- ObjectId.fromString(row._Id)
      jobIdOpt <- Fox.runOptional(row._PaidJob)(ObjectId.fromStringSync)
      refundedTransactionIdOpt <- Fox.runOptional(row.refundedTransactionId)(ObjectId.fromStringSync)
    } yield {
      CreditTransaction(
        id,
        row._Organization,
        row.creditChange,
        row.refundableCreditChange,
        refundedTransactionIdOpt,
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

  implicit val getOrganizationCreditTransactions: GetResult[CreditTransaction] = GetResult(r => {
    CreditTransaction(
      ObjectId.fromStringSync(r.nextString).getOrElse(throw new RuntimeException(s"Invalid CreditTransaction id")),
      r.nextString,
      r.nextBigDecimal,
      r.nextBigDecimal,
      r.nextStringOption
        .map(ObjectId.fromStringSync)
        .getOrElse(throw new RuntimeException(s"Invalid CreditTransaction id")),
      r.nextBigDecimalOption,
      r.nextString,
      r.nextStringOption
        .map(ObjectId.fromStringSync)
        .getOrElse(throw new RuntimeException(s"Invalid CreditTransaction jobId")),
      CreditTransactionState
        .fromString(r.nextString)
        .getOrElse(throw new RuntimeException(s"Invalid CreditTransaction state")),
      r.nextDateOption.map(Instant.fromDate),
      Instant.fromSql(r.nextTimestamp),
      Instant.fromSql(r.nextTimestamp),
      r.nextBoolean
    )
  })

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
      _ <- run(q"""INSERT INTO webknossos.organization_credit_transactions
          (_id, _organization, credit_change, refundable_credit_change, spent_money, comment, _paid_job,
          state, expiration_date, created_at, updated_at, is_deleted)
          VALUES
          (${transaction._id}, ${transaction._organization}, ${transaction.creditChange.toString()}::DECIMAL,
          ${transaction.refundableCreditChange.toString()}::DECIMAL, ${transaction.spentMoney.map(_.toString)}::DECIMAL,
          ${transaction.comment}, ${transaction._paidJob}, ${transaction.state}, ${transaction.expirationDate},
          ${transaction.createdAt}, ${transaction.updatedAt}, ${transaction.isDeleted})
          """.asUpdate)

    } yield ()

  private def insertRevokingTransaction(transaction: CreditTransaction): DBIOAction[Int, NoStream, Effect] = {
    assert(transaction.state == CreditTransactionState.Completed)
    assert(transaction.refundableCreditChange == 0)
    assert(transaction.spentMoney.isEmpty)
    assert(transaction.creditChange >= 0)
    assert(transaction.expirationDate.isEmpty)
    q"""INSERT INTO webknossos.organization_credit_transactions
          (_id, _organization, credit_change, refundable_credit_change, spent_money, comment, _paid_job,
          state, expiration_date, created_at, updated_at, is_deleted)
          VALUES
          (${transaction._id}, ${transaction._organization}, ${transaction.creditChange.toString()}::DECIMAL,
          ${transaction.refundableCreditChange.toString()}::DECIMAL, ${transaction.spentMoney.map(_.toString)}::DECIMAL,
          ${transaction.comment}, ${transaction._paidJob}, ${transaction.state}, ${transaction.expirationDate},
          ${transaction.createdAt}, ${transaction.updatedAt}, ${transaction.isDeleted})
          """.asUpdate
  }

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

  def reduceRefundableCredits(transaction: CreditTransaction,
                              amountToSubtract: BigDecimal): SqlAction[Int, NoStream, Effect] =
    q"""UPDATE webknossos.organization_credit_transactions
          SET refundable_credit_change = refundable_credit_change - ${amountToSubtract.toString()}::DECIMAL,
            updated_at = NOW()
          WHERE _id = ${transaction._id}
          """.asUpdate

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

  private def revokeExpiredCreditsForOrganization(organizationId: String): Fox[List[CreditTransaction]] = {
    // TODO: Make this a transaction to have either all credits revoked of the organization or none
    var transactionsWhereRevokingFailed: List[CreditTransaction] = List()

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
      _ <- run(DBIO.sequence(parsed.map(transaction =>
        revokeExpiredCreditsTransaction(transaction).asTry.transactionally.flatMap {
          case Success(_) => DBIO.successful(())
          case Failure(e) =>
            transactionsWhereRevokingFailed = transactionsWhereRevokingFailed :+ transaction
            logger.error(s"Failed to revoke some expired credits for organizations ${transaction._organization}", e)
            DBIO.successful(())
      })))
    } yield transactionsWhereRevokingFailed
  }

  // TODO: renaming this function
  private def revokeExpiredCreditsTransaction(transaction: CreditTransaction): DBIO[Unit] =
    for {
      // Query: Sums up all spent credits since the transaction which are completed and subtracts refunded transactions.
      spentCreditsSinceTransactionNegResult <- q"""
      SELECT COALESCE(SUM(credit_change), 0)
      FROM webknossos.organization_credit_transactions
      WHERE _organization = ${transaction._organization}
        AND created_at > ${transaction.createdAt}
        AND (
          (credit_change < 0 AND state = 'Completed')
          OR
          (credit_change > 0 AND state = 'Completed' AND refunded_transaction_id IS NOT NULL)
        )
    """.as[BigDecimal]

      // Query: Sums up all spent credits since the transaction which are already marked as completely spent.
      alreadySpentFreeTokensResult <- q"""
      SELECT COALESCE(SUM(credit_change), 0)
      FROM webknossos.organization_credit_transactions
      WHERE _organization = ${transaction._organization}
        AND created_at > ${transaction.createdAt}
        AND credit_change > 0
        AND state = 'SPENT'
    """.as[BigDecimal]

      // Extract values from query results
      spentCreditsSinceTransactionNegative = spentCreditsSinceTransactionNegResult.headOption.getOrElse(BigDecimal(0))
      alreadySpentFreeTokens = alreadySpentFreeTokensResult.headOption.getOrElse(BigDecimal(0))
      spentCreditsSinceTransactionPositive = spentCreditsSinceTransactionNegative * -1
      freeCreditsAvailable = transaction.creditChange + alreadySpentFreeTokens

      _ = if (spentCreditsSinceTransactionPositive >= freeCreditsAvailable) {
        // Fully spent, update state to 'SPENT'
        q"""
        UPDATE webknossos.organization_credit_transactions
        SET state = ${CreditTransactionState.Spent}, updated_at = NOW()
        WHERE _id = ${transaction._id}
      """.asUpdate
      } else {
        val amountToSubtractFromRefundableCredits = freeCreditsAvailable - spentCreditsSinceTransactionPositive
        revokeRefundableCreditsFromPendingTransactions(amountToSubtractFromRefundableCredits, transaction).flatMap {
          leftOverCreditsToRevoke =>
            val stateOfExpiredTransaction =
              if (leftOverCreditsToRevoke == transaction.creditChange) CreditTransactionState.Revoked
              else if (leftOverCreditsToRevoke > 0) CreditTransactionState.PartiallyRevoked
              else CreditTransactionState.Spent

            val updateTransactionStateQuery = q"""
            UPDATE webknossos.organization_credit_transactions
            SET state = $stateOfExpiredTransaction, updated_at = NOW()
            WHERE _id = ${transaction._id}
          """.asUpdate
            val insertRevokedTransactionQuery = if (leftOverCreditsToRevoke > 0) {
              val revokingTransaction = CreditTransaction(
                ObjectId.generate,
                transaction._organization,
                leftOverCreditsToRevoke,
                0,
                None,
                None,
                s"Revoked expired credits for transaction ${transaction._id}",
                None,
                CreditTransactionState.Completed,
                None,
                Instant.now,
                Instant.now
              )
              insertRevokingTransaction(revokingTransaction)
            } else {
              DBIO.successful(0)
            }
            DBIO.sequence(Seq(updateTransactionStateQuery, insertRevokedTransactionQuery))
        }
      }
    } yield ()

  private def revokeRefundableCreditsFromPendingTransactions(
      amountToSubtract: BigDecimal,
      transaction: CreditTransaction
  ): DBIO[BigDecimal] = {

    val pendingTransactionsSince = transaction.createdAt
    for {
      // Fetch transactions that are pending and eligible for refundable credit reduction
      qualifiedTransactions <- q"""
      SELECT *
      FROM webknossos.organization_credit_transactions
      WHERE _organization = ${transaction._organization}
        AND created_at > $pendingTransactionsSince
        AND credit_change < 0
        AND state = ${CreditTransactionState.Pending}
      ORDER BY created_at ASC
    """.as[CreditTransaction]

      // Iterate over transactions and subtract refundable credits
      leftOverCredits <- qualifiedTransactions.foldLeft(DBIO.successful(amountToSubtract)) {
        (leftOverCreditsToRevokeDBIO, transaction) =>
          leftOverCreditsToRevokeDBIO.flatMap { leftOverCreditsToRevoke =>
            if (transaction.refundableCreditChange <= 0) {
              DBIO.successful(leftOverCreditsToRevoke) // Skip if no refundable credits
            } else {
              val creditsToSubtract = leftOverCreditsToRevoke.min(transaction.refundableCreditChange)
              reduceRefundableCredits(transaction, creditsToSubtract).map(_ =>
                leftOverCreditsToRevoke - creditsToSubtract) // Subtract from leftOverCredits
            }
          }
      }
    } yield leftOverCredits
  }

  def runRevokeExpiredCredits(): Fox[Unit] =
    for {
      orgas <- findAllOrganizationsWithExpiredCredits
      failedTransactionsToRevoke <- Fox.foldLeft(orgas.iterator, List(): List[CreditTransaction]) {
        case (failedTransactions, organizationId) =>
          revokeExpiredCreditsForOrganization(organizationId).map(failedTransactions ++ _)
      }
      _ = if (failedTransactionsToRevoke.nonEmpty) {
        val failedTransactions = failedTransactionsToRevoke.map(transaction =>
          s"Failed to revoke credits for transaction ${transaction._id} for organization ${transaction._organization}.")
        slackNotificationService.warn("Failed to revoke some expired credits for organizations",
                                      s"${failedTransactions.mkString("\n")}")
      }
    } yield ()
}
