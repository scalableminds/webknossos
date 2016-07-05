React      = require("react")
ReactDOM   = require("react-dom")
Comment    = require("./comment")


TreeCommentList = React.createClass(

  render : ->

    containsActiveNode = @props.treeId == @props.activeTreeId

    # don't render the comment nodes if the tree is collapsed
    commentNodes = if not @state.collapsed then @props.comments.map( (comment) =>
      return (
        <Comment
          key={comment.node}
          data={comment}
          treeId={@props.treeId}
          isActive={comment.node == @props.activeNodeId}
          onNewActiveNode={@props.onNewActiveNode}
        />
      )
    ) else null

    icon = if @state.collapsed then "fa-chevron-right" else "fa-chevron-down"

    # one tree and its comments
    return (
      <div>
        <li className={if containsActiveNode then "bold" else ""}>
          <i className={"fa fa-fw " + icon} onClick={@handleClick}></i>
          {@props.treeId} - {@props.treeName}
        </li>
        {commentNodes}
      </div>
    )


  handleClick : ->

    @setState({ collapsed : !@state.collapsed })


  getInitialState : ->

    return { collapsed : false }
)

module.exports = TreeCommentList
