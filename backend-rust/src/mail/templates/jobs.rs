//! Job success and failure mails.
use super::{SP, button, e, html_mail, image, page};
use crate::mail::Mail;

/// DefaultMails.jobSuccessfulGenericMail (`jobSuccessfulGeneric`).
pub fn job_successful_generic(
    full_name: &str,
    email: &str,
    dataset_name: &str,
    job_link: &str,
    job_title: &str,
    job_description: &str,
) -> Mail {
    let open = button("Open in WEBKNOSSOS", job_link);
    let robot = image(
        "https://static.webknossos.org/mails/email-drawing-successful-job.png",
        "A robot celebrating a successful WEBKNOSSOS job",
        300,
        250,
    );
    let (name, dataset_name, job_description) = (e(full_name), e(dataset_name), e(job_description));
    let content = format!(
        r##"
<p>Hi {name},</p>

<p>Your background job for the dataset <i>{dataset_name}</i> has finished successfully and is ready for exploration.</p>
<p>{job_description} Click the button below to open WEBKNOSSOS</p>

{open}

<p>With best regards,<br />the WEBKNOSSOS team</p>

{robot}
"##
    );
    html_mail(email, format!("{job_title} is ready"), page(&content, "\n"))
}

/// DefaultMails.jobSuccessfulUploadConvertMail (`jobSuccessfulUploadConvert`).
pub fn job_successful_upload_convert(
    full_name: &str,
    email: &str,
    dataset_name: &str,
    job_link: &str,
) -> Mail {
    let open = button("Open dataset in WEBKNOSSOS", job_link);
    let preview = image(
        "https://static.webknossos.org/mails/email-alignment-preview.gif",
        "A preview of the alignment services for a WEBKNOSSOS dataset",
        300,
        300,
    );
    let (name, dataset_name) = (e(full_name), e(dataset_name));
    let content = format!(
        r##"
<p>Hi {name},</p>

<p>
  Your dataset <i>{dataset_name}</i> has been successfully converted and uploaded in WEBKNOSSOS.{SP}

  Click the button below to open the dataset, or find it in your selected dataset folder on the WEBKNOSSOS dashboard.
</p>

{open}

<p>
  Align your dataset directly in WEBKNOSSOS to prepare it for downstream analysis. Our <a href="https://youtu.be/Rt3uG31r2bI?si=9es-5LVi2lCvmSMG">step-by-step tutorial</a> will guide you through the process.
</p>
{preview}

<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
    );
    html_mail(email, "Your dataset is ready".into(), page(&content, "\n"))
}

/// DefaultMails.jobSuccessfulNeuronSegmentationMail.
pub fn job_successful_neuron_segmentation(full_name: &str, email: &str, job_link: &str) -> Mail {
    let open = button("Open segmentation in WEBKNOSSOS", job_link);
    let preview = image(
        "https://static.webknossos.org/mails/email-full-segmentation-preview.gif",
        "A preview of a full, automated segmentation of a WEBKNOSSOS dataset",
        300,
        300,
    );
    let name = e(full_name);
    let content = format!(
        r##"
<p>Hi {name},</p>

<p>
  Your segmentation has successfully finished and is ready for exploration.{SP}
  Click the button below to open the new, segmented dataset, or find it amongst your other datasets in the WEBKNOSSOS dashboard.
</p>

{open}

<p>
  If you are happy with the results, you can now apply the model to the full dataset. If you have already segmented the full volume, continue with the proofreading tools to review and finalize the segmentation.
</p>
<p>
  If the results are not quite what you expected, <a href="https://youtu.be/MlT4MgU6ayw?si=daGZoX5Y-Y3FXSC5">custom training or fine-tuning</a> of models can help improve performance on your specific data. For especially large or complex neuron segmentation projects, we also offer dedicated <a href="https://home.webknossos.org/services/automated-segmentation">automated segmentation</a> and <a href="https://home.webknossos.org/services/connectome-reconstruction">connectome reconstruction services</a>.
</p>
{preview}


<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
    );
    html_mail(
        email,
        "Your segmentation is ready".into(),
        page(&content, "\n"),
    )
}

