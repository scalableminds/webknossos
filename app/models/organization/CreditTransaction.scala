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
import telemetry.SlackNotificationService
import utils.WkConf
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

case class CreditTransaction(_id: ObjectId = ObjectId.generate,
                             _organization: String,
                             creditChange: BigDecimal,
                             refundableCreditChange: BigDecimal,
                             refundedTransactionId: Option[ObjectId] = None,
                             spentMoney: Option[BigDecimal],
                             comment: String,
                             _paidJob: Option[ObjectId],
                             state: TransactionState,
                             expirationDate: Option[Instant],
                             createdAt: Instant = Instant.now,
                             updatedAt: Instant = Instant.now,
                             isDeleted: Boolean = false)

class CreditTransactionDAO @Inject()(organizationDAO: OrganizationDAO,
                                     conf: WkConf,
                                     slackNotificationService: SlackNotificationService,
                                     sqlClient: SqlClient)(implicit ec: ExecutionContext)
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

  implicit val getOrganizationCreditTransactions: GetResult[CreditTransaction] = GetResult { prs =>
    import prs._
    val transactionId = <<[ObjectId]
    val organizationId = <<[String]
    val creditChange = <<[BigDecimal]
    val refundableCreditChange = <<[BigDecimal]
    val refundedTransactionId = <<?[ObjectId]
    val spentMoney = <<?[BigDecimal]
    val comment = <<[String]
    val paidJobId = <<?[ObjectId]
    val stateOpt = CreditTransactionState.fromString(<<[String])
    val state = stateOpt.getOrElse(throw new RuntimeException(s"Unknown credit transaction state: $stateOpt"))
    val expiresAt = <<?[Instant]
    val createdAt = <<[Instant]
    val updatedAt = <<[Instant]
    val isDeleted = <<[Boolean]
    CreditTransaction(
      transactionId,
      organizationId,
      creditChange,
      refundableCreditChange,
      refundedTransactionId,
      spentMoney,
      comment,
      paidJobId,
      state,
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
      _ <- readAccessQuery
      _ <- run(
        q"""INSERT INTO webknossos.organization_credit_transactions
          (_id, _organization, credit_change, refundable_credit_change, spent_money, comment, _paid_job,
          state, expiration_date, created_at, updated_at, is_deleted)
          VALUES
          (${transaction._id}, ${transaction._organization}, ${transaction.creditChange.toString()}::DECIMAL,
          ${transaction.refundableCreditChange.toString()}::DECIMAL, ${transaction.spentMoney.map(_.toString)}::DECIMAL,
          ${transaction.comment}, ${transaction._paidJob}, ${CreditTransactionState.Pending}, ${transaction.expirationDate},
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
      _ <- readAccessQuery
      _ <- run(q"""INSERT INTO webknossos.organization_credit_transactions
          (_id, _organization, credit_change, refundable_credit_change, refunded_transaction_id, spent_money, comment, _paid_job,
          state, expiration_date, created_at, updated_at, is_deleted)
          VALUES
          (${transaction._id}, ${transaction._organization}, ${transaction.creditChange.toString()}::DECIMAL,
          ${transaction.refundableCreditChange.toString()}::DECIMAL, ${transaction.refundedTransactionId},
          ${transaction.spentMoney.map(_.toString)}::DECIMAL, ${transaction.comment}, ${transaction._paidJob},
          ${transaction.state}, ${transaction.expirationDate}, ${transaction.createdAt}, ${transaction.updatedAt},
          ${transaction.isDeleted})
          """.asUpdate)

    } yield ()

  private def insertRevokingTransaction(transaction: CreditTransaction): DBIOAction[Int, NoStream, Effect] = {
    assert(transaction.state == CreditTransactionState.Completed)
    assert(transaction.refundableCreditChange == 0)
    assert(transaction.spentMoney.isEmpty)
    assert(transaction.creditChange < 0, "Revoking transactions must have a negative credit change")
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

  private def revokeExpiredCreditsForOrganization(organizationId: String): DBIO[List[CreditTransaction]] = {
    // TODO: Make this a transaction to have either all credits revoked of the organization or none
    logger.info(s"revokeExpiredCreditsForOrganization for organization $organizationId")

    for {
      transactionsWithExpiredCredits <- q"""SELECT *
            FROM webknossos.organization_credit_transactions
            WHERE _organization = $organizationId
              AND expiration_date <= NOW()
              AND state = 'Completed'
              AND credit_change > 0
            ORDER BY created_at DESC
         """.as[CreditTransaction]
      transactionsWhereRevokingFailed <- transactionsWithExpiredCredits.foldLeft(
        DBIO.successful(List()): DBIO[List[CreditTransaction]]) { (previousTransactionRevocation, transaction) =>
        previousTransactionRevocation.flatMap { transactionsWhereRevokingFailed =>
          revokeExpiredCreditsTransaction(transaction).asTry.flatMap {
            case Success(_) => DBIO.successful(transactionsWhereRevokingFailed)
            case Failure(e) =>
              logger.error(s"Failed to revoke some expired credits for organization ${transaction._organization}", e)
              DBIO.successful(transactionsWhereRevokingFailed :+ transaction)
            case _ => DBIO.successful(transactionsWhereRevokingFailed)
          }
        }
      }
    } yield transactionsWhereRevokingFailed
  }

  private def revokeExpiredCreditsTransaction(transaction: CreditTransaction): DBIO[Unit] = {
    logger.info(s"revokeExpiredCreditsTransaction for transaction ${transaction._id}")
    for {
      // Query: Sums up all spent credits since the transaction which are completed and subtracts refunded transactions.
      freeCreditsAvailableResult <- q"""
      SELECT COALESCE(SUM(credit_change), 0)
      FROM webknossos.organization_credit_transactions
      WHERE _organization = ${transaction._organization}
        AND created_at >= ${transaction.createdAt}
        AND (
		      credit_change < 0
          OR (credit_change > 0 AND refunded_transaction_id IS NOT NULL) -- Counts also revoked transactions
          OR (credit_change > 0 AND expiration_date <= NOW()) -- Counts also expired transactions
	      )
		""".as[BigDecimal]
      freeCreditsAvailable = freeCreditsAvailableResult.headOption.getOrElse(BigDecimal(0))

      _ <- if (freeCreditsAvailable <= 0) {
        // Fully spent, update state to 'Spent'
        q"""
        UPDATE webknossos.organization_credit_transactions
        SET state = ${CreditTransactionState.Spent}, updated_at = NOW()
        WHERE _id = ${transaction._id}
      """.asUpdate
      } else {
        val stateOfExpiredTransaction = if (freeCreditsAvailable == transaction.creditChange) {
          CreditTransactionState.Revoked
        } else { CreditTransactionState.PartiallyRevoked }
        val revokingTransaction = CreditTransaction(
          ObjectId.generate,
          transaction._organization,
          -freeCreditsAvailable,
          0,
          None,
          None,
          s"Revoked expired credits for transaction ${transaction._id}",
          None,
          CreditTransactionState.Completed,
          None,
        )
        for {
          _ <- q"""
            UPDATE webknossos.organization_credit_transactions
            SET state = $stateOfExpiredTransaction, updated_at = NOW()
            WHERE _id = ${transaction._id}
          """.asUpdate
          _ <- insertRevokingTransaction(revokingTransaction)
        } yield ()
      }
      _ = logger.info(s"revokeExpiredCreditsTransaction for transaction ${transaction._id} finished")
    } yield ()
  }

  def runRevokeExpiredCredits(): Fox[Unit] =
    for {
      orgas <- findAllOrganizationsWithExpiredCredits
      failedTransactionsToRevoke <- Fox.foldLeft(orgas.iterator, List(): List[CreditTransaction]) {
        case (failedTransactions, organizationId) =>
          run(revokeExpiredCreditsForOrganization(organizationId).transactionally).map(failedTransactions ++ _)
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
