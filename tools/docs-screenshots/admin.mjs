// Routes and controls are defined in router/router.tsx and the corresponding admin views.
// These recipes only navigate, filter, and open dialogs. They never submit changes.
const main = ".ant-layout-content";
const modal = ".ant-modal-content";

async function goto(ctx, path, ready) {
  await ctx.page.goto(new URL(path, ctx.baseUrl).href, { waitUntil: "networkidle2" });
  await ctx.page.waitForSelector(main, { visible: true });
  if (new URL(ctx.page.url()).pathname.startsWith("/auth/login")) {
    throw new Error("This screenshot requires an authenticated local administrator.");
  }
  if (
    await ctx.page.evaluate(() =>
      document.body.innerText.includes("Sorry, the page you visited does not exist."),
    )
  ) {
    throw new Error(
      `The local app does not expose ${path}. Check its feature flags; onboarding requires isWkorgInstance=false.`,
    );
  }
  if (ready)
    await ctx.page.waitForFunction((text) => document.body.innerText.includes(text), {}, ready);
}
async function fill(page, selector, value) {
  const input = await page.waitForSelector(selector, { visible: true });
  await input.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await input.type(String(value));
}
async function search(ctx, value = "l4_sample", selector = `${main} .ant-input`) {
  await fill(ctx.page, selector, value);
  await ctx.page.keyboard.press("Enter");
  await ctx.page.waitForNetworkIdle();
}
async function api(ctx, path, body) {
  return ctx.page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(
        path,
        body === undefined
          ? undefined
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
      );
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return response.json();
    },
    { path, body },
  );
}
function fixture(ctx, key, description) {
  const value = ctx.fixtures?.[key];
  if (!value) throw new Error(`Missing fixtures.${key}: ${description}`);
  return value;
}
function recipe(output, capture) {
  return { id: output, output: `docs/images/${output}`, capture };
}
function route(output, path, ready) {
  return recipe(output, async (ctx) => {
    await goto(ctx, path, ready);
    return main;
  });
}
function settings(output, tab, ready) {
  return recipe(output, async (ctx) => {
    await goto(ctx, `/datasets/${encodeURIComponent(ctx.dataset.id)}/edit/${tab}`, ready);
    return main;
  });
}
async function userModal(ctx, label) {
  await goto(ctx, "/users", "Users");
  const userId = fixture(
    ctx,
    "userId",
    "ID of an active demonstration user in the local organization.",
  );
  const selector = `tr[data-row-key="${CSSescape(userId)}"] input[type="checkbox"]`;
  await ctx.page.waitForSelector(selector, { visible: true });
  await ctx.page.click(selector);
  await ctx.clickText(label, { exact: true });
  await ctx.page.waitForSelector(modal, { visible: true });
  return modal;
}
function CSSescape(value) {
  // Fixture IDs are server IDs, never arbitrary CSS fragments.
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`Invalid fixture ID: ${value}`);
  return value;
}
async function annotations(ctx, archived) {
  await goto(ctx, "/dashboard/explorativeAnnotations?dataset=l4_sample", "Annotations");
  if (archived) await ctx.clickText("Show Archived Annotations", { exact: true });
  await ctx.page.waitForSelector(`${main} a[href^="/annotations/"]`, { visible: true });
  await assertAnnotationDatasets(ctx);
  return main;
}
async function assertAnnotationDatasets(ctx) {
  const ids = await ctx.page.$$eval('.ant-layout-content a[href^="/annotations/"]', (links) => [
    ...new Set(
      links
        .filter((link) => link.getBoundingClientRect().width > 0)
        .map((link) => new URL(link.href).pathname.split("/").pop()),
    ),
  ]);
  for (const id of ids) {
    const annotation = await api(ctx, `/api/annotations/${encodeURIComponent(id)}/info`);
    if (annotation.datasetId !== ctx.dataset.id)
      throw new Error("Visible annotations must all belong to l4_sample.");
  }
}
async function tasks(ctx) {
  await goto(ctx, "/dashboard/tasks", "Tasks");
  // The task dashboard has no dataset filter. Require a dedicated documentation account.
  const records = await api(ctx, "/api/user/tasks?isFinished=false&pageNumber=0");
  if (!records.length || records.some((record) => record.datasetId !== ctx.dataset.id)) {
    throw new Error(
      "Use a documentation account with open tasks exclusively on l4_sample for task dashboard screenshots.",
    );
  }
  await ctx.page.waitForSelector(`${main} a[href^="/annotations/"]`, { visible: true });
  return main;
}
async function checkVisibleJobs(ctx) {
  const ids = await ctx.page.$$eval(".ant-table-row[data-row-key]", (rows) =>
    rows.map((row) => row.getAttribute("data-row-key")),
  );
  for (const id of ids) {
    const job = await api(ctx, `/api/jobs/${encodeURIComponent(id)}`);
    if (job.args.datasetId !== ctx.dataset.id)
      throw new Error(
        "Visible jobs must all use l4_sample. Legacy jobs without dataset IDs need replacing with current fixtures.",
      );
  }
}
async function publications(ctx) {
  await goto(ctx, "/dashboard/publications", "Featured Publications");
  const records = await api(ctx, "/api/publications");
  const selected = records.filter((record) =>
    record.datasets.some((dataset) => dataset.id === ctx.dataset.id),
  );
  if (
    !selected.length ||
    selected.some(
      (record) =>
        record.datasets.some((dataset) => dataset.id !== ctx.dataset.id) ||
        record.annotations.some((annotation) => annotation.dataset.id !== ctx.dataset.id),
    )
  ) {
    throw new Error(
      "Configure a local featured publication containing only the published l4_sample dataset.",
    );
  }
  await search(ctx, "l4_sample", 'input[placeholder="Search Publications"]');
  await ctx.page.waitForSelector(".publication-list .ant-list-item", { visible: true });
  return main;
}
async function onboarding(ctx, account) {
  await ctx.anonymous();
  // The runner gives each recipe an isolated context, so removing its cookies is safe.
  const cookies = await ctx.page.browserContext().cookies();
  if (cookies.length) await ctx.page.browserContext().deleteCookie(...cookies);
  await goto(ctx, "/onboarding", "Create or Join an Organization");
  await fill(ctx.page, 'input[placeholder="Your organization name"]', "Documentation Lab");
  if (account) {
    // OrganizationForm.onFinish advances local wizard state; no organization is persisted.
    await ctx.clickText("Create", { exact: true });
    await ctx.page.waitForFunction(() =>
      document.body.innerText.includes("Create an Admin Account"),
    );
  }
  return main;
}

