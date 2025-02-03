package controllers

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.organization.{
  CreditTransaction,
  CreditTransactionDAO,
  CreditTransactionService,
  CreditTransactionState,
  OrganizationService
}
import models.user.UserService
import net.liftweb.common.Box.tryo
import play.api.mvc.{Action, AnyContent}
import play.silhouette.api.Silhouette
import security.WkEnv

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class CreditTransactionController @Inject()(organizationService: OrganizationService,
                                            creditTransactionService: CreditTransactionService,
                                            creditTransactionDAO: CreditTransactionDAO,
                                            userService: UserService,
                                            sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def chargeUpCredits(organizationId: String,
                      creditAmount: Int,
                      moneySpent: String,
                      comment: Option[String],
                      expiresAt: Option[String]): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- userService.assertIsSuperUser(request.identity) ?~> "Only super users can charge up credits"
      moneySpentInDecimal <- tryo(BigDecimal(moneySpent)) ?~> s"moneySpent $moneySpent is not a valid decimal"
      _ <- bool2Fox(moneySpentInDecimal > 0 || expiresAt.nonEmpty) ?~> "moneySpent must be a positive number"
      _ <- bool2Fox(creditAmount > 0) ?~> "creditAmount must be a positive number"
      commentNoOptional = comment.getOrElse(s"Charge up for $creditAmount credits for $moneySpent Euro.")
      _ <- organizationService.ensureOrganizationHasPaidPlan(organizationId)
      expirationDateOpt <- Fox.runOptional(expiresAt)(Instant.fromString)
      chargeUpTransaction = CreditTransaction(
        ObjectId.generate,
        organizationId,
        BigDecimal(creditAmount),
        BigDecimal(0), // Charge up transactions are not refundable per default and do not need a marker on how much refundable credits are left.
        None,
        Some(moneySpentInDecimal),
        commentNoOptional,
        None,
        CreditTransactionState.Completed,
        expirationDateOpt
      )
      _ <- creditTransactionService.doCreditTransaction(chargeUpTransaction)
    } yield Ok
  }

  def refundCreditTransaction(organizationId: String, transactionId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity) ?~> "Only super users can manually refund credits"
        transaction <- creditTransactionDAO.findOne(transactionId)
        _ <- bool2Fox(transaction._organization == organizationId) ?~> "Transaction is not for this organization"
        _ <- organizationService.ensureOrganizationHasPaidPlan(organizationId)
        _ <- creditTransactionDAO.refundTransaction(transaction._id)
      } yield Ok
    }

  def revokeExpiredCredits(): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- userService.assertIsSuperUser(request.identity) ?~> "Only super users can manually revoke expired credits"
      _ <- creditTransactionService.revokeExpiredCredits()
    } yield Ok
  }

}
