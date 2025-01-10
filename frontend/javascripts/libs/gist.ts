import Request from "libs/request";
import Toast from "libs/toast";
import _ from "lodash";
import messages from "messages";
// https://developer.github.com/v3/gists/#get-a-single-gist
type GithubGist = {
  files: Record<
    string,
    {
      size: number;
      raw_url: string;
      type: "text/plain";
      language: string;
      truncated: boolean;
      content: string;
    }
  >;
};

function handleError(name: string) {
  Toast.error(`${messages["task.user_script_retrieval_error"]} ${name}`);
}

export async function fetchGistContent(url: string, name: string): Promise<string> {
  const gistId = _.last(url.split("/"));

  let gist;

  try {
    gist = (await Request.receiveJSON(`https://api.github.com/gists/${gistId}`)) as GithubGist;
  } catch (_e) {
    handleError(name);
    return "";
  }

  const firstFile = gist.files[Object.keys(gist.files)[0]];

  if (firstFile?.content) {
    return firstFile.content;
  } else {
    handleError(name);
    return "";
  }
}
export default {};
