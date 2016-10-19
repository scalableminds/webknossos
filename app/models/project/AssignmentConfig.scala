package models.project

import models.mturk.MTurkAssignmentConfig
import play.api.libs.json.{JsError, JsResult, _}

trait AssignmentConfig {
  def id: String

  def supportsChangeOfNumInstances: Boolean

  def asOpt[T] : Option[T]= {
    try{
      Some(this.asInstanceOf[T])
    } catch {
      case e: java.lang.ClassCastException =>
        None
    }
  }
}

object WebknossosAssignmentConfig extends AssignmentConfig{
  val id = "webknossos"

  def supportsChangeOfNumInstances = true

  val webknossosAssignmentConfigFormat =
    OFormat.apply[WebknossosAssignmentConfig.type](
      {_: JsValue => JsSuccess(WebknossosAssignmentConfig)},
      { _: WebknossosAssignmentConfig.type => Json.obj()}
    )
}

object AssignmentConfig{
  implicit object AssignmentConfigurationFormat extends Format[AssignmentConfig] {

    override def reads(json: JsValue): JsResult[AssignmentConfig] = (json \ "location").asOpt[String] match {
      case Some(MTurkAssignmentConfig.id)      =>
        MTurkAssignmentConfig.mturkAssignmentConfigFormat.reads(json)
      case Some(WebknossosAssignmentConfig.id) =>
        WebknossosAssignmentConfig.webknossosAssignmentConfigFormat.reads(json)
      case _                                   =>
        JsError("project.assignmentConfiguration.invalid")
    }

    override def writes(o: AssignmentConfig): JsValue = {
      o match {
        case WebknossosAssignmentConfig =>
          WebknossosAssignmentConfig.webknossosAssignmentConfigFormat.writes(WebknossosAssignmentConfig) ++
            Json.obj("location" -> WebknossosAssignmentConfig.id)
        case mturkConfig: MTurkAssignmentConfig =>
          MTurkAssignmentConfig.mturkAssignmentConfigFormat.writes(mturkConfig) ++
            Json.obj("location" -> MTurkAssignmentConfig.id)
      }
    }
  }
}
