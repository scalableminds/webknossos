// Kept out of dashboard_view so that the router can map a URL segment to a tab key without
// statically importing the (lazily loaded) dashboard itself.
export const urlTokenToTabKeyMap = {
  publications: "publications",
  datasets: "datasets",
  tasks: "tasks",
  annotations: "explorativeAnnotations",
};
