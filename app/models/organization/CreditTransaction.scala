package models.organization

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.CreditTransactionsRow
import com.scalableminds.webknossos.schema.Tables.CreditTransactions
import models.organization.CreditState.CreditState
import models.organization.CreditTransactionState.TransactionState
import slick.dbio.DBIO
import slick.jdbc.GetResult
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import telemetry.SlackNotificationService
import utils.WkConf
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

case class CreditTransaction(_id: ObjectId = ObjectId.generate,
                             _organization: String,
                             _relatedTransaction: Option[ObjectId] = None,
                             _paidJob: Option[ObjectId] = None,
                             creditChange: BigDecimal,
                             comment: String,
                             transactionState: TransactionState,
                             creditState: CreditState,
                             expirationDate: Option[Instant] = None,
                             createdAt: Instant = Instant.now,
                             updatedAt: Instant = Instant.now,
                             isDeleted: Boolean = false)

class CreditTransactionDAO @Inject()(organizationDAO: OrganizationDAO,
                                     conf: WkConf,
                                     slackNotificationService: SlackNotificationService,
                                     sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[CreditTransaction, CreditTransactionsRow, CreditTransactions](sqlClient) {

  protected val collection = CreditTransactions

  protected def idColumn(x: CreditTransactions): Rep[String] = x._Id

  override protected def isDeletedColumn(x: CreditTransactions): Rep[Boolean] = x.isDeleted

  override protected def parse(row: CreditTransactionsRow): Fox[CreditTransaction] =
    for {
      transactionState <- CreditTransactionState.fromString(row.transactionState).toFox
      creditState <- CreditState.fromString(row.creditState).toFox
      id <- ObjectId.fromString(row._Id)
      jobIdOpt <- Fox.runOptional(row._PaidJob)(ObjectId.fromStringSync)
      relatedTransactionOpt <- Fox.runOptional(row._RelatedTransaction)(ObjectId.fromStringSync)
    } yield {
      CreditTransaction(
        id,
        row._Organization,
        relatedTransactionOpt,
        jobIdOpt,
        row.creditChange,
        row.comment,
        transactionState,
        creditState,
        row.expirationDate.map(Instant.fromSql),
        Instant.fromSql(row.createdAt),
        Instant.fromSql(row.updatedAt),
        row.isDeleted
      )
    }

  implicit val getCreditTransactions: GetResult[CreditTransaction] = GetResult { prs =>
    import prs._
    val transactionId = <<[ObjectId]
    val organizationId = <<[String]
    val relatedTransaction = <<?[ObjectId]
    val paidJobId = <<?[ObjectId]
    val creditChange = <<[BigDecimal]
    val comment = <<[String]
    val transactionStateOpt = CreditTransactionState.fromString(<<[String])
    val transactionState = transactionStateOpt.getOrElse(
      throw new RuntimeException(s"Unknown credit transaction state: $transactionStateOpt"))
    val creditStateOpt = CreditState.fromString(<<[String])
    val creditState = creditStateOpt.getOrElse(throw new RuntimeException(s"Unknown credit state: $creditStateOpt"))
    val expiresAt = <<?[Instant]
    val createdAt = <<[Instant]
    val updatedAt = <<[Instant]
    val isDeleted = <<[Boolean]
    CreditTransaction(
      transactionId,
      organizationId,
      paidJobId,
      relatedTransaction,
      creditChange,
      comment,
      transactionState,
      creditState,
      expiresAt,
      createdAt,
      updatedAt,
      isDeleted
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
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery".as[CreditTransactionsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findOne(transactionId: String)(implicit ctx: DBAccessContext): Fox[CreditTransaction] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM $existingCollectionName WHERE _id = $transactionId AND $accessQuery"
          .as[CreditTransactionsRow])
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
      _ <- readAccessQuery
      _ <- run(
        q"""INSERT INTO webknossos.credit_transactions
          (_id, _organization, credit_change, comment, _paid_job,
          transaction_state, credit_state, expiration_date, created_at, updated_at, is_deleted)
          VALUES
          (${transaction._id}, ${transaction._organization}, ${transaction.creditChange.toString()}::DECIMAL,
          ${transaction.comment}, ${transaction._paidJob}, ${CreditTransactionState.Pending}, ${CreditState.Pending},
          ${transaction.expirationDate}, ${transaction.createdAt}, ${transaction.updatedAt}, ${transaction.isDeleted})
          """.asUpdate
      )
    } yield ()

  def addJobIdToTransaction(transaction: CreditTransaction, jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(transaction._id)
      _ <- run(
        q"""UPDATE webknossos.credit_transactions
          SET _paid_job = $jobId, updated_at = NOW()
          WHERE _id = ${transaction._id}
          """.asUpdate
      )
    } yield ()

  def insertTransaction(transaction: CreditTransaction)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- readAccessQuery
      _ <- run(q"""INSERT INTO webknossos.credit_transactions
          (_id, _organization, credit_change, _refunded_transaction_id, comment, _paid_job,
          transaction_state, credit_state, expiration_date, created_at, updated_at, is_deleted)
          VALUES
          (${transaction._id}, ${transaction._organization}, ${transaction.creditChange.toString()}::DECIMAL,
          ${transaction._relatedTransaction}, ${transaction.comment}, ${transaction._paidJob},
          ${transaction.transactionState}, ${transaction.creditState}, ${transaction.expirationDate},
          ${transaction.createdAt}, ${transaction.updatedAt}, ${transaction.isDeleted})
          """.asUpdate)

    } yield ()

  private def insertRevokingTransaction(transaction: CreditTransaction): DBIOAction[Int, NoStream, Effect] = {
    assert(transaction.transactionState == CreditTransactionState.Complete)
    assert(transaction.creditState == CreditState.Revoking)
    assert(transaction.creditChange < 0, "Revoking transactions must have a negative credit change")
    assert(transaction.expirationDate.isEmpty)
    q"""INSERT INTO webknossos.credit_transactions
          (_id, _organization, credit_change, comment, _paid_job,
          transaction_state, credit_state, expiration_date, created_at, updated_at, is_deleted)
          VALUES
          (${transaction._id}, ${transaction._organization}, ${transaction.creditChange.toString()}::DECIMAL,
          ${transaction.comment}, ${transaction._paidJob}, ${transaction.transactionState}, ${transaction.creditState},
          ${transaction.expirationDate}, ${transaction.createdAt}, ${transaction.updatedAt}, ${transaction.isDeleted})
          """.asUpdate
  }

  def commitTransaction(transactionId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(transactionId)
      _ <- run(
        q"""UPDATE webknossos.credit_transactions
          SET transaction_state = ${CreditTransactionState.Complete}, credit_state = ${CreditState.Spent}, updated_at = NOW()
          WHERE _id = $transactionId
          """.asUpdate
      )
    } yield ()

  def refundTransaction(transactionId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(transactionId)
      transactionToRefund <- findOne(transactionId)
      _ <- bool2Fox(transactionToRefund.transactionState == CreditTransactionState.Pending) ?~> "Can only refund pending transactions."
      refundComment = transactionToRefund._paidJob
        .map(jobId => s"Refund for failed job $jobId.")
        .getOrElse(s"Refund for transaction $transactionId.")
      insertRefundTransaction = q"""
        INSERT INTO webknossos.credit_transactions
          (_id, _organization, _related_transaction, credit_change, comment, transaction_state, credit_state)
        VALUES (
          ${ObjectId.generate},
          ${transactionToRefund._organization},
          $transactionId,
          (
            SELECT credit_change * -1
            FROM webknossos.credit_transactions
            WHERE _id = $transactionId
              AND transaction_state = ${CreditTransactionState.Pending}
              AND credit_state = ${CreditState.Pending}
              AND credit_change < 0
          ),
          0::DECIMAL,
          $refundComment,
          ${CreditTransactionState.Complete},
          ${CreditState.Refunding}
        )
      """.asUpdate
      setToRefunded = q"""UPDATE webknossos.credit_transactions
          SET transaction_state = ${CreditTransactionState.Complete}, credit_state = ${CreditState.Refunded}, updated_at = NOW()
          WHERE _id = $transactionId AND state = ${CreditTransactionState.Pending}
          AND credit_change < 0
          """.asUpdate
      updatedRows <- run(DBIO.sequence(List(insertRefundTransaction, setToRefunded)).transactionally)
      _ <- bool2Fox(updatedRows.forall(_ == 1)) ?~> s"Failed to refund transaction ${transactionToRefund._id} properly."
    } yield ()

  def findTransactionForJob(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[CreditTransaction] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM $existingCollectionName WHERE _paid_job = $jobId AND $accessQuery"
          .as[CreditTransactionsRow])
      parsed <- parseFirst(r, jobId)
    } yield parsed

  private def findAllOrganizationsWithExpiredCredits: Fox[List[ObjectId]] =
    for {
      r <- run(q"""SELECT DISTINCT _organization
        FROM webknossos.credit_transactions
        WHERE expiration_date <= NOW()
        AND credit_state = ${CreditState.Pending}
        AND credit_change > 0""".as[ObjectId])
    } yield r.toList

  private def revokeExpiredCreditsForOrganizationQuery(organizationId: ObjectId): DBIO[List[CreditTransaction]] =
    for {
      transactionsWithExpiredCredits <- q"""SELECT *
            FROM webknossos.credit_transactions
            WHERE _organization = $organizationId
              AND expiration_date <= NOW()
              AND credit_state = ${CreditState.Pending}
              AND credit_change > 0
            ORDER BY created_at DESC
         """.as[CreditTransaction]
      transactionsWhereRevokingFailed <- transactionsWithExpiredCredits.foldLeft(
        DBIO.successful(List()): DBIO[List[CreditTransaction]]) { (previousTransactionRevocationQueries, transaction) =>
        for {
          transactionsWhereRevokingFailed <- previousTransactionRevocationQueries
          revokeExpiredCreditsTransaction <- revokeExpiredCreditsTransactionQuery(transaction).asTry
          transactionsWhereRevokingFailedAfterRevoking <- revokeExpiredCreditsTransaction match {
            case Success(_) => DBIO.successful(transactionsWhereRevokingFailed)
            case Failure(e) =>
              logger.error(s"Failed to revoke some expired credits for organization ${transaction._organization}", e)
              DBIO.successful(transactionsWhereRevokingFailed :+ transaction)
            case _ => DBIO.successful(transactionsWhereRevokingFailed)
          }
        } yield transactionsWhereRevokingFailedAfterRevoking
      }
    } yield transactionsWhereRevokingFailed

  private def revokeExpiredCreditsTransactionQuery(transaction: CreditTransaction): DBIO[Unit] =
    for {
      // Query: Sums up all spent credits since the transaction which are completed and subtracts refunded transactions.
      freeCreditsAvailableResult <- q"""
      SELECT COALESCE(SUM(credit_change), 0)
      FROM webknossos.credit_transactions
      WHERE _organization = ${transaction._organization}
        AND created_at >= ${transaction.createdAt}
        AND (
		      credit_change < 0
          OR (credit_change > 0 AND _related_transaction IS NOT NULL AND credit_state = 'Refunding') -- Counts refunding transactions
          OR (credit_change > 0 AND expiration_date <= NOW()) -- Counts also expired transactions
	      )
		""".as[BigDecimal]
      freeCreditsAvailable = freeCreditsAvailableResult.headOption.getOrElse(BigDecimal(0))

      _ <- if (freeCreditsAvailable <= 0) {
        // Fully spent, update state to 'Spent'
        q"""
        UPDATE webknossos.credit_transactions
        SET credit_state = ${CreditState.Spent}, updated_at = NOW()
        WHERE _id = ${transaction._id}
      """.asUpdate
      } else {
        val creditStateOfExpiredTransaction = if (freeCreditsAvailable == transaction.creditChange) {
          CreditState.Revoked
        } else { CreditState.PartiallyRevoked }
        val revokingTransaction = CreditTransaction(
          ObjectId.generate,
          transaction._organization,
          Some(transaction._id),
          None,
          -freeCreditsAvailable,
          s"Revoked expired credits for transaction ${transaction._id}",
          CreditTransactionState.Complete,
          CreditState.Revoking,
        )
        for {
          _ <- q"""
            UPDATE webknossos.credit_transactions
            SET state = $creditStateOfExpiredTransaction, updated_at = NOW()
            WHERE _id = ${transaction._id}
          """.asUpdate
          _ <- insertRevokingTransaction(revokingTransaction)
        } yield ()
      }
      _ = logger.info(s"revokeExpiredCreditsTransactionQuery for transaction ${transaction._id} finished")
    } yield ()

  def runRevokeExpiredCredits(): Fox[Unit] =
    for {
      orgas <- findAllOrganizationsWithExpiredCredits
      failedTransactionsToRevoke <- Fox.foldLeft(orgas.iterator, List(): List[CreditTransaction]) {
        case (failedTransactions, organizationId) =>
          run(revokeExpiredCreditsForOrganizationQuery(organizationId).transactionally).map(failedTransactions ++ _)
      }
      _ = if (failedTransactionsToRevoke.nonEmpty) {
        val failedTransactions = failedTransactionsToRevoke.map(transaction =>
          s"Failed to revoke credits for transaction ${transaction._id} for organization ${transaction._organization}.")
        slackNotificationService.warn("Failed to revoke some expired credits for organizations",
                                      s"${failedTransactions.mkString("\n")}")
      }
    } yield ()

  def handOutMonthlyFreeCredits(): Fox[Unit] =
    run(q"SELECT webknossos.hand_out_monthly_free_credits(${conf.Jobs.monthlyFreeCredits}::DECIMAL)".as[Unit]).map(_ =>
      ())
}
