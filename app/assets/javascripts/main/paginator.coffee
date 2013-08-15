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
    
    # @pageSelectionDiv = $("#page-selection")
    
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


  retrieveData : () ->
    
    @rowsPerPage = 200
    
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
      newQuery = $(event.currentTarget).val()

      if newQuery == currentQuery
        return

      lastQuery = currentQuery
      currentQuery = newQuery

      console.time("search")

      if currentQuery.length > 0
        @elementsToShow = []

        i = 0
        for task in @allElements
          if @JSONcontains task, currentQuery
            @elementsToShow.push task
      else
        @elementsToShow = @allElements


      console.timeEnd("search")

      console.time("display")
      
      @updatePageCount()
      @displayJSON(@getElementsForPage 0)
      
      console.timeEnd("display")

      console.log "results for", currentQuery, ":", @elementsToShow


  displayJSON : (jsonArray) ->
    
    htmlArray = []
    
    for element in jsonArray
      htmlArray.push @generateHTML(element)
    

    @tbody.html(htmlArray.join(""))


  JSONcontains : (data, query, valuesToConsider=null) ->

    # TODO valuesToConsider could be a json which contains which values should be searched

    contains = false

    $.each data, (key, value) =>
      # which keys should be searched? use valuesToConsider ?

      if _.isObject(value) or _.isArray(value)
         contains = @JSONcontains value, query
         return !contains # if contains then break else continue

      if _.isNumber(value) or _.isString(value)
        # stringify
        value += ''
        if value.indexOf(query) > -1
          contains = true
          return false # break
    
    return contains


  formatDate : (timestamp) ->

    # TODO
    # like 2013-02-03 18:29
    return timestamp


  generateHTML : (element) ->


    #  href="@controllers.admin.routes.AnnotationAdministration.annotationsForTask(task.id)" data-ajax="add-row=#@task.id + tr"

    # element =
    #   "_id": { "$oid": "520a7335715d8120a67276fc" }
    #   "_taskType": { "$oid": "520a7063715d41ed8a843577" }
    #   "assignedInstances": 1
    #   "created": 1376416565238
    #   "instances": 10
    #   "neededExperience": {
    #     "domain": "experienceDomain" 
    #     "value": 0 }
    #   "priority": 100
    #   "seedIdHeidelberg": 0
    
    elementID = element._id.$oid

    filledTemplate = @template    

    filledTemplate = filledTemplate.replace( /href="[^\"]*"/g, (match) ->
      
      # href="" isn't a very precise selector; wont work for data-href etc.
      # so, ignore failing route access
      try
        # remove href=" and "
        propertyChain = match.slice(6, match.length - 1)
        properties = propertyChain.split(".")

        currentObject = jsRoutes
        for currentProperty in properties
          unless currentProperty == "routes"
            currentObject = currentObject[currentProperty]

        pathProvider = currentObject
        url = pathProvider(elementID).url
        return 'href="' + url + '"'

      catch e
        return match
    )


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