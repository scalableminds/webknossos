### define
jquery : $
underscore : _
../libs/toast : Toast
routes : jsRoutes
###

class Paginator
  

  constructor: (@pageSelectionDiv) ->
    
    @allElements = null
    @elementsToShow = null
        
    tableID = @pageSelectionDiv.data("paged-table-id")
    @tbody = $("#"+tableID).find("tbody")

    @extractTemplate()
    @retrieveData()
    
    searchboxElement = @pageSelectionDiv.find(".pagination-searchbox")
    @addSearchboxListener(searchboxElement)


  extractTemplate : ->
    
    @template = @tbody.html()
    @tbody.html("")
    @tbody.removeClass("hide")


  retrieveData : ->
    
    @rowsPerPage = 100
    
    ajaxOptions =
      url : @pageSelectionDiv.data("url")
      dataType : "json"
      type : "get"

    $.ajax(ajaxOptions).then(

      (responseData) =>
        
        @allElements = @elementsToShow = responseData

        pageCount = Math.ceil(@allElements.length / @rowsPerPage)
        
        pageSelectionHandler = (event, number) =>
          index = number - 1
          json = @getElementsForPage index
          @displayJSON json
        
        @pageSelectionDiv.bootpag(
          total: pageCount
          page: 1
          maxVisible: 20
          leaps: true
        ).on "page", pageSelectionHandler

        # activate the first page
        pageSelectionHandler null, 1

        @hideLoader()

        return
    )

  hideLoader : ->

    $("#loader").css("display" : "none")


  getElementsForPage : (index) ->
    
    start = @rowsPerPage * index
    return @elementsToShow.slice(start, start + @rowsPerPage)


  updatePageCount : ->
    
    @pageSelectionDiv.bootpag(
      total: Math.ceil(@elementsToShow.length / @rowsPerPage)
      page:  1
    )


  addSearchboxListener : (searchboxElement) ->
    
    lastQuery = null
    currentQuery = null

    searchboxElement.keyup (event) =>
      newQuery = $(event.currentTarget).val().toLowerCase()

      if newQuery == currentQuery
        return

      currentQuery = currentQuery
      lastQuery = currentQuery
      currentQuery = newQuery

      if currentQuery.length > 0
        @elementsToShow = []

        i = 0
        for task in @allElements
          if @JSONcontains task, currentQuery
            @elementsToShow.push task
      else
        @elementsToShow = @allElements
     
      @updatePageCount()
      @displayJSON(@getElementsForPage 0)
      

  displayJSON : (jsonArray) ->
    
    htmlArray = []
    
    for element in jsonArray
      htmlArray.push @generateHTML(element)
    

    @tbody.html(htmlArray.join(""))


  JSONcontains : (data, query) ->

    contains = false

    $.each data, (key, value) =>
    
      if _.isObject(value) or _.isArray(value)
         contains = @JSONcontains value, query
         return !contains # if contains then break else continue

      if _.isNumber(value) or _.isString(value)
        # stringify
        value = (value + '').toLowerCase()
        if value.indexOf(query) > -1
          contains = true
          return false # break
    
    return contains


  generateHTML : (element) ->
    
    filledTemplate = @template    

    # resolve routes
    filledTemplate = filledTemplate.replace( /href="[^\"]*"/g, (match) ->
      
      try
        # remove href=" and "
        propertyChain = match.slice(6, match.length - 1)
        properties = propertyChain.split(".")

        currentObject = jsRoutes
        for currentProperty in properties
          unless currentProperty == "routes"
            currentObject = currentObject[currentProperty]

        pathProvider = currentObject
        url = pathProvider(element.id).url
        return 'href="' + url + '"'

      catch e
        # href="" isn't a very precise selector; wont work for data-href etc.
        # so, ignore failing route access
        return match
    )

    # resolve #{pseudo string interpolation}
    filledTemplate = filledTemplate.replace( /(#\{[^}]*\})/g, (match) ->
      
      # remove #{ and }
      propertyChain = match.slice(2, match.length - 1)

      properties = propertyChain.split(".")

      currentObject = element
      for currentProperty in properties
        currentObject = currentObject[currentProperty]

      return currentObject
    )

    return filledTemplate
