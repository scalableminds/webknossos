package models.job

import com.scalableminds.util.objectid.ObjectId
import models.job.JobCommand.JobCommand
import models.job.JobState.JobState
import play.api.libs.json.JsObject

trait JobResultLinks {
  def args: JsObject
  def command: JobCommand
  def returnValue: Option[String]
  protected def id: ObjectId

  protected def effectiveState: JobState

  def datasetName: Option[String] = argAsStringOpt("dataset_name")

  def datasetId: Option[String] = argAsStringOpt("dataset_id")

  protected def argAsStringOpt(key: String): Option[String] = (args \ key).toOption.flatMap(_.asOpt[String])

  protected def argAsBooleanOpt(key: String): Option[Boolean] = (args \ key).toOption.flatMap(_.asOpt[Boolean])

  def constructResultLink(organizationId: String): Option[String] =
    if (effectiveState != JobState.SUCCESS) None
    else {
      command match {
        case JobCommand.convert_to_wkw | JobCommand.compute_mesh_file =>
          datasetId.map { datasetId =>
            val datasetNameMaybe = datasetName.map(name => s"$name-").getOrElse("")
            Some(s"/datasets/$datasetNameMaybe$datasetId/view")
          }.getOrElse(datasetName.map(name => s"datasets/$organizationId/$name/view"))
        case JobCommand.export_tiff | JobCommand.render_animation =>
          Some(s"/api/jobs/${this.id}/export")
        case JobCommand.infer_neurons if this.argAsBooleanOpt("do_evaluation").getOrElse(false) =>
          returnValue.map { resultAnnotationLink =>
            resultAnnotationLink
          }
        case JobCommand.infer_nuclei | JobCommand.infer_neurons | JobCommand.materialize_volume_annotation |
            JobCommand.infer_with_model | JobCommand.infer_mitochondria | JobCommand.align_sections |
            JobCommand.infer_instances =>
          // There exist jobs with dataset name as return value, some with directoryName, and newest with datasetId
          // Construct links that work in either case.
          returnValue.map { datasetIdentifier =>
            ObjectId
              .fromStringSync(datasetIdentifier)
              .map { asObjectId =>
                s"/datasets/$asObjectId/view"
              }
              .getOrElse(s"/datasets/$organizationId/$datasetIdentifier/view")
          }
        case _ => None
      }
    }

  def resultLinkPublic(organizationId: String, webknossosPublicUrl: String): Option[String] =
    for {
      resultLink <- constructResultLink(organizationId)
      resultLinkPublic = if (resultLink.startsWith("/")) s"$webknossosPublicUrl$resultLink"
      else s"$resultLink"
    } yield resultLinkPublic
}
