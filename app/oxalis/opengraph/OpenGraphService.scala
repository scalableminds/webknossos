package oxalis.opengraph

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.Category
import com.typesafe.scalalogging.LazyLogging
import models.binary.{DataSetDAO, DataSetDataLayerDAO}
import models.organization.OrganizationDAO
import models.voxelytics.VoxelyticsDAO
import net.liftweb.common.Full
import utils.WkConf

import scala.concurrent.ExecutionContext

case class OpenGraphTags(
    title: Option[String],
    description: Option[String],
    image: Option[String]
)

object OpenGraphTags {
  def default: OpenGraphTags = OpenGraphTags(
    Some("WEBKNOSSOS"),
    None,
    None
  )
}

class OpenGraphService @Inject()(voxelyticsDAO: VoxelyticsDAO,
                                 dataSetDAO: DataSetDAO,
                                 organizationDAO: OrganizationDAO,
                                 dataSetDataLayerDAO: DataSetDataLayerDAO,
                                 conf: WkConf)
    extends LazyLogging {

  def getOpenGraphTags(uriPath: String)(implicit ec: ExecutionContext): Fox[OpenGraphTags] = {
    logger.info(s"uriPath is $uriPath")

    val tagsFox = if (isDatasetViewUri(uriPath)) {
      datasetOpenGraphTags(uriPath)
    } else if (isAnnotationViewUri(uriPath)) {
      annotationOpenGraphTags(uriPath)
    } else if (isWorkflowViewUri(uriPath)) {
      workflowOpenGraphTags(uriPath)
    } else Fox.successful(OpenGraphTags.default)

    // In any error case, fall back to default, so the html template does not break
    for {
      tagsBox <- tagsFox.futureBox
      tags = tagsBox match {
        case Full(tags) => tags
        case _          => OpenGraphTags.default
      }
    } yield tags
  }

  private val datasetRoute1Regex = "^/datasets/([^/^#]+)/([^/^#]+)/view".r
  private val datasetRoute2Regex = "^/datasets/([^/^#]+)/([^/^#]+)".r

  private val workflowRouteRegex = "^/workflows/([^/^#]+)".r

  private def isDatasetViewUri(uriPath: String): Boolean =
    uriPath match {
      case datasetRoute1Regex(_, _) => true
      case datasetRoute2Regex(_, _) => true
      case _                        => false
    }

  private def isAnnotationViewUri(uriPath: String): Boolean = false

  private def isWorkflowViewUri(uriPath: String): Boolean =
    uriPath match {
      case workflowRouteRegex(_) => true
      case _                     => false
    }

  private def datasetOpenGraphTags(uriPath: String)(implicit ec: ExecutionContext): Fox[OpenGraphTags] =
    uriPath match {
      case datasetRoute1Regex(organizationName, datasetName) =>
        datasetOpenGraphTagsWithOrganizationName(organizationName, datasetName)
      case datasetRoute2Regex(organizationName, datasetName) =>
        datasetOpenGraphTagsWithOrganizationName(organizationName, datasetName)
      case _ => Fox.successful(OpenGraphTags.default)
    }

  private def datasetOpenGraphTagsWithOrganizationName(organizationName: String, datasetName: String) =
    for {
      dataset <- dataSetDAO.findOneByNameAndOrganizationName(datasetName, organizationName)(GlobalAccessContext)
      layers <- dataSetDataLayerDAO.findAllForDataSet(dataset._id)
      layerOpt = layers.find(_.category == Category.color)
      organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext)
    } yield
      OpenGraphTags(
        Some(s"${dataset.displayName.getOrElse(datasetName)} | WEBKNOSSOS"),
        Some(s"View this dataset of organization ${organization.displayName} in WEBKNOSSOS"),
        layerOpt match {
          case Some(layer) if dataset.isPublic =>
            Some(s"${conf.Http.uri}/api/datasets/$organizationName/$datasetName/layers/${layer.name}/thumbnail")
          case _ => None
        }
      )

  private def annotationOpenGraphTags(uriPath: String): Fox[OpenGraphTags] = ???

  private def workflowOpenGraphTags(uriPath: String): Fox[OpenGraphTags] =
    uriPath match {
      case workflowRouteRegex(workflowHash: String) =>
        for {
          workflow <- voxelyticsDAO.findWorkflowByHash(workflowHash)
        } yield OpenGraphTags(Some(f"${workflow.name} | WEBKNOSSOS"), Some("Voxelytics Workflow Report"), None)
    }
}