/// DefaultMails.jobSuccessfulMitoSegmentationMail.
pub fn job_successful_mito_segmentation(full_name: &str, email: &str, job_link: &str) -> Mail {
    let open = button("Open segmentation in WEBKNOSSOS", job_link);
    let preview = image(
        "https://static.webknossos.org/mails/email-mito-segmentation-preview.gif",
        "A preview of a full, automated mitochondria segmentation of a WEBKNOSSOS dataset",
        300,
        300,
    );
    let name = e(full_name);
    let content = format!(
        r##"
<p>Hi {name},</p>

<p>
  Your mitochondria detection job has successfully finished and is ready for exploration.{SP}
  Click the button below to open the new, segmented dataset, or find it amongst your other datasets in the WEBKNOSSOS dashboard.
</p>

{open}

<p>
  If you would like to improve detection accuracy for your specific data, consider <a href="https://youtu.be/MlT4MgU6ayw?si=uekAKL6kOC0c_Dhj">training a custom model</a> or contact us about our <a href="https://home.webknossos.org/services/automated-segmentation">automated segmentation services</a>.
</p>

{preview}


<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
    );
    html_mail(
        email,
        "Your mitochondria segmentation is ready".into(),
        page(&content, "\n"),
    )
}

/// DefaultMails.jobSuccessfulAlignmentMail.
pub fn job_successful_alignment(
    full_name: &str,
    email: &str,
    dataset_name: &str,
    job_link: &str,
) -> Mail {
    let open = button("Open dataset in WEBKNOSSOS", job_link);
    let preview = image(
        "https://static.webknossos.org/mails/email-alignment-preview.gif",
        "A preview of an aligned WEBKNOSSOS dataset",
        300,
        300,
    );
    let (name, dataset_name) = (e(full_name), e(dataset_name));
    let content = format!(
        r##"
<p>Hi {name},</p>

<p>
  The automated alignment for your dataset <i>{dataset_name}</i> has finished successfully.{SP}
  Click the button below to open the new, aligned dataset, or find it amongst your other datasets in the WEBKNOSSOS dashboard.
</p>

{open}

<p>
  Next, you can run our pre-trained models for neuron segmentation and mitochondria detection, or train a custom model tailored to your data. <a href="https://www.youtube.com/playlist?list=PLpizOgyiA4kH-MbmYUpLcYf9RV8zuhDJ9">Step-by-step tutorials</a> are available to guide you through these workflows.
</p>

<p>
  If the alignment quality is not sufficient due to challenging raw data, our <a href="https://home.webknossos.org/services/alignment">custom alignment and preprocessing services</a> can provide additional support.
</p>
{preview}


<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
    );
    html_mail(
        email,
        "Your alignment is ready".into(),
        page(&content, "\n"),
    )
}

/// DefaultMails.jobSuccessfulModelTrainingMail.
pub fn job_successful_model_training(full_name: &str, email: &str, job_link: &str) -> Mail {
    let open = button("Open WEBKNOSSOS", job_link);
    let preview = image(
        "https://static.webknossos.org/mails/email-manual-annotation-service.gif",
        "A preview of manual annotation of a WEBKNOSSOS dataset",
        300,
        300,
    );
    let name = e(full_name);
    let content = format!(
        r##"
<p>Hi {name},</p>

<p>
  Your custom machine learning model has been successfully trained and is now available in WEBKNOSSOS. You can access it under AI Analysis → AI Models, or via the button below.
</p>

{open}


<p>
To run your model, open the dataset you would like to segment, define a bounding box for testing, and select <i>Run AI Model</i>. Your custom model will appear below the pre-trained models and can be selected from there.
</p>


{preview}

<p>
If you require additional ground truth annotations to further improve model performance, our <a href="https://home.webknossos.org/services/annotations">manual annotation services</a> are available to support your project.
</p>

<p>With best regards,<br />the WEBKNOSSOS team</p>
"##
    );
    html_mail(
        email,
        "Your model training is ready".into(),
        page(&content, "\n"),
    )
}

