package controllers

import brainflight.security.Secured
import play.api.mvc.Controller
import models.User
import models.TransformationMatrix
import models.Role
import models.Permission
import brainflight.tools.ExtendedTypes._
import play.api.mvc.Action
import play.api.mvc.Request
import play.api.libs.json.Json._
import play.api.libs.json._
import models.TrackedRoute

object Branch extends Controller with Secured {
  override val DefaultAccessRole = Role( "user" )

  def list = Authenticated() { user =>
    implicit request =>
      val points: List[List[Float]] = user.branchPoints.map(_.value)
      Ok( toJson( points ) )
  }

  def clear = Authenticated() { user =>
    implicit request =>
      User.save( user.copy( branchPoints = Nil ) )
      Ok
  }
}