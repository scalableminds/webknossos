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

  def constructResultLink(organizationId: String): Option[String] =
    if (effectiveState != JobState.SUCCESS) None
    else {
      command match {
        case JobCommand.convert_to_wkw | JobCommand.compute_mesh_file =>
          datasetId.map { datasetId =>
            val datasetNameMaybe = datasetName.map(name => s"$name-").getOrElse("")
            Some(s"/datasets/$datasetNameMaybe$datasetId/view")
          }.getOrElse(datasetName.map(name => s"/datasets/$organizationId/$name/view"))
        case JobCommand.export_tiff | JobCommand.render_animation =>
          Some(s"/api/jobs/${this.id}/export")
        case JobCommand.infer_nuclei | JobCommand.infer_neurons | JobCommand.materialize_volume_annotation |
            JobCommand.infer_with_model | JobCommand.infer_mitochondria | JobCommand.align_sections |
            JobCommand.infer_instances | JobCommand.align =>
          returnValue.map(linkFromDatasetOrAnnotationReturnValue(_, organizationId))
        case _ => None
      }
    }

  // Newer jobs return the path (or url) of the annotation containing their result, which is already a link.
  // Older jobs returned a dataset name or a directoryName or a datasetId. Construct links that work in either case.
  private def linkFromDatasetOrAnnotationReturnValue(returnValue: String, organizationId: String): String =
    if (returnValue.startsWith("/") || returnValue.startsWith("http://") || returnValue.startsWith("https://"))
      returnValue
    else
      ObjectId
        .fromStringSync(returnValue)
        .map { asObjectId =>
          s"/datasets/$asObjectId/view"
        }
        .getOrElse(s"/datasets/$organizationId/$returnValue/view")

  def resultLinkPublic(organizationId: String, webknossosPublicUrl: String): Option[String] =
    for {
      resultLink <- constructResultLink(organizationId)
      resultLinkPublic =
        if (resultLink.startsWith("/")) s"$webknossosPublicUrl$resultLink"
        else s"$resultLink"
    } yield resultLinkPublic
}
