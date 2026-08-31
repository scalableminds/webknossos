package models.voxelytics

import com.scalableminds.util.tools.AutoFormat
import play.api.libs.json.{JsObject, JsValue, Json}

case class WorkflowDescriptionTaskConfig(
    config: JsValue,
    inputs: JsValue,
    description: Option[String],
    distribution: JsValue,
    output_paths: JsValue,
    task: String
) derives AutoFormat

case class WorkflowDescriptionConfig(
    global_parameters: Map[String, JsValue],
    paths: List[String],
    schema_version: Option[Long],
    git_hash: Option[String],
    tasks: Map[String, WorkflowDescriptionTaskConfig]
) derives AutoFormat {
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
) derives AutoFormat {
  def metadataAsJson: JsObject =
    Json.obj("attributes" -> attributes, "iframes" -> iframes, "links" -> links)
}

case class WorkflowDescriptionRun(name: String, user: String, hostname: String, voxelyticsVersion: String)
    derives AutoFormat

case class WorkflowDescriptionWorkflow(name: String, hash: String, yamlContent: Option[String]) derives AutoFormat

case class WorkflowDescription(
    config: WorkflowDescriptionConfig,
    artifacts: Map[String, Map[String, WorkflowDescriptionArtifact]],
    run: WorkflowDescriptionRun,
    workflow: WorkflowDescriptionWorkflow
) derives AutoFormat
