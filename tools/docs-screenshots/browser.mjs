// Intercept only authenticated app requests. Intercepting every request via
// page.setRequestInterception also pauses voxel fetches in web workers and can
// leave their promises pending until the application's data timeout expires.
export async function authenticateLocalPage(page, baseUrl, token, shouldAuthenticate = () => true) {
  const interception = await page.createCDPSession();
  await interception.send("Fetch.enable", {
    patterns: [
      { urlPattern: `${baseUrl}/api/*`, requestStage: "Request" },
      { urlPattern: `${baseUrl}/*`, resourceType: "Document", requestStage: "Request" },
    ],
  });
  interception.on("Fetch.requestPaused", async ({ requestId, request }) => {
    const headers = Object.entries(request.headers)
      .filter(([name]) => name.toLowerCase() !== "x-auth-token")
      .map(([name, value]) => ({ name, value }));
    if (shouldAuthenticate() && token && new URL(request.url).origin === baseUrl)
      headers.push({ name: "X-Auth-Token", value: token });
    await interception.send("Fetch.continueRequest", { requestId, headers }).catch(() => {});
  });
}
