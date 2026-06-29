package models.voxelytics

import play.api.libs.json.{JsObject, JsValue, Json, OFormat}

case class WorkflowDescriptionTaskConfig(
    config: JsValue,
    inputs: JsValue,
    description: Option[String],
    distribution: JsValue,
    output_paths: JsValue,
    task: String
)

case class WorkflowDescriptionConfig(
    global_parameters: Map[String, JsValue],
    paths: List[String],
    schema_version: Option[Long],
    git_hash: Option[String],
    tasks: Map[String, WorkflowDescriptionTaskConfig]
) {
  def asJsonWithoutTasks: JsValue =
    Json.obj("global_parameters" -> global_parameters, "paths" -> paths, "schema_version" -> schema_version)
}

case class WorkflowDescriptionArtifact(
    path: String,
    file_size: Long,
    inode_count: Long,
    version: String,
    attributes: JsValue,
    iframes: JsValue,
    links: JsValue
) {
  def metadataAsJson: JsObject =
    Json.obj("attributes" -> attributes, "iframes" -> iframes, "links" -> links)
}

case class WorkflowDescriptionRun(name: String, user: String, hostname: String, voxelyticsVersion: String)

case class WorkflowDescriptionWorkflow(name: String, hash: String, yamlContent: Option[String])

case class WorkflowDescription(
    config: WorkflowDescriptionConfig,
    artifacts: Map[String, Map[String, WorkflowDescriptionArtifact]],
    run: WorkflowDescriptionRun,
    workflow: WorkflowDescriptionWorkflow
)

object WorkflowDescriptionTaskConfig {
  implicit val jsonFormat: OFormat[WorkflowDescriptionTaskConfig] =
    Json.format[WorkflowDescriptionTaskConfig]
}

object WorkflowDescriptionConfig {
  implicit val jsonFormat: OFormat[WorkflowDescriptionConfig] =
    Json.format[WorkflowDescriptionConfig]
}

object WorkflowDescriptionArtifact {
  implicit val jsonFormat: OFormat[WorkflowDescriptionArtifact] =
    Json.format[WorkflowDescriptionArtifact]
}

object WorkflowDescriptionRun {
  implicit val jsonFormat: OFormat[WorkflowDescriptionRun] = Json.format[WorkflowDescriptionRun]
}

object WorkflowDescriptionWorkflow {
  implicit val jsonFormat: OFormat[WorkflowDescriptionWorkflow] =
    Json.format[WorkflowDescriptionWorkflow]
}

object WorkflowDescription {
  implicit val jsonFormat: OFormat[WorkflowDescription] = Json.format[WorkflowDescription]
}
