package controllers

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.organization.{
  CreditState,
  CreditTransaction,
  CreditTransactionDAO,
  CreditTransactionService,
  CreditTransactionState,
  FreeCreditTransactionService,
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
                                            freeCreditTransactionService: FreeCreditTransactionService,
                                            creditTransactionDAO: CreditTransactionDAO,
                                            userService: UserService,
                                            sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def addCredits(organizationId: String,
                 creditAmount: Int,
                 moneySpent: String,
                 currency: String,
                 comment: Option[String],
                 expiresAt: Option[String]): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- userService.assertIsSuperUser(request.identity) ?~> "Only super users can add credits to an organization"
      moneySpentInDecimal <- tryo(BigDecimal(moneySpent)) ?~> s"moneySpent $moneySpent is not a valid decimal"
      _ <- bool2Fox(moneySpentInDecimal > 0) ?~> "moneySpent must be a positive number"
      _ <- bool2Fox(creditAmount > 0) ?~> "creditAmount must be a positive number"
      commentNoOptional = comment.getOrElse(s"Adding $creditAmount credits for $moneySpentInDecimal $currency.")
      _ <- organizationService.assertOrganizationHasPaidPlan(organizationId)
      expirationDateOpt <- Fox.runOptional(expiresAt)(Instant.fromString)
      _ <- Fox
        .runOptional(expirationDateOpt)(expirationDate => bool2Fox(!expirationDate.isPast)) ?~> "Expiration date must be in the future"
      addCreditsTransaction = CreditTransaction(
        ObjectId.generate,
        organizationId,
        None,
        None,
        BigDecimal(creditAmount),
        commentNoOptional,
        CreditTransactionState.Complete,
        CreditState.AddCredits,
        expirationDateOpt
      )
      _ <- creditTransactionService.insertCreditTransaction(addCreditsTransaction)
    } yield Ok
  }

  def refundCreditTransaction(organizationId: String, transactionId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity) ?~> "Only super users can manually refund credits"
        transaction <- creditTransactionDAO.findOne(transactionId)
        _ <- bool2Fox(transaction._organization == organizationId) ?~> "Transaction is not for this organization"
        _ <- organizationService.assertOrganizationHasPaidPlan(organizationId)
        _ <- creditTransactionDAO.refundTransaction(transaction._id)
      } yield Ok
    }

  def revokeExpiredCredits(): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- userService.assertIsSuperUser(request.identity) ?~> "Only super users can manually revoke expired credits"
      _ <- freeCreditTransactionService.revokeExpiredCredits()
    } yield Ok
  }

}
