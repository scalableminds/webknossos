// @flow
export default {
  "save.failed_simultaneous_tracing": `It seems that you edited the tracing simultaneously in different windows.
Editing should be done in a single window only.

In order to restore the current window, a reload is necessary.`,
  "save.failed_client_error": `We've encountered a permanent error while trying to save.

In order to restore the current window, a reload is necessary.`,
  "save.leave_page_unfinished":
    "You haven't saved your progress, please give us 2 seconds to do so and and then leave this site.",
  "save.failed": "Failed to save tracing. Retrying.",
  "finish.confirm": "Are you sure you want to permanently finish this tracing?",
  "download.wait": "Please wait...",
  "download.close_window": "You may close this window after the download has started.",
  "add_script.confirm_change": "This will replace the code you have written. Continue?",
  "tracing.copy_position": "Click this button to copy the position.",
  "tracing.copy_rotation": "Click this button to copy the rotation.",
  "tracing.no_more_branchpoints": "No more branchpoints",
  "tracing.branchpoint_set": "Branchpoint set",
  "tracing.branchpoint_jump_twice":
    "You didn't add a node after jumping to this branchpoint, do you really want to jump again?",
  "webgl.disabled": "Couldn't initialise WebGL, please make sure WebGL is enabled.",
  "task.user_script_retrieval_error": "Unable to retrieve script",
  "task.new_description": "You are now tracing a new task with the following description",
  "task.no_description": "You are now tracing a new task with no description.",
  "task.delete": "Do you really want to delete this task?",
  "task.bulk_create_invalid": "Can not parse specification. Text area contains invalid content.",
  "dataset.upload_success": "The dataset was uploaded successfully",
  "dataset.confirm_signup":
    "For dataset annotation, please log in or create an account. For dataset viewing, no account is required. Do you wish to sign up now?",
  "annotation.delete": "Do you really want to delete this annotation?",
  "annotation.dataset_no_public":
    "Public tracings require the respective dataset to be public too. Please, make sure to add public access rights to the dataset as well.",
  "project.delete": "Do you really want to delete this project?",
  "script.delete": "Do you really want to delete this script?",
  "team.delete": "Do you really want to delete this team?",
  "taskType.delete": "Do you really want to delete this task type?",
  "request.max_item_count_alert":
    "Your request returned more than 1000 results. More results might be available on the server but were omitted for technical reasons.",
};
