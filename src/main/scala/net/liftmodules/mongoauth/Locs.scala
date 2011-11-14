package net.liftmodules.mongoauth

import net.liftweb._
import common._
import http.{RedirectResponse, RedirectWithState, S, RedirectState}
import sitemap.{Loc, Menu}
import sitemap.Loc.{DispatchLocSnippets, EarlyResponse, If}

object Locs extends Locs
trait Locs {
  private lazy val userMeta = MongoAuth.authUserMeta.vend

  private lazy val indexUrl = MongoAuth.indexUrl.vend
  private lazy val loginUrl = MongoAuth.loginUrl.vend
  private lazy val logoutUrl = MongoAuth.logoutUrl.vend
  private lazy val loginTokenUrl = MongoAuth.loginTokenUrl.vend

  // redirects
  def RedirectToLoginWithReferrer = {
    val uri = S.uriAndQueryString
    RedirectWithState(loginUrl, RedirectState(() => { LoginRedirect.set(uri) }))
  }

  def RedirectToIndex = RedirectResponse(indexUrl)
  def RedirectToIndexWithCookies = RedirectResponse(indexUrl, S.responseCookies:_*)

  protected def DisplayError(message: String) = () =>
    RedirectWithState(indexUrl, RedirectState(() => S.error(message)))

  // Loc guards
  val RequireAuthentication = If(
    () => userMeta.isAuthenticated,
    () => RedirectToLoginWithReferrer)

  val RequireNoAuthentication = If(
    () => !userMeta.isAuthenticated,
    () => RedirectToIndex)

  val RequireLoggedIn = If(
    () => userMeta.isLoggedIn,
    () => RedirectToLoginWithReferrer)

  val RequireNotLoggedIn = If(
    () => !userMeta.isLoggedIn,
    () => RedirectToIndex)

  def HasRole(role: String) =
    If(() => userMeta.hasRole(role),
      DisplayError("You are the wrong role to access that resource."))

  def LacksRole(role: String) =
    If(() => userMeta.lacksRole(role),
      DisplayError("You lack the sufficient role to access that resource."))

  def HasPermission(permission: Permission) =
    If(() => userMeta.hasPermission(permission),
      DisplayError("Insufficient permissions to access that resource."))

  def LacksPermission(permission: Permission) =
    If(() => userMeta.lacksPermission(permission),
      DisplayError("Overqualified permissions to access that resource."))

  def HasAnyRoles(roles: Seq[String]) =
    If(() => userMeta.hasAnyRoles(roles),
       DisplayError("You are the wrong role to access that resource."))

  // Menus
  def buildLogoutMenu = Menu(Loc(
    "Logout",
    logoutUrl.split("/").filter(_.length > 0).toList,
    S.??("logout"), logoutLocParams
  ))

  protected def logoutLocParams = RequireLoggedIn ::
    EarlyResponse(() => {
      if (userMeta.isLoggedIn) { userMeta.logUserOut() }
      Full(RedirectToIndexWithCookies)
    }) :: Nil


  def buildLoginTokenMenu = Menu(Loc(
    "LoginToken", loginTokenUrl.split("/").filter(_.length > 0).toList,
    "LoginToken", loginTokenLocParams
  ))

  protected def loginTokenLocParams = RequireNotLoggedIn ::
    EarlyResponse(() => userMeta.handleLoginToken) :: Nil

}