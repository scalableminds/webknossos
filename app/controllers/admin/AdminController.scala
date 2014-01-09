package controllers.admin

import oxalis.security.Secured
import models.security.RoleDAO
import controllers.Controller

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 28.10.13
 * Time: 16:02
 */
trait AdminController extends Controller with Secured {
  override val DefaultAccessRole = RoleDAO.Admin
}