const ERROR_STYLE: &str = "background-color: #f5f5f5; border-left: 3px solid #d9d9d9; border-radius: 4px; padding: 12px 16px; color: #555555; white-space: pre-wrap;";

/// DefaultMails.jobFailedGenericMail (`jobFailedGeneric`).
pub fn job_failed_generic(
    full_name: &str,
    email: &str,
    dataset_name: &str,
    job_title: &str,
    error_message: Option<&str>,
) -> Mail {
    let robot = image(
        "https://static.webknossos.org/mails/email-drawing-failed-job.png",
        "A robot dismayed about an unsuccessful WEBKNOSSOS job",
        300,
        250,
    );
    let (name, dataset_name, job_title) = (e(full_name), e(dataset_name), e(job_title));
    let failure = match error_message {
        Some(message) => format!(
            "\n<p>\n  Unfortunately, your {job_title} job for the {dataset_name} dataset failed with the following error:\n</p>\n<p style=\"{ERROR_STYLE}\">{}</p>\n  ",
            e(message)
        ),
        None => format!(
            "\n<p>\n  Something unexpected went wrong while processing your {job_title} job for the {dataset_name} dataset. This should not have happened, and we apologize for the inconvenience.\n</p>\n  "
        ),
    };
    let content = format!(
        r##"
<p>Hi {name},</p>

{failure}
<p>
  Any compute credits used for this job have been fully refunded.{SP}
</p>

<p>Feel free to <a href="mailto:support@webknossos.org">contact us via email</a> for assistance or please try again later.</p>

<p>With best regards,<br />the WEBKNOSSOS team</p>

{robot}

"##
    );
    html_mail(
        email,
        "Oops. Your WEBKNOSSOS job failed".into(),
        page(&content, "\n"),
    )
}

/// DefaultMails.jobFailedUploadConvertMail (`jobFailedUploadConvert`).
pub fn job_failed_upload_convert(
    full_name: &str,
    email: &str,
    dataset_name: &str,
    error_message: Option<&str>,
) -> Mail {
    let robot = image(
        "https://static.webknossos.org/mails/email-drawing-failed-job.png",
        "A robot dismayed about an unsuccessful WEBKNOSSOS dataset upload job",
        300,
        250,
    );
    let (name, dataset_name) = (e(full_name), e(dataset_name));
    let failure = match error_message {
        Some(message) => format!(
            "\n<p>\n  Unfortunately, uploading and processing your dataset <i>{dataset_name}</i> failed with the following error:\n</p>\n<p style=\"{ERROR_STYLE}\">{}</p>\n  ",
            e(message)
        ),
        None => format!(
            "\n<p>\n  Something unexpected went wrong while uploading and processing your dataset <i>{dataset_name}</i>. This should not have happened, and we apologize for the inconvenience.\n</p>\n  "
        ),
    };
    let content = format!(
        r##"
<p>Hi {name},</p>

{failure}
<p>
  Feel free to <a href="mailto:hello@webknossos.com">contact us for assistance</a> or please try again later.
</p>

<p>Here are some tips for uploading and converting datasets:
<ul>
  <li><a href="https://docs.webknossos.org/webknossos/data/index.html">See the documentation on supported file formats</a></li>
  <li><a href="https://docs.webknossos.org/webknossos-py/index.html">Try our Python library for uploading datasets</a></li>
  <li><a href="https://docs.webknossos.org/webknossos/data/streaming.html">Try streaming your data as Zarr, Neuroglancer, or N5 files instead of uploading</a></li>
</ul>
</p>

<p>With best regards,<br />the WEBKNOSSOS team</p>

{robot}
"##
    );
    html_mail(
        email,
        "Oops. Your dataset upload & conversion failed".into(),
        page(&content, "\n"),
    )
}
