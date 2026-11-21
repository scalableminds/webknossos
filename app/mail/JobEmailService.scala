package mail

import com.scalableminds.util.accesscontext.GlobalAccessContext
import models.job.{Job, JobCommand}
import models.user.{MultiUserDAO, User}

import javax.inject.Inject

// Tells the owner of a job that it succeeded or failed.
class JobEmailService @Inject() (
    multiUserDAO: MultiUserDAO,
    defaultMails: DefaultMails,
    mailSender: MailSender
) {

  def sendJobSucceededEmail(owner: User, job: Job, resultLink: String): Unit =
    mailSender.inBackground(s"job ${job._id} succeeded") {
      for {
        multiUser <- multiUserDAO.findOne(owner._multiUser)(using GlobalAccessContext)
        datasetName = job.datasetNameForEmail.getOrElse("")
        genericEmailTemplate = defaultMails.jobSuccessfulGenericMail(multiUser, datasetName, resultLink, _, _)
        emailTemplate = job.command match {
          case JobCommand.convert_to_wkw =>
            Some(defaultMails.jobSuccessfulUploadConvertMail(multiUser, datasetName, resultLink))
          case JobCommand.export_tiff =>
            Some(
              genericEmailTemplate(
                "TIFF / OME-Zarr Export",
                "Your data export is ready for download."
              )
            )
          case JobCommand.infer_neurons =>
            Some(defaultMails.jobSuccessfulNeuronSegmentationMail(multiUser, datasetName, resultLink))
          case JobCommand.infer_instances =>
            Some(
              genericEmailTemplate(
                "Instance Segmentation",
                "Your instance segmentation is ready."
              )
            )
          case JobCommand.infer_mitochondria =>
            Some(defaultMails.jobSuccessfulMitoSegmentationMail(multiUser, datasetName, resultLink))
          case JobCommand.align_sections =>
            Some(defaultMails.jobSuccessfulAlignmentMail(multiUser, datasetName, resultLink))
          case JobCommand.align =>
            Some(
              genericEmailTemplate(
                "Alignment",
                "Your alignment project job has finished. The result is available as a new dataset in your dashboard."
              )
            )
          case JobCommand.train_neuron_model =>
            Some(defaultMails.jobSuccessfulModelTrainingMail(multiUser, resultLink))
          case JobCommand.train_instance_model =>
            Some(defaultMails.jobSuccessfulModelTrainingMail(multiUser, resultLink))
          case JobCommand.materialize_volume_annotation =>
            Some(
              genericEmailTemplate(
                "Volume Annotation Merged",
                "Your volume annotation has been successfully merged with the existing segmentation. The result is available as a new dataset in your dashboard."
              )
            )
          case JobCommand.compute_mesh_file =>
            Some(
              genericEmailTemplate(
                "Mesh Generation",
                "Your 3D meshes for the whole segmentation layer of your dataset are ready. Load pre-computed meshes by right-clicking any segment and choosing the corresponding option for near instant visualizations."
              )
            )
          case JobCommand.render_animation =>
            Some(
              genericEmailTemplate(
                "Dataset Animation",
                "Your WEBKNOSSOS dataset animation is ready."
              )
            )
          // Some jobs, e.g. "find largest segment ideas", do not require an email notification.
          case _ => None
        }
      } yield emailTemplate.foreach(mailSender.send)
    }

  def sendJobFailedEmail(owner: User, job: Job): Unit =
    mailSender.inBackground(s"job ${job._id} failed") {
      for {
        multiUser <- multiUserDAO.findOne(owner._multiUser)(using GlobalAccessContext)
        datasetName = job.datasetNameForEmail.getOrElse("")
        errorMessage = job.latestRunErrorDetails
          .flatMap(details => (details \ "message").asOpt[String])
          .map(_.trim)
          .filter(_.nonEmpty)
        emailTemplate = job.command match {
          case JobCommand.convert_to_wkw =>
            defaultMails.jobFailedUploadConvertMail(multiUser, datasetName, errorMessage)
          case _ => defaultMails.jobFailedGenericMail(multiUser, datasetName, job.command.toString, errorMessage)
        }
      } yield mailSender.send(emailTemplate)
    }
}
