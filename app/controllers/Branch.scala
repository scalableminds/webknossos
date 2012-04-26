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
  override val DefaultAccessRole = Role.User

  def list = Authenticated{ implicit request =>
      val points = request.user.branchPoints.map(_.matrix.value)
      Ok( toJson( points ) )
  }

  def clear = Authenticated{ implicit request =>
      User.save( request.user.copy( branchPoints = Nil ) )
      Ok
  }
}