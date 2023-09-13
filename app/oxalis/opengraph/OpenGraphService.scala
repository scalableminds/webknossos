package oxalis.opengraph

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayerLike}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationDAO
import models.binary.{DataSet, DataSetDAO, DataSetDataLayerDAO}
import models.organization.{Organization, OrganizationDAO}
import models.voxelytics.VoxelyticsDAO
import net.liftweb.common.Full
import utils.{ObjectId, WkConf}

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
                                 annotationDAO: AnnotationDAO,
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

  private val annotationRouteRegex = "^/annotations/([^/^#]+)".r

  private def isDatasetViewUri(uriPath: String): Boolean =
    uriPath match {
      case datasetRoute1Regex(_, _) => true
      case datasetRoute2Regex(_, _) => true
      case _                        => false
    }

  private def isAnnotationViewUri(uriPath: String): Boolean =
    uriPath match {
      case annotationRouteRegex(_) => true
      case _                       => false
    }

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
        thumbnailUri(dataset, layerOpt, organization)
      )

  private def annotationOpenGraphTags(uriPath: String)(implicit ec: ExecutionContext): Fox[OpenGraphTags] =
    uriPath match {
      case annotationRouteRegex(annotationId) =>
        for {
          annotationIdValidated <- ObjectId.fromString(annotationId)
          annotation <- annotationDAO.findOne(annotationIdValidated)(GlobalAccessContext)
          dataset: DataSet <- dataSetDAO.findOne(annotation._dataSet)(GlobalAccessContext)
          organization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext)
          layers <- dataSetDataLayerDAO.findAllForDataSet(dataset._id)
          layerOpt = layers.find(_.category == Category.color)
        } yield
          OpenGraphTags(
            Some(s"${annotation.nameOpt.orElse(dataset.displayName).getOrElse(dataset.name)} | WEBKNOSSOS"),
            Some(s"Annotation on dataset ${dataset.displayName.getOrElse(dataset.name)} in WEBKNOSSOS"),
            thumbnailUri(dataset, layerOpt, organization)
          )
      case _ => Fox.successful(OpenGraphTags.default)
    }

  private def thumbnailUri(dataset: DataSet,
                           layerOpt: Option[DataLayerLike],
                           organization: Organization): Option[String] =
    layerOpt match {
      case Some(layer) if dataset.isPublic =>
        Some(s"${conf.Http.uri}/api/datasets/${organization.name}/${dataset.name}/layers/${layer.name}/thumbnail")
      case _ => None
    }

  private def workflowOpenGraphTags(uriPath: String): Fox[OpenGraphTags] =
    uriPath match {
      case workflowRouteRegex(workflowHash: String) =>
        for {
          workflow <- voxelyticsDAO.findWorkflowByHash(workflowHash)
        } yield OpenGraphTags(Some(f"${workflow.name} | WEBKNOSSOS"), Some("Voxelytics Workflow Report"), None)
    }
}
