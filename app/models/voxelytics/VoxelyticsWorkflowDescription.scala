package models.voxelytics

import play.api.libs.json.{JsObject, JsValue, Json, OFormat}

case class VoxelyticsWorkflowDescriptionTaskConfig(config: JsValue,
                                                   inputs: JsValue,
                                                   description: Option[String],
                                                   distribution: JsValue,
                                                   output_paths: JsValue,
                                                   task: String)

case class VoxelyticsWorkflowDescriptionConfig(globalParameters: Map[String, JsValue],
                                               paths: List[String],
                                               schema_version: Option[String],
                                               tasks: Map[String, VoxelyticsWorkflowDescriptionTaskConfig]) {
  def withoutTasks(): JsValue =
    Json.obj("globalParameters" -> globalParameters, "paths" -> paths, "schema_version" -> schema_version)
}

case class VoxelyticsWorkflowDescriptionArtifact(path: String,
                                                 file_size: Long,
                                                 inode_count: Long,
                                                 version: String,
                                                 attributes: JsValue,
                                                 iframes: JsValue,
                                                 links: JsValue) {
  def metadata: JsObject =
    Json.obj("attributes" -> attributes, "iframes" -> iframes, "links" -> links)
}

case class VoxelyticsWorkflowDescriptionRun(name: String, user: String, hostname: String, voxelyticsVersion: String)

case class VoxelyticsWorkflowDescriptionWorkflow(name: String, hash: String, yamlContent: String)

case class VoxelyticsWorkflowDescription(config: VoxelyticsWorkflowDescriptionConfig,
                                         artifacts: Map[String, Map[String, VoxelyticsWorkflowDescriptionArtifact]],
                                         run: VoxelyticsWorkflowDescriptionRun,
                                         workflow: VoxelyticsWorkflowDescriptionWorkflow)

object VoxelyticsWorkflowDescriptionTaskConfig {
  implicit val jsonFormat: OFormat[VoxelyticsWorkflowDescriptionTaskConfig] =
    Json.format[VoxelyticsWorkflowDescriptionTaskConfig]
}

object VoxelyticsWorkflowDescriptionConfig {
  implicit val jsonFormat: OFormat[VoxelyticsWorkflowDescriptionConfig] =
    Json.format[VoxelyticsWorkflowDescriptionConfig]
}

object VoxelyticsWorkflowDescriptionArtifact {
  implicit val jsonFormat: OFormat[VoxelyticsWorkflowDescriptionArtifact] =
    Json.format[VoxelyticsWorkflowDescriptionArtifact]
}

object VoxelyticsWorkflowDescriptionRun {
  implicit val jsonFormat: OFormat[VoxelyticsWorkflowDescriptionRun] = Json.format[VoxelyticsWorkflowDescriptionRun]
}

object VoxelyticsWorkflowDescriptionWorkflow {
  implicit val jsonFormat: OFormat[VoxelyticsWorkflowDescriptionWorkflow] =
    Json.format[VoxelyticsWorkflowDescriptionWorkflow]
}

object VoxelyticsWorkflowDescription {
  implicit val jsonFormat: OFormat[VoxelyticsWorkflowDescription] = Json.format[VoxelyticsWorkflowDescription]
}