export const recipes = [
  ...["screenshot_DS_management.png", "dashboard_regular_user.jpeg"].map((name) =>
    recipe(name, async (ctx) => {
      await goto(ctx, "/dashboard/datasets", "Datasets");
      await search(ctx);
      await ctx.page.waitForSelector(`${main} a[href*="${CSSescape(ctx.dataset.id)}"]`, {
        visible: true,
      });
      return main;
    }),
  ),
  recipe("dashboard_annotations.png", (ctx) => annotations(ctx, false)),
  recipe("dashboard_archive.png", (ctx) => annotations(ctx, true)),
  ...["dashboard_tasks.png", "dashboard_tasks.jpeg", "screenshot_tasks.png"].map((name) =>
    recipe(name, tasks),
  ),
  ...[
    "screenshot_featured_publications.png",
    "dashboard_featured_publications.png",
    "getting_started-datasets.jpeg",
  ].map((name) => recipe(name, publications)),
  settings("dataset_settings_datasource.jpeg", "data", "Data Source"),
  settings("dataset_settings_sharing.jpeg", "sharing", "Sharing & Permissions"),
  settings("dataset_settings_metadata.jpeg", "metadata", "Metadata"),
  settings("dataset_settings_viewconfig.jpeg", "defaultConfig", "View Configuration"),
  settings("dataset_settings_delete.jpeg", "delete", "Delete Dataset"),
  route("tasks_tasktype.jpeg", "/taskTypes/create", "Task Type"),
  recipe("tasks_task.jpeg", async (ctx) => {
    await goto(ctx, "/tasks/create", "Create Tasks");
    await fill(ctx.page, "#datasetId", "l4_sample");
    await ctx.page.waitForSelector(".ant-select-item-option", { visible: true });
    await ctx.clickText("l4_sample", { exact: true });
    return main;
  }),
  route("tasks_project.jpeg", "/projects/create", "Project"),
  recipe("tasks_download.jpeg", async (ctx) => {
    const name = fixture(
      ctx,
      "projectName",
      "Name of a local documentation project whose tasks use l4_sample.",
    );
    await goto(ctx, "/projects", "Projects");
    await search(ctx, name);
    const projects = await api(ctx, "/api/projects");
    const project = projects.find((project) => project.name === name);
    if (!project) throw new Error(`Documentation project not found: ${name}`);
    const tasks = await api(ctx, "/api/tasks/list", { project: project.id });
    if (!tasks.length || tasks.some((task) => task.datasetId !== ctx.dataset.id))
      throw new Error("Documentation project must contain only l4_sample tasks.");
    await ctx.page.waitForSelector('a[title="Download All Finished Annotations"]', {
      visible: true,
    });
    return main;
  }),
  recipe("task_instance_actions.jpg", async (ctx) => {
    const id = CSSescape(
      fixture(ctx, "taskId", "A local l4_sample task ID with an assigned annotation."),
    );
    await goto(ctx, `/tasks/${id}`, "Tasks");
    const record = await api(ctx, `/api/tasks/${id}`);
    if (record.datasetId !== ctx.dataset.id)
      throw new Error("fixtures.taskId must belong to l4_sample.");
    await ctx.page.click(".ant-table-row-expand-icon");
    await ctx.clickText("Actions", { exact: true });
    await ctx.page.waitForSelector(".ant-dropdown:not(.ant-dropdown-hidden)", { visible: true });
    return main;
  }),
  recipe("users_experience.jpeg", (ctx) => userModal(ctx, "Change Experience")),
  recipe("users_team_assignment.jpg", (ctx) => userModal(ctx, "Edit Teams & Permissions")),
  recipe("users_activate2.jpeg", (ctx) => userModal(ctx, "Edit Teams & Permissions")),
  route("users_activate1.jpeg", "/users", "Users"),
  recipe("users_invite.jpeg", async (ctx) => {
    await goto(ctx, "/users", "Users");
    await ctx.clickText("Invite Users", { exact: true });
    await ctx.page.waitForSelector(modal, { visible: true });
    return modal;
  }),
  route("team_overview.jpg", "/teams", "Teams"),
  recipe("jobs.jpeg", async (ctx) => {
    await goto(ctx, "/jobs", "Jobs");
    await search(ctx);
    await ctx.page.waitForSelector(".ant-table-row", { visible: true });
    await checkVisibleJobs(ctx);
    return main;
  }),
  recipe("nuclei_segmentation_job.jpeg", async (ctx) => {
    const id = CSSescape(
      fixture(ctx, "nucleiJobId", "An existing nuclei inference job for l4_sample."),
    );
    await goto(ctx, "/jobs", "Jobs");
    const job = await api(ctx, `/api/jobs/${id}`);
    if (job.args.datasetId !== ctx.dataset.id)
      throw new Error("fixtures.nucleiJobId must use l4_sample.");
    await search(ctx);
    await ctx.page.waitForSelector(`tr[data-row-key="${id}"]`, { visible: true });
    if (!["infer_nuclei", "infer_instances"].includes(job.command))
      throw new Error("fixtures.nucleiJobId must be a nuclei or instance inference job.");
    await checkVisibleJobs(ctx);
    return main;
  }),
  recipe("onboarding_organization.jpeg", (ctx) => onboarding(ctx, false)),
  recipe("onboarding_user.jpeg", (ctx) => onboarding(ctx, true)),
  route("onboarding_data1.jpeg", "/datasets/upload", "Upload"),
  // The current data-source settings replace the historical post-upload confirmation screen.
  settings("onboarding_data2.jpeg", "data", "Data Source"),
];
