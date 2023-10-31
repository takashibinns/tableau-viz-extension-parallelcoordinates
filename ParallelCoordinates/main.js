'use strict';

// Wrap everything in an anonymous function to avoid polluting the global namespace
(function () {
  window.onload = tableau.extensions.initializeAsync().then(() => {
    // Get the worksheet that the Viz Extension is running in
    const worksheet = tableau.extensions.worksheetContent.worksheet;

    // Save these outside the scope below for handling resizing without refetching the data
    let summaryData = {};
    let encodingMap = {};

    // Use the extensions API to get the summary data and map of encodings to fields,
    // and render the connected scatterplot.
    const updateDataAndRender = async () => {
      // Use extensions API to update the table of data and the map from encodings to fields
      [summaryData, encodingMap] = await Promise.all([
        getSummaryDataTable(worksheet),
        getEncodingMap(worksheet)
      ]);

      render(summaryData, encodingMap);
    };

    // Handle re-rendering when the page is resized
    onresize = () => render(summaryData, encodingMap);

    // Listen to event for when the summary data backing the worksheet has changed.
    // This tells us that we should refresh the data and encoding map.
    worksheet.addEventListener(
      tableau.TableauEventType.SummaryDataChanged,
      updateDataAndRender
    );

    // Do the initial update and render
    updateDataAndRender();
  });

  // Takes a page of data, which has a list of DataValues (dataTablePage.data)
  // and a list of columns and puts the data in a list where each entry is an
  // object that maps from field names to DataValues
  // (example of a row being: { SUM(Sales): ..., SUM(Profit): ..., Ship Mode: ..., })
  function convertToListOfNamedRows (dataTablePage) {
    const rows = [];
    const columns = dataTablePage.columns;
    const data = dataTablePage.data;
    for (let i = data.length - 1; i >= 0; --i) {
      const row = {};
      for (let j = 0; j < columns.length; ++j) {
        row[columns[j].fieldName] = data[i][columns[j].index];
      }
      rows.push(row);
    }
    return rows;
  }

  // Gets each page of data in the summary data and returns a list of rows of data
  // associated with field names.
  async function getSummaryDataTable (worksheet) {
    let rows = [];

    // Fetch the summary data using the DataTableReader
    const dataTableReader = await worksheet.getSummaryDataReaderAsync(
      undefined,
      { ignoreSelection: true }
    );
    for (
      let currentPage = 0;
      currentPage < dataTableReader.pageCount;
      currentPage++
    ) {
      const dataTablePage = await dataTableReader.getPageAsync(currentPage);
      rows = rows.concat(convertToListOfNamedRows(dataTablePage));
    }
    await dataTableReader.releaseAsync();

    return rows;
  }

  // Uses getVisualSpecificationAsync to build a map of encoding identifiers (specified in the .trex file)
  // to fields that the user has placed on the encoding's shelf.
  // Only encodings that have fields dropped on them will be part of the encodingMap.
  async function getEncodingMap (worksheet) {
    const visualSpec = await worksheet.getVisualSpecificationAsync();

    const encodingMap = {};

    if (visualSpec.activeMarksSpecificationIndex < 0) return encodingMap;

    const marksCard =
      visualSpec.marksSpecifications[visualSpec.activeMarksSpecificationIndex];
    for (const encoding of marksCard.encodings) { encodingMap[encoding.id] = encoding.field; }

    return encodingMap;
  }

  // A convenience function for using a possibly undefined encoding to access something dependent on it being defined.
  function useOptionalEncoding (encoding, valFunc) {
    if (encoding) {
      return valFunc(encoding);
    }

    return undefined;
  }

  // Renders the scatterplot to the content area of the Viz Extensions given the data and mapping from encodings to fields.
  function render (data, encodings) {
    
    // Clear the content region before we render
    const content = document.getElementById('content');
    content.innerHTML = '';

    //  Determine the sizing for the chart
    const sizing = {
      height: content.offsetHeight,
      width: content.offsetWidth,
      margin: {
        top: 30,        // top margin, in pixels
        right: 10,      // right margin, in pixels
        bottom: 30,     // bottom margin, in pixels
        left: 10        // left margin, in pixels
      }
    }

    //  Create the base SVG for our chart, and append to the page
    let svg = d3.select('#content')
      .append("svg")
        .attr("width", sizing.width)
        .attr("height", sizing.height)
        .attr('viewBox', [0, 0, sizing.width, sizing.height])
        .attr('style', 'max-width: 100%; height: auto; height: intrinsic;')
        .attr('class', tableau.ClassNameKey.Worksheet) // Use Workbook Formatting settings for Worksheet
      .append("g")
        .attr("transform", `translate(${sizing.margin.left},${sizing.margin.top})`);

    //  Create a tooltip
    let tip = d3.select("body").append("div")
      .attr("class", "tooltip")
      .style("position","fixed")
      .style("opacity", 0)
    //  Populate the SVG
    ParallelCoordinates(data, encodings, svg, tip, sizing);
  }
  
  //  Draw a Parallel Coordinates chart within the SVG
  //  Source: https://d3-graph-gallery.com/graph/parallel_custom.html
  function ParallelCoordinates(data, encodings, svg, tip, sizing){

    //  Get the name of the dimension & color
    const dimensionName = encodings.dimensions.name;
    const colorName = encodings.color?.name;

    //  Start from a predefined color palette (Tableau Classic 10)
    const colorPalette = ['#17becf','#bcbd22','#7f7f7f','#e377c2','#8c564b','#9467bd','#d62728','#2ca02c','#ff7f0e','#1f77b4'];

    //  Define a function that strips out special characters, so that we can use the color value as a classname
    const colorValueClassname = (colorValue) => {
      return colorValue.replace(/[^a-zA-Z0-9]/g,'_');
    }

    // Extract the list of dimensions we want to keep in the plot. Here I keep all except the column called Species
    let measures = Object.keys(data[0]).filter(function(d) { return d != dimensionName && d!= colorName})

    //  Function to remove duplicates from an array
    const removeDuplicates = (data)  => { return [...new Set(data)]};

    //  Function to generate a color, based off a palette
    const getColor = (domain) => {

      //  Do we need to generate new colors based on the palette?
      if (domain.length <= colorPalette.length){

        //  There are more colors in the palette than needed, so return 1 color per domain value
        return colorPalette.slice(0,domain.length-1);

      } else {

        //  There are more domain values than colors in the palette, need to generate additional colors
        const adjustColor = (col,amt) => {
          //  Remove the # in front of the hex code
          if ( col[0] == "#" ) {
            col = col.slice(1);
          }
          var num = parseInt(col,16);
          var r = (num >> 16) + amt;

          if ( r > 255 ) r = 255;
          else if  (r < 0) r = 0;

          var b = ((num >> 8) & 0x00FF) + amt;
          if ( b > 255 ) b = 255;
          else if  (b < 0) b = 0;
          
          var g = (num & 0x0000FF) + amt;
          if ( g > 255 ) g = 255;
          else if  ( g < 0 ) g = 0;

          return ("#" + (g | (b << 8) | (r << 16))).toString(16);
        }

        //  Create a new array with the same size as the domain values, and calculate a new color value for each
        let newColors = [];
        domain.forEach( (domainValue,index) => {
          const cycle = Math.floor(index / (colorPalette.length-1));
          const baseColor = colorPalette[index % (colorPalette.length-1)];
          newColors.push(adjustColor(baseColor,cycle*5))
        })

        return newColors;
      }
    }

    //  Get a list of all color values
    let colorDomain = [];
    if (colorName) {
      colorDomain = removeDuplicates(data.map( row => { return row[colorName].value }));
    }

    const color = d3.scaleOrdinal()
      .domain(colorDomain)
      .range(getColor(colorDomain))

    // For each measure, I build a linear scale. I store all in a y object
    var y = {}
    for (let i in measures) {
      const name = measures[i]
      y[name] = d3.scaleLinear()
        .domain( d3.extent(data, function(d) { return +d[name].nativeValue; }) )
        .range([sizing.height, 0])
    }

    // Build the X scale -> it find the best position for each Y axis
    let x = d3.scalePoint()
      .range([0, sizing.width])
      .padding(1)
      .domain(measures);

    

    /**********************/
    /*  Highlight lines   */
    /**********************/

    // Highlight the lines with the same color
    const highlight = function(d){
      //  Only run when there is a color dimension defined
      if (colorName) {

        //  Get the color value
        let data = d.target?.__data__;
        let selectedColorValue = data.hasOwnProperty(colorName) ? colorValueClassname(data[colorName].value) : ""; 
        
        // first every group turns grey
        d3.selectAll(".line")
          .transition().duration(200)
          .style("stroke", "lightgrey")
          .style("opacity", "0.2")
        // Second the hovered specie takes its color
        d3.selectAll("." + selectedColorValue)
          .transition().duration(200)
          .style("stroke", color(selectedColorValue))
          .style("opacity", "1")
      }
    }
    // Unhighlight
    const doNotHighlight = function(d){
      //  Only run when there is a color dimension defined
      if (colorName) {
        d3.selectAll(".line")
          .transition().duration(200).delay(1000)
          .style("stroke", function(d){ return(color(d[colorName].value))} )
          .style("opacity", "1")
      }
    }

    /****************/
    /*  Tooltips    */
    /****************/

    //  Show tooltip
    const showTooltip = (d) => {
      //  Build the tooltip contents
      let tooltipContent = '';
      for (const [key,datapoint] of Object.entries(d.target.__data__)){
        tooltipContent += `${key}: ${datapoint.formattedValue}<br/>`;
      }

      //  Set the content and display the tooltip
      tip.style("opacity", 1)
        .html(tooltipContent)
        .style("left", (d.pageX-25) + "px")
        .style("top", (d.pageY-75) + "px")
        tip.style("display","block");
    }

    //  Hide tooltip
    const hideTooltip = (d) => {
      const delay = 1 * 1000;   // 1 second
      setTimeout(() => {
        tip.style("opacity",0);  
        tip.style("display","none");
      }, delay);
    }

    /**********************/
    /*  Draw SVG contents */
    /**********************/

    // The path function take a row of the csv as input, and return x and y coordinates of the line to draw for this raw.
    function path(d) {
      return d3.line()(measures.map(function(p) { return [x(p), y[p](d[p].nativeValue)]; }));
    }

    // Draw the lines
    svg
      .selectAll("myPath")
      .data(data)
      .enter()
      .append("path")
        .attr("class", function (d) {  return d[colorName] ? "line " + colorValueClassname(d[colorName].value) : "line"; })  // 2 class for each line: 'line' and the group name
        .attr("d",  path)
        .style("fill", "none")
        .style("stroke", function(d){ return( color(d[colorName]))} )
        .style("opacity", 0.5)
        .on("mouseover.highlight", highlight)
        .on("mouseleave.highlight", doNotHighlight)
        .on("mouseover.tooltip", showTooltip)
        .on("mouseleave.tooltip", hideTooltip)

    // Draw the axis
    svg.selectAll("myAxis")
      // For each dimension of the dataset I add a 'g' element:
      .data(measures).enter()
      .append("g")
        .attr("class", "axis")
        // I translate this element to its right position on the x axis
        .attr("transform", function(d) { return "translate(" + x(d) + ")"; })
        // And I build the axis with the call function
        .each(function(d) { d3.select(this).call(d3.axisLeft().ticks(5).scale(y[d])); })
        // Add axis title
        .append("text")
          .style("text-anchor", "middle")
          .attr("y", -9)
          .text(function(d) { return d; })
          .style("fill", "black")

  }

})();
