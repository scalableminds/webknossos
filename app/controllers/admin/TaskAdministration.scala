package controllers.admin

import javax.inject.Inject

import controllers.Controller
import play.api.mvc.{AnyContent, MultipartFormData, Result}
import reactivemongo.bson.BSONObjectID

import scala.Array.canBuildFrom
import oxalis.security.AuthenticatedRequest
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.scalableminds.util.geometry.{Point3D, BoundingBox}
import models.task._
import models.user._
import models.binary.DataSetDAO
import play.api.data.Form
import play.api.data.Forms._
import views.html
import play.api.i18n.{MessagesApi, Messages}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Logger
import play.twirl.api.Html
import models.annotation.{AnnotationService, AnnotationDAO}
import scala.concurrent.Future
import oxalis.nml.NMLService
import play.api.libs.json.Json._
import play.api.libs.json._
import play.api.libs.functional.syntax._
import net.liftweb.common.{Box, Empty, Failure, Full}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.reactivemongo.DBAccessContext
import models.team.Team
import models.user.time.{TimeSpan, TimeSpanService}


