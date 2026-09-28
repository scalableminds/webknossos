// Routes and controls are defined in router/router.tsx and the corresponding admin views.
// These recipes only navigate, filter, and open dialogs. They never submit changes.
const main = ".ant-layout-content";
const content = (ctx) => ctx.page.locator(main).first();
const dialog = (ctx) => ctx.page.getByRole("dialog").filter({ visible: true }).last();

async function goto(ctx, path, ready) {
  await ctx.page.goto(new URL(path, ctx.baseUrl).href, { waitUntil: "domcontentloaded" });
  await content(ctx).waitFor({ state: "visible" });
  if (new URL(ctx.page.url()).pathname.startsWith("/auth/login")) {
    throw new Error("This screenshot requires an authenticated local administrator.");
  }
  if (
    await ctx.page.evaluate(() =>
      document.body.innerText.includes("Sorry, the page you visited does not exist."),
    )
  ) {
    throw new Error(`The local app does not expose ${path}. Check its feature flags.`);
  }
  if (ready)
    await content(ctx).getByText(ready, { exact: false }).first().waitFor({ state: "visible" });
}
async function fill(page, selector, value) {
  await page.locator(selector).filter({ visible: true }).first().fill(String(value));
}
async function search(ctx, value = ctx.dataset.name, selector = `${main} input.ant-input`) {
  const input = ctx.page.locator(selector).filter({ visible: true }).first();
  await input.fill(value);
  await input.press("Enter");
  await settled(ctx);
}
async function settled(ctx) {
  // Wait for React's filtered list commit and any visible loading indicators.
  await ctx.page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  while (await ctx.page.locator(".ant-spin-spinning:visible").count()) {
    await ctx.page.locator(".ant-spin-spinning:visible").first().waitFor({ state: "hidden" });
  }
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
function route(output, path, ready, scrollToTop = false) {
  return recipe(output, async (ctx) => {
    await goto(ctx, path, ready);
    return { target: content(ctx), scrollToTop };
  });
}
function settings(output, tab, ready) {
  return recipe(output, async (ctx) => {
    await goto(ctx, `/datasets/${encodeURIComponent(ctx.dataset.id)}/edit/${tab}`, ready);
    return content(ctx);
  });
}
async function userModal(ctx, label) {
  await goto(ctx, "/users", "Users");
  const userId = ctx.fixtures?.userId || (await api(ctx, "/api/user")).id;
  const selector = `tr[data-row-key="${CSSescape(userId)}"] input[type="checkbox"]`;
  await ctx.page.locator(selector).check();
  await ctx.page.getByRole("button").filter({ hasText: label }).click();
  await dialog(ctx).waitFor({ state: "visible" });
  return { target: dialog(ctx), padding: 64 };
}
function CSSescape(value) {
  // Fixture IDs are server IDs, never arbitrary CSS fragments.
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`Invalid fixture ID: ${value}`);
  return value;
}
async function annotations(ctx, archived) {
  await goto(
    ctx,
    `/dashboard/annotations?dataset=${encodeURIComponent(ctx.dataset.name)}`,
    "Annotations",
  );
  const records = await api(ctx, `/api/annotations/readable?isFinished=${archived}&pageNumber=0`);
  const matching = records.filter(
    (record) => (record.datasetId ?? record.dataSetId) === ctx.dataset.id,
  );
  if (!matching.length) {
    throw new Error(
      `Missing ${archived ? "archived" : "open"} annotation fixture on the documentation dataset. ${archived ? "Archive a dedicated demonstration annotation" : "Create a demonstration annotation"} in the local account before capturing this dashboard.`,
    );
  }
  if (archived) {
    await ctx.page.getByRole("button", { name: "Show Archived Annotations", exact: true }).click();
    // Archived annotations are not linked; check their dataset tags instead.
    const rows = ctx.page.locator(`${main} .ant-table-row`);
    await rows.first().waitFor({ state: "visible" });
    for (const row of await rows.all()) {
      if (!(await row.getByText(ctx.dataset.name, { exact: true }).count()))
        throw new Error("Visible annotations must all belong to the documentation dataset.");
    }
    return content(ctx);
  }
  await ctx.page
    .locator(`${main} a[href^="/annotations/"]:visible`)
    .first()
    .waitFor({ state: "visible" });
  await assertAnnotationDatasets(ctx);
  return content(ctx);
}
async function assertAnnotationDatasets(ctx) {
  const ids = await ctx.page
    .locator('.ant-layout-content a[href^="/annotations/"]')
    .evaluateAll((links) => [
      ...new Set(
        links
          .filter((link) => link.getBoundingClientRect().width > 0)
          .map((link) => new URL(link.href).pathname.split("/").pop()),
      ),
    ]);
  for (const id of ids) {
    const annotation = await api(ctx, `/api/annotations/${encodeURIComponent(id)}/info`);
    if ((annotation.datasetId ?? annotation.dataSetId) !== ctx.dataset.id)
      throw new Error("Visible annotations must all belong to the documentation dataset.");
  }
}
async function tasks(ctx) {
  await goto(ctx, "/dashboard/tasks", "Tasks");
  // The task dashboard has no dataset filter; other open tasks of the account may appear too.
  const records = await api(ctx, "/api/user/tasks?isFinished=false&pageNumber=0");
  if (!records.some((record) => record.datasetId === ctx.dataset.id)) {
    throw new Error(
      "The account needs an open task on the documentation dataset. Run tools/docs-screenshots/setup-fixtures.mjs.",
    );
  }
  await ctx.page.locator(`${main} a[href^="/annotations/"]`).first().waitFor({ state: "visible" });
  return content(ctx);
}
async function checkVisibleJobs(ctx) {
  const ids = await ctx.page
    .locator(".ant-table-row[data-row-key]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row-key")));
  for (const id of ids) {
    const job = await api(ctx, `/api/jobs/${encodeURIComponent(id)}`);
    if ((job.args.datasetId ?? job.args.dataset_id) !== ctx.dataset.id)
      throw new Error(
        "Visible jobs must all use the documentation dataset. Legacy jobs without dataset IDs need replacing with current fixtures.",
      );
  }
}
async function publications(ctx) {
  await goto(ctx, "/dashboard/publications", "Featured Publications");
  const records = await api(ctx, "/api/publications");
  // The initial data links the documentation dataset to the publication of its paper.
  if (!records.some((record) => record.datasets.some(({ id }) => id === ctx.dataset.id))) {
    throw new Error(
      "Configure a local featured publication containing the documentation dataset (part of the dev setup's initial data).",
    );
  }
  await search(ctx, ctx.dataset.name, 'input[placeholder="Search Publications"]');
  await ctx.page.locator(".publication-list .ant-list-item").first().waitFor({ state: "visible" });
  return content(ctx);
}
async function onboarding(ctx, account) {
  await ctx.anonymous();
  // The onboarding route only exists on self-hosted instances. Present the local instance as
  // one to this browser context only, instead of requiring a server configuration change.
  await ctx.page.route("**/api/features", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), isWkorgInstance: false } });
  });
  // The runner gives each recipe an isolated context, so removing its cookies is safe.
  await ctx.page.context().clearCookies();
  await goto(ctx, "/onboarding", "Create or Join an Organization");
  // An AutoComplete renders its placeholder separately from the input.
  await ctx.page.getByRole("combobox").fill("Documentation Lab");
  if (account) {
    // OrganizationForm.onFinish advances local wizard state; no organization is persisted.
    await ctx.page.getByRole("button", { name: /Create$/ }).click();
    await ctx.page.waitForFunction(() =>
      document.body.innerText.includes("Create an Admin Account"),
    );
  }
  return content(ctx);
}

