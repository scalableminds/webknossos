export async function getNumberPaginationPages() {
  // Returns the number of pages for a paginated list

  const selector = ".pagination .page"
  const activePage = 1
  const nextPages = await browser.elements(selector).then(function(res) {
    return res.value.length
  })

  return activePage + nextPages
}