export const recipes = [
  ...["screenshot_DS_management.png", "dashboard_regular_user.jpeg"].map((name) =>
    recipe(name, async (ctx) => {
      await goto(ctx, "/dashboard/datasets", "Datasets");
      await search(ctx);
      await ctx.page
        .locator(`${main} a[href*="${CSSescape(ctx.dataset.id)}"]`)
        .first()
        .waitFor({ state: "visible" });
      return content(ctx);
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
  route("tasks_tasktype.jpeg", "/taskTypes/create", "Task Type", true),
  recipe("tasks_task.jpeg", async (ctx) => {
    await goto(ctx, "/tasks/create", "Create Tasks");
    await fill(ctx.page, "#datasetId", ctx.dataset.name);
    await ctx.page
      .locator(".ant-select-dropdown")
      .filter({ visible: true })
      .getByText(ctx.dataset.name, { exact: true })
      .click();
    return { target: content(ctx), scrollToTop: true };
  }),
  route("tasks_project.jpeg", "/projects/create", "Project"),
  recipe("tasks_download.jpeg", async (ctx) => {
    const name = fixture(
      ctx,
      "projectName",
      "Name of a local documentation project whose tasks use the documentation dataset.",
    );
    await goto(ctx, "/projects", "Projects");
    await search(ctx, name);
    const projects = await api(ctx, "/api/projects");
    const project = projects.find((project) => project.name === name);
    if (!project) throw new Error(`Documentation project not found: ${name}`);
    const tasks = await api(ctx, "/api/tasks/list", { project: project.id });
    if (!tasks.length || tasks.some((task) => task.datasetId !== ctx.dataset.id))
      throw new Error(
        "Documentation project must contain only tasks on the documentation dataset.",
      );
    await ctx.page
      .getByTitle("Download All Finished Annotations", { exact: true })
      .first()
      .waitFor({ state: "visible" });
    return content(ctx);
  }),
  recipe("task_instance_actions.jpg", async (ctx) => {
    const id = CSSescape(
      fixture(
        ctx,
        "taskId",
        "A local task ID on the documentation dataset with an assigned annotation.",
      ),
    );
    await goto(ctx, `/tasks/${id}`, "Tasks");
    const record = await api(ctx, `/api/tasks/${id}`);
    if (record.datasetId !== ctx.dataset.id)
      throw new Error("fixtures.taskId must belong to the documentation dataset.");
    await ctx.page.locator(`tr[data-row-key="${id}"] .ant-table-row-expand-icon`).click();
    await ctx.page
      .locator(".ant-table-expanded-row")
      .getByText("Actions", { exact: true })
      .first()
      .click();
    await ctx.page.locator(".ant-dropdown:not(.ant-dropdown-hidden) [role=menu]").waitFor();
    return content(ctx);
  }),
  recipe("users_experience.jpeg", (ctx) => userModal(ctx, "Change Experience")),
  recipe("users_team_assignment.jpg", (ctx) => userModal(ctx, "Edit Teams & Permissions")),
  recipe("users_activate2.jpeg", (ctx) => userModal(ctx, "Edit Teams & Permissions")),
  route("users_activate1.jpeg", "/users", "Users"),
  recipe("users_invite.jpeg", async (ctx) => {
    await goto(ctx, "/users", "Users");
    await ctx.page.getByRole("button", { name: /Invite (Users|Guests)/ }).click();
    await dialog(ctx).waitFor({ state: "visible" });
    return { target: dialog(ctx), padding: 64 };
  }),
  route("team_overview.jpg", "/teams", "Teams"),
  recipe("jobs.jpeg", async (ctx) => {
    await goto(ctx, "/jobs", "Jobs");
    await search(ctx);
    await ctx.page.locator(".ant-table-row").first().waitFor({ state: "visible" });
    await checkVisibleJobs(ctx);
    return content(ctx);
  }),
  recipe("nuclei_segmentation_job.jpeg", async (ctx) => {
    const id = CSSescape(
      fixture(
        ctx,
        "nucleiJobId",
        "An existing nuclei inference job for the documentation dataset.",
      ),
    );
    await goto(ctx, "/jobs", "Jobs");
    const job = await api(ctx, `/api/jobs/${id}`);
    if ((job.args.datasetId ?? job.args.dataset_id) !== ctx.dataset.id)
      throw new Error("fixtures.nucleiJobId must use the documentation dataset.");
    await search(ctx);
    await ctx.page.locator(`tr[data-row-key="${id}"]`).waitFor({ state: "visible" });
    if (!["infer_nuclei", "infer_instances"].includes(job.command))
      throw new Error("fixtures.nucleiJobId must be a nuclei or instance inference job.");
    await checkVisibleJobs(ctx);
    // Emphasize the nuclei job row using the standard red callout.
    return {
      target: content(ctx),
      highlights: [ctx.page.locator(`tr[data-row-key="${id}"]`)],
    };
  }),
  recipe("onboarding_organization.jpeg", (ctx) => onboarding(ctx, false)),
  recipe("onboarding_user.jpeg", (ctx) => onboarding(ctx, true)),
  route("onboarding_data1.jpeg", "/datasets/upload", "Upload"),
  // The current data-source settings replace the historical post-upload confirmation screen.
  settings("onboarding_data2.jpeg", "data", "Data Source"),
];
