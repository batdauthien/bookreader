/*
Copyright(c)2008-2009 Internet Archive. Software license AGPL version 3.

This file is part of GnuBook.

    GnuBook is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    GnuBook is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with GnuBook.  If not, see <http://www.gnu.org/licenses/>.
    
    The GnuBook source is hosted at http://github.com/openlibrary/bookreader/

    archive.org cvs $Revision: 1.2 $ $Date: 2009-06-22 18:42:51 $
*/

// GnuBook()
//______________________________________________________________________________
// After you instantiate this object, you must supply the following
// book-specific functions, before calling init():
//  - getPageWidth()
//  - getPageHeight()
//  - getPageURI()
// You must also add a numLeafs property before calling init().

function GnuBook() {
    this.reduce  = 4;
    this.padding = 10;
    this.mode    = 1; //1 or 2
    this.ui = 'full'; // UI mode
    
    this.displayedIndices = [];	
    //this.indicesToDisplay = [];
    this.imgs = {};
    this.prefetchedImgs = {}; //an object with numeric keys cooresponding to page index
    
    this.timer     = null;
    this.animating = false;
    this.auto      = false;
    this.autoTimer = null;
    this.flipSpeed = 'fast';

    this.twoPagePopUp = null;
    this.leafEdgeTmp  = null;
    this.embedPopup = null;
    
    this.searchResults = {};
    
    this.firstIndex = null;
    
    this.lastDisplayableIndex2up = null;
    
    // We link to index.php to avoid redirect which breaks back button
    this.logoURL = 'http://www.archive.org/index.php';
    
    // Base URL for images
    this.imagesBaseURL = '/bookreader/images/';
    
    // Mode constants
    this.constMode1up = 1;
    this.constMode2up = 2;
    
};

// init()
//______________________________________________________________________________
GnuBook.prototype.init = function() {

    var startIndex = undefined;
    
    // Find start index and mode if set in location hash
    var params = this.paramsFromFragment(window.location.hash);
        
    if ('undefined' != typeof(params.index)) {
        startIndex = params.index;
    } else if ('undefined' != typeof(params.page)) {
        startIndex = this.getPageIndex(params.page);
    }
    
    if ('undefined' == typeof(startIndex)) {
        if ('undefined' != typeof(this.titleLeaf)) {
            startIndex = this.leafNumToIndex(this.titleLeaf);
        }
    }
    
    if ('undefined' == typeof(startIndex)) {
        startIndex = 0;
    }
    
    if ('undefined' != typeof(params.mode)) {
        this.mode = params.mode;
    }
    
    // Set document title -- may have already been set in enclosing html for
    // search engine visibility
    document.title = this.shortTitle(50);
    
    $("#GnuBook").empty();
    this.initToolbar(this.mode, this.ui); // Build inside of toolbar div
    $("#GnuBook").append("<div id='GBcontainer'></div>");
    $("#GBcontainer").append("<div id='GBpageview'></div>");

    $("#GBcontainer").bind('scroll', this, function(e) {
        e.data.loadLeafs();
    });

    this.setupKeyListeners();
    this.startLocationPolling();

    $(window).bind('resize', this, function(e) {
        //console.log('resize!');
        if (1 == e.data.mode) {
            //console.log('centering 1page view');
            e.data.centerPageView();
            $('#GBpageview').empty()
            e.data.displayedIndices = [];
            e.data.updateSearchHilites(); //deletes hilights but does not call remove()            
            e.data.loadLeafs();
        } else {
            //console.log('drawing 2 page view');
            e.data.prepareTwoPageView();
        }
    });
    
    $('.GBpagediv1up').bind('mousedown', this, function(e) {
        //console.log('mousedown!');
    });

    if (1 == this.mode) {
        this.resizePageView();
        this.firstIndex = startIndex;
        this.jumpToIndex(startIndex);
    } else {
        //this.resizePageView();
        
        this.displayedIndices=[0];
        this.firstIndex = startIndex;
        this.displayedIndices = [this.firstIndex];
        //console.log('titleLeaf: %d', this.titleLeaf);
        //console.log('displayedIndices: %s', this.displayedIndices);
        this.prepareTwoPageView();
        //if (this.auto) this.nextPage();
    }
    
    // Enact other parts of initial params
    this.updateFromParams(params);
}

GnuBook.prototype.setupKeyListeners = function() {
    var self = this;

    var KEY_PGUP = 33;
    var KEY_PGDOWN = 34;
    var KEY_END = 35;
    var KEY_HOME = 36;

    var KEY_LEFT = 37;
    var KEY_UP = 38;
    var KEY_RIGHT = 39;
    var KEY_DOWN = 40;

    // We use document here instead of window to avoid a bug in jQuery on IE7
    $(document).keydown(function(e) {
        
        // Keyboard navigation        
        switch(e.keyCode) {
            case KEY_PGUP:
            case KEY_UP:            
                // In 1up mode page scrolling is handled by browser
                if (2 == self.mode) {
                    self.prev();
                }
                break;
            case KEY_DOWN:
            case KEY_PGDOWN:
                if (2 == self.mode) {
                    self.next();
                }
                break;
            case KEY_END:
                self.last();
                break;
            case KEY_HOME:
                self.first();
                break;
            case KEY_LEFT:
                if (self.keyboardNavigationIsDisabled(e)) {
                    break;
                }
                if (2 == self.mode) {
                    self.left();
                }
                break;
            case KEY_RIGHT:
                if (self.keyboardNavigationIsDisabled(e)) {
                    break;
                }
                if (2 == self.mode) {
                    self.right();
                }
                break;
        }
    });
}

// drawLeafs()
//______________________________________________________________________________
GnuBook.prototype.drawLeafs = function() {
    if (1 == this.mode) {
        this.drawLeafsOnePage();
    } else {
        this.drawLeafsTwoPage();
    }
}

// setDragHandler1up()
//______________________________________________________________________________
GnuBook.prototype.setDragHandler1up = function(div) {
    div.dragging = false;

    $(div).bind('mousedown', function(e) {
        //console.log('mousedown at ' + e.pageY);

        this.dragging = true;
        this.prevMouseX = e.pageX;
        this.prevMouseY = e.pageY;
    
        var startX    = e.pageX;
        var startY    = e.pageY;
        var startTop  = $('#GBcontainer').attr('scrollTop');
        var startLeft =  $('#GBcontainer').attr('scrollLeft');

        return false;
    });
        
    $(div).bind('mousemove', function(ee) {
        //console.log('mousemove ' + startY);
        
        var offsetX = ee.pageX - this.prevMouseX;
        var offsetY = ee.pageY - this.prevMouseY;
        
        if (this.dragging) {
            $('#GBcontainer').attr('scrollTop', $('#GBcontainer').attr('scrollTop') - offsetY);
            $('#GBcontainer').attr('scrollLeft', $('#GBcontainer').attr('scrollLeft') - offsetX);
        }
        
        this.prevMouseX = ee.pageX;
        this.prevMouseY = ee.pageY;
        
        return false;
    });
    
    $(div).bind('mouseup', function(ee) {
        //console.log('mouseup');

        this.dragging = false;
        return false;
    });
    
    $(div).bind('mouseleave', function(e) {
        //console.log('mouseleave');

        //$(this).unbind('mousemove mouseup');
        this.dragging = false;
        
    });
}

// drawLeafsOnePage()
//______________________________________________________________________________
GnuBook.prototype.drawLeafsOnePage = function() {
    //alert('drawing leafs!');
    this.timer = null;


    var scrollTop = $('#GBcontainer').attr('scrollTop');
    var scrollBottom = scrollTop + $('#GBcontainer').height();
    //console.log('top=' + scrollTop + ' bottom='+scrollBottom);
    
    var indicesToDisplay = [];
    
    var i;
    var leafTop = 0;
    var leafBottom = 0;
    for (i=0; i<this.numLeafs; i++) {
        var height  = parseInt(this.getPageHeight(i)/this.reduce); 
    
        leafBottom += height;
        //console.log('leafTop = '+leafTop+ ' pageH = ' + this.pageH[i] + 'leafTop>=scrollTop=' + (leafTop>=scrollTop));
        var topInView    = (leafTop >= scrollTop) && (leafTop <= scrollBottom);
        var bottomInView = (leafBottom >= scrollTop) && (leafBottom <= scrollBottom);
        var middleInView = (leafTop <=scrollTop) && (leafBottom>=scrollBottom);
        if (topInView | bottomInView | middleInView) {
            //console.log('displayed: ' + this.displayedIndices);
            //console.log('to display: ' + i);
            indicesToDisplay.push(i);
        }
        leafTop += height +10;      
        leafBottom += 10;
    }

    var firstIndexToDraw  = indicesToDisplay[0];
    this.firstIndex      = firstIndexToDraw;
    
    // Update hash, but only if we're currently displaying a leaf
    // Hack that fixes #365790
    if (this.displayedIndices.length > 0) {
        this.updateLocationHash();
    }

    if ((0 != firstIndexToDraw) && (1 < this.reduce)) {
        firstIndexToDraw--;
        indicesToDisplay.unshift(firstIndexToDraw);
    }
    
    var lastIndexToDraw = indicesToDisplay[indicesToDisplay.length-1];
    if ( ((this.numLeafs-1) != lastIndexToDraw) && (1 < this.reduce) ) {
        indicesToDisplay.push(lastIndexToDraw+1);
    }
    
    leafTop = 0;
    var i;
    for (i=0; i<firstIndexToDraw; i++) {
        leafTop += parseInt(this.getPageHeight(i)/this.reduce) +10;
    }

    //var viewWidth = $('#GBpageview').width(); //includes scroll bar width
    var viewWidth = $('#GBcontainer').attr('scrollWidth');


    for (i=0; i<indicesToDisplay.length; i++) {
        var index = indicesToDisplay[i];    
        var height  = parseInt(this.getPageHeight(index)/this.reduce); 

        if(-1 == jQuery.inArray(indicesToDisplay[i], this.displayedIndices)) {            
            var width   = parseInt(this.getPageWidth(index)/this.reduce); 
            //console.log("displaying leaf " + indicesToDisplay[i] + ' leafTop=' +leafTop);
            var div = document.createElement("div");
            div.className = 'GBpagediv1up';
            div.id = 'pagediv'+index;
            div.style.position = "absolute";
            $(div).css('top', leafTop + 'px');
            var left = (viewWidth-width)>>1;
            if (left<0) left = 0;
            $(div).css('left', left+'px');
            $(div).css('width', width+'px');
            $(div).css('height', height+'px');
            //$(div).text('loading...');
            
            this.setDragHandler1up(div);
            
            $('#GBpageview').append(div);

            var img = document.createElement("img");
            img.src = this.getPageURI(index);
            $(img).css('width', width+'px');
            $(img).css('height', height+'px');
            $(div).append(img);

        } else {
            //console.log("not displaying " + indicesToDisplay[i] + ' score=' + jQuery.inArray(indicesToDisplay[i], this.displayedIndices));            
        }

        leafTop += height +10;

    }
    
    for (i=0; i<this.displayedIndices.length; i++) {
        if (-1 == jQuery.inArray(this.displayedIndices[i], indicesToDisplay)) {
            var index = this.displayedIndices[i];
            //console.log('Removing leaf ' + index);
            //console.log('id='+'#pagediv'+index+ ' top = ' +$('#pagediv'+index).css('top'));
            $('#pagediv'+index).remove();
        } else {
            //console.log('NOT Removing leaf ' + this.displayedIndices[i]);
        }
    }
    
    this.displayedIndices = indicesToDisplay.slice();
    this.updateSearchHilites();
    
    if (null != this.getPageNum(firstIndexToDraw))  {
        $("#GBpagenum").val(this.getPageNum(this.currentIndex()));
    } else {
        $("#GBpagenum").val('');
    }
}

// drawLeafsTwoPage()
//______________________________________________________________________________
GnuBook.prototype.drawLeafsTwoPage = function() {
    //alert('drawing two leafs!');

    var scrollTop = $('#GBcontainer').attr('scrollTop');
    var scrollBottom = scrollTop + $('#GBcontainer').height();
    
    //console.log('drawLeafsTwoPage: this.currrentLeafL ' + this.currentIndexL);
    
    var index = this.currentIndexL;
    var height  = this.getPageHeight(index); 
    var width   = this.getPageWidth(index);
    var handSide= this.getPageSide(index);

    var leafEdgeWidthL = this.leafEdgeWidth(index);
    var leafEdgeWidthR = this.twoPageEdgeW - leafEdgeWidthL;
    var bookCoverDivWidth = this.twoPageW*2+20 + this.twoPageEdgeW;
    var bookCoverDivLeft = ($('#GBcontainer').width() - bookCoverDivWidth) >> 1;
    //console.log(leafEdgeWidthL);

    var middle = ($('#GBcontainer').width() >> 1);            
    var left = middle - this.twoPageW;
    var top  = ($('#GBcontainer').height() - this.twoPageH) >> 1;                

    var scaledW = parseInt(this.twoPageH*width/height);
    left = 10+leafEdgeWidthL;
    //var right = left+scaledW;
    var right = $(this.twoPageDiv).width()-11-$(this.leafEdgeL).width()-scaledW;

    var gutter = middle + this.gutterOffsetForIndex(this.currentIndexL);
    
    this.prefetchImg(index);
    $(this.prefetchedImgs[index]).css({
        position: 'absolute',
        /*right:   gutter+'px',*/
        left: gutter-scaledW+'px',
        right: '',
        top:    top+'px',
        backgroundColor: 'rgb(234, 226, 205)',
        height: this.twoPageH +'px',
        width:  scaledW + 'px',
        borderRight: '1px solid black',
        zIndex: 2
    }).appendTo('#GBcontainer');
    //$('#GBcontainer').append(this.prefetchedImgs[index]);


    var index = this.currentIndexR;
    var height  = this.getPageHeight(index); 
    var width   = this.getPageWidth(index);
    //    var left = ($('#GBcontainer').width() >> 1);
    left += scaledW;

    var scaledW = this.twoPageH*width/height;
    this.prefetchImg(index);
    $(this.prefetchedImgs[index]).css({
        position: 'absolute',
        left:   gutter+'px',
        right: '',
        top:    top+'px',
        backgroundColor: 'rgb(234, 226, 205)',
        height: this.twoPageH + 'px',
        width:  scaledW + 'px',
        borderLeft: '1px solid black',
        zIndex: 2
    }).appendTo('#GBcontainer');
    //$('#GBcontainer').append(this.prefetchedImgs[index]);
        

    this.displayedIndices = [this.currentIndexL, this.currentIndexR];
    this.setClickHandlers();

    this.updatePageNumBox2UP();
}

// updatePageNumBox2UP
//______________________________________________________________________________
GnuBook.prototype.updatePageNumBox2UP = function() {
    if (null != this.getPageNum(this.currentIndexL))  {
        $("#GBpagenum").val(this.getPageNum(this.currentIndexL));
    } else {
        $("#GBpagenum").val('');
    }
    this.updateLocationHash();
}

// loadLeafs()
//______________________________________________________________________________
GnuBook.prototype.loadLeafs = function() {


    var self = this;
    if (null == this.timer) {
        this.timer=setTimeout(function(){self.drawLeafs()},250);
    } else {
        clearTimeout(this.timer);
        this.timer=setTimeout(function(){self.drawLeafs()},250);    
    }
}


// zoom1up()
//______________________________________________________________________________
GnuBook.prototype.zoom1up = function(dir) {
    if (2 == this.mode) {     //can only zoom in 1-page mode
        this.switchMode(1);
        return;
    }
    
    if (1 == dir) {
        if (this.reduce <= 0.5) return;
        this.reduce*=0.5;           //zoom in
    } else {
        if (this.reduce >= 8) return;
        this.reduce*=2;             //zoom out
    }
    
    this.resizePageView();

    $('#GBpageview').empty()
    this.displayedIndices = [];
    this.loadLeafs();
    
    $('#GBzoom').text(100/this.reduce);
}

// resizePageView()
//______________________________________________________________________________
GnuBook.prototype.resizePageView = function() {
    var i;
    var viewHeight = 0;
    //var viewWidth  = $('#GBcontainer').width(); //includes scrollBar
    var viewWidth  = $('#GBcontainer').attr('clientWidth');   

    var oldScrollTop  = $('#GBcontainer').attr('scrollTop');
    var oldViewHeight = $('#GBpageview').height();
    if (0 != oldViewHeight) {
        var scrollRatio = oldScrollTop / oldViewHeight;
    } else {
        var scrollRatio = 0;
    }
    
    for (i=0; i<this.numLeafs; i++) {
        viewHeight += parseInt(this.getPageHeight(i)/this.reduce) + this.padding; 
        var width = parseInt(this.getPageWidth(i)/this.reduce);
        if (width>viewWidth) viewWidth=width;
    }
    $('#GBpageview').height(viewHeight);
    $('#GBpageview').width(viewWidth);    

    $('#GBcontainer').attr('scrollTop', Math.floor(scrollRatio*viewHeight));
    
    this.centerPageView();
    this.loadLeafs();
    
}

// centerPageView()
//______________________________________________________________________________
GnuBook.prototype.centerPageView = function() {

    var scrollWidth  = $('#GBcontainer').attr('scrollWidth');
    var clientWidth  =  $('#GBcontainer').attr('clientWidth');
    //console.log('sW='+scrollWidth+' cW='+clientWidth);
    if (scrollWidth > clientWidth) {
        $('#GBcontainer').attr('scrollLeft', (scrollWidth-clientWidth)/2);
    }

}

// jumpToPage()
//______________________________________________________________________________
// Attempts to jump to page.  Returns true if page could be found, false otherwise.
GnuBook.prototype.jumpToPage = function(pageNum) {

    var pageIndex = this.getPageIndex(pageNum);

    if ('undefined' != typeof(pageIndex)) {
        var leafTop = 0;
        var h;
        this.jumpToIndex(pageIndex);
        $('#GBcontainer').attr('scrollTop', leafTop);
        return true;
    }
    
    // Page not found
    return false;
}

// jumpToIndex()
//______________________________________________________________________________
GnuBook.prototype.jumpToIndex = function(index) {

    if (2 == this.mode) {
        this.autoStop();
        
        // By checking against min/max we do nothing if requested index
        // is current
        if (index < Math.min(this.currentIndexL, this.currentIndexR)) {
            this.flipBackToIndex(index);
        } else if (index > Math.max(this.currentIndexL, this.currentIndexR)) {
            this.flipFwdToIndex(index);
        }

    } else {        
        var i;
        var leafTop = 0;
        var h;
        for (i=0; i<index; i++) {
            h = parseInt(this.getPageHeight(i)/this.reduce); 
            leafTop += h + this.padding;
        }
        //$('#GBcontainer').attr('scrollTop', leafTop);
        $('#GBcontainer').animate({scrollTop: leafTop },'fast');
    }
}



// switchMode()
//______________________________________________________________________________
GnuBook.prototype.switchMode = function(mode) {

    //console.log('  asked to switch to mode ' + mode + ' from ' + this.mode);
    
    if (mode == this.mode) return;

    this.autoStop();
    this.removeSearchHilites();

    this.mode = mode;
    
    this.switchToolbarMode(mode);
    
    if (1 == mode) {
        this.prepareOnePageView();
    } else {
        this.prepareTwoPageView();
    }

}

//prepareOnePageView()
//______________________________________________________________________________
GnuBook.prototype.prepareOnePageView = function() {

    // var startLeaf = this.displayedIndices[0];
    var startLeaf = this.currentIndex();
    
    $('#GBcontainer').empty();
    $('#GBcontainer').css({
        overflowY: 'scroll',
        overflowX: 'auto'
    });
    
    var gbPageView = $("#GBcontainer").append("<div id='GBpageview'></div>");
    this.resizePageView();
    
    this.jumpToIndex(startLeaf);
    this.displayedIndices = [];
    
    this.drawLeafsOnePage();
    $('#GBzoom').text(100/this.reduce);
        
    // Bind mouse handlers
    // Disable mouse click to avoid selected/highlighted page images - bug 354239
    gbPageView.bind('mousedown', function(e) {
        return false;
    })
    // Special hack for IE7
    gbPageView[0].onselectstart = function(e) { return false; };
}

// prepareTwoPageView()
//______________________________________________________________________________
GnuBook.prototype.prepareTwoPageView = function() {
    $('#GBcontainer').empty();

    // We want to display two facing pages.  We may be missing
    // one side of the spread because it is the first/last leaf,
    // foldouts, missing pages, etc

    //var targetLeaf = this.displayedIndices[0];
    var targetLeaf = this.firstIndex;

    if (targetLeaf < this.firstDisplayableIndex()) {
        targetLeaf = this.firstDisplayableIndex();
    }
    
    if (targetLeaf > this.lastDisplayableIndex()) {
        targetLeaf = this.lastDisplayableIndex();
    }
    
    this.currentIndexL = null;
    this.currentIndexR = null;
    this.pruneUnusedImgs();
    
    var currentSpreadIndices = this.getSpreadIndices(targetLeaf);
    this.currentIndexL = currentSpreadIndices[0];
    this.currentIndexR = currentSpreadIndices[1];
    this.firstIndex = this.currentIndexL;
    
    this.calculateSpreadSize(); //sets this.twoPageW, twoPageH, and twoPageRatio

    // We want to minimize the unused space in two-up mode (maximize the amount of page
    // shown).  We give width to the leaf edges and these widths change (though the sum
    // of the two remains constant) as we flip through the book.  With the book
    // cover centered and fixed in the GBcontainer div the page images will meet
    // at the "gutter" which is generally offset from the center.
    var middle = ($('#GBcontainer').width() >> 1); // Middle of the GBcontainer div
    //var gutter = middle+parseInt((2*this.currentIndexL - this.numLeafs)*this.twoPageEdgeW/this.numLeafs/2);
    
    var gutter = middle + this.gutterOffsetForIndex(this.currentIndexL);
    
    var scaledWL = this.getPageWidth2UP(this.currentIndexL);
    var scaledWR = this.getPageWidth2UP(this.currentIndexR);
    var leafEdgeWidthL = this.leafEdgeWidth(this.currentIndexL);
    var leafEdgeWidthR = this.twoPageEdgeW - leafEdgeWidthL;

    //console.log('idealWidth='+idealWidth+' idealHeight='+idealHeight);
    //var bookCoverDivWidth = this.twoPageW*2+20 + this.twoPageEdgeW;
    
    // The width of the book cover div.  The combined width of both pages, twice the width
    // of the book cover internal padding (2*10) and the page edges
    var bookCoverDivWidth = scaledWL + scaledWR + 20 + this.twoPageEdgeW;
    
    // The height of the book cover div
    var bookCoverDivHeight = this.twoPageH+20;
    
    //var bookCoverDivLeft = ($('#GBcontainer').width() - bookCoverDivWidth) >> 1;
    var bookCoverDivLeft = gutter-scaledWL-leafEdgeWidthL-10;
    var bookCoverDivTop = ($('#GBcontainer').height() - bookCoverDivHeight) >> 1;
    //console.log('bookCoverDivWidth='+bookCoverDivWidth+' bookCoverDivHeight='+bookCoverDivHeight+ ' bookCoverDivLeft='+bookCoverDivLeft+' bookCoverDivTop='+bookCoverDivTop);

    this.twoPageDiv = document.createElement('div');
    $(this.twoPageDiv).attr('id', 'book_div_1').css({
        border: '1px solid rgb(68, 25, 17)',
        width:  bookCoverDivWidth + 'px',
        height: bookCoverDivHeight+'px',
        visibility: 'visible',
        position: 'absolute',
        backgroundColor: '#663929',
        left: bookCoverDivLeft + 'px',
        top: bookCoverDivTop+'px',
        MozBorderRadiusTopleft: '7px',
        MozBorderRadiusTopright: '7px',
        MozBorderRadiusBottomright: '7px',
        MozBorderRadiusBottomleft: '7px'
    }).appendTo('#GBcontainer');
    //$('#GBcontainer').append('<div id="book_div_1" style="border: 1px solid rgb(68, 25, 17); width: ' + bookCoverDivWidth + 'px; height: '+bookCoverDivHeight+'px; visibility: visible; position: absolute; background-color: rgb(136, 51, 34); left: ' + bookCoverDivLeft + 'px; top: '+bookCoverDivTop+'px; -moz-border-radius-topleft: 7px; -moz-border-radius-topright: 7px; -moz-border-radius-bottomright: 7px; -moz-border-radius-bottomleft: 7px;"/>');


    var height  = this.getPageHeight(this.currentIndexR); 
    var width   = this.getPageWidth(this.currentIndexR);    
    var scaledW = this.twoPageH*width/height;
    
    this.leafEdgeR = document.createElement('div');
    this.leafEdgeR.className = 'leafEdgeR';
    $(this.leafEdgeR).css({
        borderStyle: 'solid solid solid none',
        borderColor: 'rgb(51, 51, 34)',
        borderWidth: '1px 1px 1px 0px',
        background: 'transparent url(' + this.imagesBaseURL + 'right_edges.png) repeat scroll 0% 0%',
        width: leafEdgeWidthR + 'px',
        height: this.twoPageH-1 + 'px',
        /*right: '10px',*/
        left: gutter+scaledW+'px',
        top: bookCoverDivTop+10+'px',
        position: 'absolute'
    }).appendTo('#GBcontainer');
    
    this.leafEdgeL = document.createElement('div');
    this.leafEdgeL.className = 'leafEdgeL';
    $(this.leafEdgeL).css({
        borderStyle: 'solid none solid solid',
        borderColor: 'rgb(51, 51, 34)',
        borderWidth: '1px 0px 1px 1px',
        background: 'transparent url(' + this.imagesBaseURL + 'left_edges.png) repeat scroll 0% 0%',
        width: leafEdgeWidthL + 'px',
        height: this.twoPageH-1 + 'px',
        left: bookCoverDivLeft+10+'px',
        top: bookCoverDivTop+10+'px',    
        position: 'absolute'
    }).appendTo('#GBcontainer');



    bookCoverDivWidth = 30;
    bookCoverDivHeight = this.twoPageH+20;
    bookCoverDivLeft = ($('#GBcontainer').width() - bookCoverDivWidth) >> 1;
    bookCoverDivTop = ($('#GBcontainer').height() - bookCoverDivHeight) >> 1;

    div = document.createElement('div');
    $(div).attr('id', 'book_div_2').css({
        border:          '1px solid rgb(68, 25, 17)',
        width:           bookCoverDivWidth+'px',
        height:          bookCoverDivHeight+'px',
        position:        'absolute',
        backgroundColor: 'rgb(68, 25, 17)',
        left:            bookCoverDivLeft+'px',
        top:             bookCoverDivTop+'px'
    }).appendTo('#GBcontainer');
    //$('#GBcontainer').append('<div id="book_div_2" style="border: 1px solid rgb(68, 25, 17); width: '+bookCoverDivWidth+'px; height: '+bookCoverDivHeight+'px; visibility: visible; position: absolute; background-color: rgb(68, 25, 17); left: '+bookCoverDivLeft+'px; top: '+bookCoverDivTop+'px;"/>');

    bookCoverDivWidth = this.twoPageW*2;
    bookCoverDivHeight = this.twoPageH;
    bookCoverDivLeft = ($('#GBcontainer').width() - bookCoverDivWidth) >> 1;
    bookCoverDivTop = ($('#GBcontainer').height() - bookCoverDivHeight) >> 1;


    this.prepareTwoPagePopUp();

    this.displayedIndices = [];
    
    //this.indicesToDisplay=[firstLeaf, firstLeaf+1];
    //console.log('indicesToDisplay: ' + this.indicesToDisplay[0] + ' ' + this.indicesToDisplay[1]);
    
    this.drawLeafsTwoPage();
    this.updateSearchHilites2UP();
    
    this.prefetch();
    $('#GBzoom').text((100*this.twoPageH/this.getPageHeight(this.currentIndexL)).toString().substr(0,4));
}

// prepareTwoPagePopUp()
//
// This function prepares the "View Page n" popup that shows while the mouse is
// over the left/right "stack of sheets" edges.  It also binds the mouse
// events for these divs.
//______________________________________________________________________________
GnuBook.prototype.prepareTwoPagePopUp = function() {
    this.twoPagePopUp = document.createElement('div');
    $(this.twoPagePopUp).css({
        border: '1px solid black',
        padding: '2px 6px',
        position: 'absolute',
        fontFamily: 'sans-serif',
        fontSize: '14px',
        zIndex: '1000',
        backgroundColor: 'rgb(255, 255, 238)',
        opacity: 0.85
    }).appendTo('#GBcontainer');
    $(this.twoPagePopUp).hide();
    
    $(this.leafEdgeL).add(this.leafEdgeR).bind('mouseenter', this, function(e) {
        $(e.data.twoPagePopUp).show();
    });

    $(this.leafEdgeL).add(this.leafEdgeR).bind('mouseleave', this, function(e) {
        $(e.data.twoPagePopUp).hide();
    });

    $(this.leafEdgeL).bind('click', this, function(e) { 
        e.data.autoStop();
        var jumpIndex = e.data.jumpIndexForLeftEdgePageX(e.pageX);
        e.data.jumpToIndex(jumpIndex);
    });

    $(this.leafEdgeR).bind('click', this, function(e) { 
        e.data.autoStop();
        var jumpIndex = e.data.jumpIndexForRightEdgePageX(e.pageX);
        e.data.jumpToIndex(jumpIndex);    
    });

    $(this.leafEdgeR).bind('mousemove', this, function(e) {

        var jumpIndex = e.data.jumpIndexForRightEdgePageX(e.pageX);
        $(e.data.twoPagePopUp).text('View ' + e.data.getPageName(jumpIndex));
        
        $(e.data.twoPagePopUp).css({
            left: e.pageX +5+ 'px',
            top: e.pageY-$('#GBcontainer').offset().top+ 'px'
        });
    });

    $(this.leafEdgeL).bind('mousemove', this, function(e) {
    
        var jumpIndex = e.data.jumpIndexForLeftEdgePageX(e.pageX);
        $(e.data.twoPagePopUp).text('View '+ e.data.getPageName(jumpIndex));
        
        $(e.data.twoPagePopUp).css({
            left: e.pageX - $(e.data.twoPagePopUp).width() - 30 + 'px',
            top: e.pageY-$('#GBcontainer').offset().top+ 'px'
        });
    });
}

// calculateSpreadSize()
//______________________________________________________________________________
// Calculates 2-page spread dimensions based on this.currentIndexL and
// this.currentIndexR
// This function sets this.twoPageH, twoPageW, and twoPageRatio

GnuBook.prototype.calculateSpreadSize = function() {
    var firstIndex  = this.currentIndexL;
    var secondIndex = this.currentIndexR;
    //console.log('first page is ' + firstIndex);

    var canon5Dratio = 1.5;
    
    var firstIndexRatio  = this.getPageHeight(firstIndex) / this.getPageWidth(firstIndex);
    var secondIndexRatio = this.getPageHeight(secondIndex) / this.getPageWidth(secondIndex);
    //console.log('firstIndexRatio = ' + firstIndexRatio + ' secondIndexRatio = ' + secondIndexRatio);

    var ratio;
    if (Math.abs(firstIndexRatio - canon5Dratio) < Math.abs(secondIndexRatio - canon5Dratio)) {
        ratio = firstIndexRatio;
        //console.log('using firstIndexRatio ' + ratio);
    } else {
        ratio = secondIndexRatio;
        //console.log('using secondIndexRatio ' + ratio);
    }

    var totalLeafEdgeWidth = parseInt(this.numLeafs * 0.1);
    var maxLeafEdgeWidth   = parseInt($('#GBcontainer').width() * 0.1);
    totalLeafEdgeWidth     = Math.min(totalLeafEdgeWidth, maxLeafEdgeWidth);
    
    $('#GBcontainer').css('overflow', 'hidden');

    var idealWidth  = ($('#GBcontainer').width() - 30 - totalLeafEdgeWidth)>>1;
    var idealHeight = $('#GBcontainer').height() - 30;
    //console.log('init idealWidth='+idealWidth+' idealHeight='+idealHeight + ' ratio='+ratio);

    if (idealHeight/ratio <= idealWidth) {
        //use height
        idealWidth = parseInt(idealHeight/ratio);
    } else {
        //use width
        idealHeight = parseInt(idealWidth*ratio);
    }

    this.twoPageH     = idealHeight;
    this.twoPageW     = idealWidth;
    this.twoPageRatio = ratio;
    this.twoPageEdgeW = totalLeafEdgeWidth; // The combined width of both edges

}

// currentIndex()
//______________________________________________________________________________
// Returns the currently active index.
GnuBook.prototype.currentIndex = function() {
    // $$$ we should be cleaner with our idea of which index is active in 1up/2up
    if (this.mode == this.constMode1up || this.mode == this.constMode2up) {
        return this.firstIndex;
    } else {
        throw 'currentIndex called for unimplemented mode ' + this.mode;
    }
}

// right()
//______________________________________________________________________________
// Flip the right page over onto the left
GnuBook.prototype.right = function() {
    if ('rl' != this.pageProgression) {
        // LTR
        gb.next();
    } else {
        // RTL
        gb.prev();
    }
}

// rightmost()
//______________________________________________________________________________
// Flip to the rightmost page
GnuBook.prototype.rightmost = function() {
    if ('rl' != this.pageProgression) {
        gb.last();
    } else {
        gb.first();
    }
}

// left()
//______________________________________________________________________________
// Flip the left page over onto the right.
GnuBook.prototype.left = function() {
    if ('rl' != this.pageProgression) {
        // LTR
        gb.prev();
    } else {
        // RTL
        gb.next();
    }
}

// leftmost()
//______________________________________________________________________________
// Flip to the leftmost page
GnuBook.prototype.leftmost = function() {
    if ('rl' != this.pageProgression) {
        gb.first();
    } else {
        gb.last();
    }
}

// next()
//______________________________________________________________________________
GnuBook.prototype.next = function() {
    if (2 == this.mode) {
        this.autoStop();
        this.flipFwdToIndex(null);
    } else {
        if (this.firstIndex < this.lastDisplayableIndex()) {
            this.jumpToIndex(this.firstIndex+1);
        }
    }
}

// prev()
//______________________________________________________________________________
GnuBook.prototype.prev = function() {
    if (2 == this.mode) {
        this.autoStop();
        this.flipBackToIndex(null);
    } else {
        if (this.firstIndex >= 1) {
            this.jumpToIndex(this.firstIndex-1);
        }    
    }
}

GnuBook.prototype.first = function() {
    if (2 == this.mode) {
        this.jumpToIndex(2);
    }
    else {
        this.jumpToIndex(0);
    }
}

GnuBook.prototype.last = function() {
    if (2 == this.mode) {
        this.jumpToIndex(this.lastDisplayableIndex());
    }
    else {
        this.jumpToIndex(this.lastDisplayableIndex());
    }
}

// flipBackToIndex()
//______________________________________________________________________________
// to flip back one spread, pass index=null
GnuBook.prototype.flipBackToIndex = function(index) {
    if (1 == this.mode) return;

    var leftIndex = this.currentIndexL;
    
    // $$$ Need to change this to be able to see first spread.
    //     See https://bugs.launchpad.net/gnubook/+bug/296788
    if (leftIndex <= 2) return;
    if (this.animating) return;

    if (null != this.leafEdgeTmp) {
        alert('error: leafEdgeTmp should be null!');
        return;
    }
    
    if (null == index) {
        index = leftIndex-2;
    }
    //if (index<0) return;
    
    var previousIndices = this.getSpreadIndices(index);
    
    if (previousIndices[0] < 0 || previousIndices[1] < 0) {
        return;
    }
    
    //console.log("flipping back to " + previousIndices[0] + ',' + previousIndices[1]);

    this.animating = true;
    
    if ('rl' != this.pageProgression) {
        // Assume LTR and we are going backward    
        var gutter = this.prepareFlipLeftToRight(previousIndices[0], previousIndices[1]);        
        this.flipLeftToRight(previousIndices[0], previousIndices[1], gutter);
        
    } else {
        // RTL and going backward
        var gutter = this.prepareFlipRightToLeft(previousIndices[0], previousIndices[1]);
        this.flipRightToLeft(previousIndices[0], previousIndices[1], gutter);
    }
}

// flipLeftToRight()
//______________________________________________________________________________
// Flips the page on the left towards the page on the right
GnuBook.prototype.flipLeftToRight = function(newIndexL, newIndexR, gutter) {

    var leftLeaf = this.currentIndexL;
    
    var oldLeafEdgeWidthL = this.leafEdgeWidth(this.currentIndexL);
    var newLeafEdgeWidthL = this.leafEdgeWidth(newIndexL);    
    var leafEdgeTmpW = oldLeafEdgeWidthL - newLeafEdgeWidthL;
    
    var currWidthL   = this.getPageWidth2UP(leftLeaf);
    var newWidthL    = this.getPageWidth2UP(newIndexL);
    var newWidthR    = this.getPageWidth2UP(newIndexR);

    var top  = ($('#GBcontainer').height() - this.twoPageH) >> 1;                

    //console.log('leftEdgeTmpW ' + leafEdgeTmpW);
    //console.log('  gutter ' + gutter + ', scaledWL ' + scaledWL + ', newLeafEdgeWL ' + newLeafEdgeWidthL);
    
    //animation strategy:
    // 0. remove search highlight, if any.
    // 1. create a new div, called leafEdgeTmp to represent the leaf edge between the leftmost edge 
    //    of the left leaf and where the user clicked in the leaf edge.
    //    Note that if this function was triggered by left() and not a
    //    mouse click, the width of leafEdgeTmp is very small (zero px).
    // 2. animate both leafEdgeTmp to the gutter (without changing its width) and animate
    //    leftLeaf to width=0.
    // 3. When step 2 is finished, animate leafEdgeTmp to right-hand side of new right leaf
    //    (left=gutter+newWidthR) while also animating the new right leaf from width=0 to
    //    its new full width.
    // 4. After step 3 is finished, do the following:
    //      - remove leafEdgeTmp from the dom.
    //      - resize and move the right leaf edge (leafEdgeR) to left=gutter+newWidthR
    //          and width=twoPageEdgeW-newLeafEdgeWidthL.
    //      - resize and move the left leaf edge (leafEdgeL) to left=gutter-newWidthL-newLeafEdgeWidthL
    //          and width=newLeafEdgeWidthL.
    //      - resize the back cover (twoPageDiv) to left=gutter-newWidthL-newLeafEdgeWidthL-10
    //          and width=newWidthL+newWidthR+twoPageEdgeW+20
    //      - move new left leaf (newIndexL) forward to zindex=2 so it can receive clicks.
    //      - remove old left and right leafs from the dom [pruneUnusedImgs()].
    //      - prefetch new adjacent leafs.
    //      - set up click handlers for both new left and right leafs.
    //      - redraw the search highlight.
    //      - update the pagenum box and the url.
    
    
    var leftEdgeTmpLeft = gutter - currWidthL - leafEdgeTmpW;

    this.leafEdgeTmp = document.createElement('div');
    $(this.leafEdgeTmp).css({
        borderStyle: 'solid none solid solid',
        borderColor: 'rgb(51, 51, 34)',
        borderWidth: '1px 0px 1px 1px',
        background: 'transparent url(' + this.imagesBaseURL + 'left_edges.png) repeat scroll 0% 0%',
        width: leafEdgeTmpW + 'px',
        height: this.twoPageH-1 + 'px',
        left: leftEdgeTmpLeft + 'px',
        top: top+'px',    
        position: 'absolute',
        zIndex:1000
    }).appendTo('#GBcontainer');
    
    //$(this.leafEdgeL).css('width', newLeafEdgeWidthL+'px');
    $(this.leafEdgeL).css({
        width: newLeafEdgeWidthL+'px', 
        left: gutter-currWidthL-newLeafEdgeWidthL+'px'
    });   

    // Left gets the offset of the current left leaf from the document
    var left = $(this.prefetchedImgs[leftLeaf]).offset().left;
    // $$$ This seems very similar to the gutter.  May be able to consolidate the logic.
    var right = $('#GBcontainer').width()-left-$(this.prefetchedImgs[leftLeaf]).width()+$('#GBcontainer').offset().left-2+'px';
    // We change the left leaf to right positioning
    $(this.prefetchedImgs[leftLeaf]).css({
        right: right,
        left: ''
    });

     left = $(this.prefetchedImgs[leftLeaf]).offset().left - $('#book_div_1').offset().left;
     
     right = left+$(this.prefetchedImgs[leftLeaf]).width()+'px';

    $(this.leafEdgeTmp).animate({left: gutter}, this.flipSpeed, 'easeInSine');    
    //$(this.prefetchedImgs[leftLeaf]).animate({width: '0px'}, 'slow', 'easeInSine');
    
    var self = this;

    this.removeSearchHilites();

    //console.log('animating leafLeaf ' + leftLeaf + ' to 0px');
    $(this.prefetchedImgs[leftLeaf]).animate({width: '0px'}, self.flipSpeed, 'easeInSine', function() {
    
        //console.log('     and now leafEdgeTmp to left: gutter+newWidthR ' + (gutter + newWidthR));
        $(self.leafEdgeTmp).animate({left: gutter+newWidthR+'px'}, self.flipSpeed, 'easeOutSine');

        //console.log('  animating newIndexR ' + newIndexR + ' to ' + newWidthR + ' from ' + $(self.prefetchedImgs[newIndexR]).width());
        $(self.prefetchedImgs[newIndexR]).animate({width: newWidthR+'px'}, self.flipSpeed, 'easeOutSine', function() {
            $(self.prefetchedImgs[newIndexL]).css('zIndex', 2);

            $(self.leafEdgeR).css({
                // Moves the right leaf edge
                width: self.twoPageEdgeW-newLeafEdgeWidthL+'px',
                left:  gutter+newWidthR+'px'
            });

            $(self.leafEdgeL).css({
                // Moves and resizes the left leaf edge
                width: newLeafEdgeWidthL+'px',
                left:  gutter-newWidthL-newLeafEdgeWidthL+'px'
            });

            
            $(self.twoPageDiv).css({
                // Resizes the brown border div
                width: newWidthL+newWidthR+self.twoPageEdgeW+20+'px',
                left: gutter-newWidthL-newLeafEdgeWidthL-10+'px'
            });
            
            $(self.leafEdgeTmp).remove();
            self.leafEdgeTmp = null;
            
            self.currentIndexL = newIndexL;
            self.currentIndexR = newIndexR;
            self.firstIndex = self.currentIndexL;
            self.displayedIndices = [newIndexL, newIndexR];
            self.setClickHandlers();
            self.pruneUnusedImgs();
            self.prefetch();            
            self.animating = false;
            
            self.updateSearchHilites2UP();
            self.updatePageNumBox2UP();
            //$('#GBzoom').text((self.twoPageH/self.getPageHeight(newIndexL)).toString().substr(0,4));            
            
            if (self.animationFinishedCallback) {
                self.animationFinishedCallback();
                self.animationFinishedCallback = null;
            }
        });
    });        
    
}

// flipFwdToIndex()
//______________________________________________________________________________
// Whether we flip left or right is dependent on the page progression
// to flip forward one spread, pass index=null
GnuBook.prototype.flipFwdToIndex = function(index) {

    if (this.animating) return;

    if (null != this.leafEdgeTmp) {
        alert('error: leafEdgeTmp should be null!');
        return;
    }

    if (null == index) {
        index = this.currentIndexR+2; // $$$ assumes indices are continuous
    }
    if (index > this.lastDisplayableIndex()) return;

    this.animating = true;
    
    var nextIndices = this.getSpreadIndices(index);
    
    //console.log('flipfwd to indices ' + nextIndices[0] + ',' + nextIndices[1]);

    if ('rl' != this.pageProgression) {
        // We did not specify RTL
        var gutter = this.prepareFlipRightToLeft(nextIndices[0], nextIndices[1]);
        this.flipRightToLeft(nextIndices[0], nextIndices[1], gutter);
    } else {
        // RTL
        var gutter = this.prepareFlipLeftToRight(nextIndices[0], nextIndices[1]);
        this.flipLeftToRight(nextIndices[0], nextIndices[1], gutter);
    }
}

// flipRightToLeft(nextL, nextR, gutter)
// $$$ better not to have to pass gutter in
//______________________________________________________________________________
// Flip from left to right and show the nextL and nextR indices on those sides
GnuBook.prototype.flipRightToLeft = function(newIndexL, newIndexR, gutter) {
    var oldLeafEdgeWidthL = this.leafEdgeWidth(this.currentIndexL);
    var oldLeafEdgeWidthR = this.twoPageEdgeW-oldLeafEdgeWidthL;
    var newLeafEdgeWidthL = this.leafEdgeWidth(newIndexL);  
    var newLeafEdgeWidthR = this.twoPageEdgeW-newLeafEdgeWidthL;

    var leafEdgeTmpW = oldLeafEdgeWidthR - newLeafEdgeWidthR;

    var top  = ($('#GBcontainer').height() - this.twoPageH) >> 1;                

    var scaledW = this.getPageWidth2UP(this.currentIndexR);

    var middle     = ($('#GBcontainer').width() >> 1);
    var currGutter = middle + this.gutterOffsetForIndex(this.currentIndexL);

    this.leafEdgeTmp = document.createElement('div');
    $(this.leafEdgeTmp).css({
        borderStyle: 'solid none solid solid',
        borderColor: 'rgb(51, 51, 34)',
        borderWidth: '1px 0px 1px 1px',
        background: 'transparent url(' + this.imagesBaseURL + 'left_edges.png) repeat scroll 0% 0%',
        width: leafEdgeTmpW + 'px',
        height: this.twoPageH-1 + 'px',
        left: currGutter+scaledW+'px',
        top: top+'px',    
        position: 'absolute',
        zIndex:1000
    }).appendTo('#GBcontainer');

    //var scaledWR = this.getPageWidth2UP(newIndexR); // $$$ should be current instead?
    //var scaledWL = this.getPageWidth2UP(newIndexL); // $$$ should be current instead?
    
    var currWidthL = this.getPageWidth2UP(this.currentIndexL);
    var currWidthR = this.getPageWidth2UP(this.currentIndexR);
    var newWidthL = this.getPageWidth2UP(newIndexL);
    var newWidthR = this.getPageWidth2UP(newIndexR);

    $(this.leafEdgeR).css({width: newLeafEdgeWidthR+'px', left: gutter+newWidthR+'px' });

    var self = this; // closure-tastic!

    var speed = this.flipSpeed;

    this.removeSearchHilites();
    
    $(this.leafEdgeTmp).animate({left: gutter}, speed, 'easeInSine');    
    $(this.prefetchedImgs[this.currentIndexR]).animate({width: '0px'}, speed, 'easeInSine', function() {
        $(self.leafEdgeTmp).animate({left: gutter-newWidthL-leafEdgeTmpW+'px'}, speed, 'easeOutSine');    
        $(self.prefetchedImgs[newIndexL]).animate({width: newWidthL+'px'}, speed, 'easeOutSine', function() {
            $(self.prefetchedImgs[newIndexR]).css('zIndex', 2);

            $(self.leafEdgeL).css({
                width: newLeafEdgeWidthL+'px', 
                left: gutter-newWidthL-newLeafEdgeWidthL+'px'
            });
            
            $(self.twoPageDiv).css({
                width: newWidthL+newWidthR+self.twoPageEdgeW+20+'px',
                left: gutter-newWidthL-newLeafEdgeWidthL-10+'px'
            });
            
            $(self.leafEdgeTmp).remove();
            self.leafEdgeTmp = null;
            
            self.currentIndexL = newIndexL;
            self.currentIndexR = newIndexR;
            self.firstIndex = self.currentIndexL;
            self.displayedIndices = [newIndexL, newIndexR];
            self.setClickHandlers();            
            self.pruneUnusedImgs();
            self.prefetch();
            self.animating = false;


            self.updateSearchHilites2UP();
            self.updatePageNumBox2UP();
            //$('#GBzoom').text((self.twoPageH/self.getPageHeight(newIndexL)).toString().substr(0,4));
            
            if (self.animationFinishedCallback) {
                self.animationFinishedCallback();
                self.animationFinishedCallback = null;
            }
        });
    });    
}

// setClickHandlers
//______________________________________________________________________________
GnuBook.prototype.setClickHandlers = function() {
    var self = this;
    $(this.prefetchedImgs[this.currentIndexL]).click(function() {
        //self.prevPage();
        self.autoStop();
        self.left();
    });
    $(this.prefetchedImgs[this.currentIndexR]).click(function() {
        //self.nextPage();'
        self.autoStop();
        self.right();        
    });
}

// prefetchImg()
//______________________________________________________________________________
GnuBook.prototype.prefetchImg = function(index) {
    if (undefined == this.prefetchedImgs[index]) {    
        //console.log('prefetching ' + index);
        var img = document.createElement("img");
        img.src = this.getPageURI(index);
        this.prefetchedImgs[index] = img;
    }
}


// prepareFlipLeftToRight()
//
//______________________________________________________________________________
//
// Prepare to flip the left page towards the right.  This corresponds to moving
// backward when the page progression is left to right.
GnuBook.prototype.prepareFlipLeftToRight = function(prevL, prevR) {

    //console.log('  preparing left->right for ' + prevL + ',' + prevR);

    this.prefetchImg(prevL);
    this.prefetchImg(prevR);
    
    var height  = this.getPageHeight(prevL); 
    var width   = this.getPageWidth(prevL);    
    var middle = ($('#GBcontainer').width() >> 1);
    var top  = ($('#GBcontainer').height() - this.twoPageH) >> 1;                
    var scaledW = this.twoPageH*width/height;

    // The gutter is the dividing line between the left and right pages.
    // It is offset from the middle to create the illusion of thickness to the pages
    var gutter = middle + this.gutterOffsetForIndex(prevL);
    
    //console.log('    gutter for ' + prevL + ' is ' + gutter);
    //console.log('    prevL.left: ' + (gutter - scaledW) + 'px');
    //console.log('    changing prevL ' + prevL + ' to left: ' + (gutter-scaledW) + ' width: ' + scaledW);
    
    $(this.prefetchedImgs[prevL]).css({
        position: 'absolute',
        /*right:   middle+'px',*/
        left: gutter-scaledW+'px',
        right: '',
        top:    top+'px',
        backgroundColor: 'rgb(234, 226, 205)',
        height: this.twoPageH,
        width:  scaledW+'px',
        borderRight: '1px solid black',
        zIndex: 1
    });

    $('#GBcontainer').append(this.prefetchedImgs[prevL]);

    //console.log('    changing prevR ' + prevR + ' to left: ' + gutter + ' width: 0');

    $(this.prefetchedImgs[prevR]).css({
        position: 'absolute',
        left:   gutter+'px',
        right: '',
        top:    top+'px',
        backgroundColor: 'rgb(234, 226, 205)',
        height: this.twoPageH,
        width:  '0px',
        borderLeft: '1px solid black',
        zIndex: 2
    });

    $('#GBcontainer').append(this.prefetchedImgs[prevR]);


    return gutter;
            
}

// prepareFlipRightToLeft()
//______________________________________________________________________________
GnuBook.prototype.prepareFlipRightToLeft = function(nextL, nextR) {

    //console.log('  preparing left<-right for ' + nextL + ',' + nextR);

    this.prefetchImg(nextL);
    this.prefetchImg(nextR);

    var height  = this.getPageHeight(nextR); 
    var width   = this.getPageWidth(nextR);    
    var middle = ($('#GBcontainer').width() >> 1);
    var top  = ($('#GBcontainer').height() - this.twoPageH) >> 1;                
    var scaledW = this.twoPageH*width/height;

    var gutter = middle + this.gutterOffsetForIndex(nextL);
    
    //console.log('right to left to %d gutter is %d', nextL, gutter);
    
    //console.log(' prepareRTL changing nextR ' + nextR + ' to left: ' + gutter);
    $(this.prefetchedImgs[nextR]).css({
        position: 'absolute',
        left:   gutter+'px',
        top:    top+'px',
        backgroundColor: 'rgb(234, 226, 205)',
        height: this.twoPageH,
        width:  scaledW+'px',
        borderLeft: '1px solid black',
        zIndex: 1
    });

    $('#GBcontainer').append(this.prefetchedImgs[nextR]);

    height  = this.getPageHeight(nextL); 
    width   = this.getPageWidth(nextL);      
    scaledW = this.twoPageH*width/height;

    //console.log(' prepareRTL changing nextL ' + nextL + ' to right: ' + $('#GBcontainer').width()-gutter);
    $(this.prefetchedImgs[nextL]).css({
        position: 'absolute',
        right:   $('#GBcontainer').width()-gutter+'px',
        top:    top+'px',
        backgroundColor: 'rgb(234, 226, 205)',
        height: this.twoPageH,
        width:  0+'px',
        borderRight: '1px solid black',
        zIndex: 2
    });

    $('#GBcontainer').append(this.prefetchedImgs[nextL]);    

    return gutter;
            
}

// getNextLeafs() -- NOT RTL AWARE
//______________________________________________________________________________
// GnuBook.prototype.getNextLeafs = function(o) {
//     //TODO: we might have two left or two right leafs in a row (damaged book)
//     //For now, assume that leafs are contiguous.
//     
//     //return [this.currentIndexL+2, this.currentIndexL+3];
//     o.L = this.currentIndexL+2;
//     o.R = this.currentIndexL+3;
// }

// getprevLeafs() -- NOT RTL AWARE
//______________________________________________________________________________
// GnuBook.prototype.getPrevLeafs = function(o) {
//     //TODO: we might have two left or two right leafs in a row (damaged book)
//     //For now, assume that leafs are contiguous.
//     
//     //return [this.currentIndexL-2, this.currentIndexL-1];
//     o.L = this.currentIndexL-2;
//     o.R = this.currentIndexL-1;
// }

// pruneUnusedImgs()
//______________________________________________________________________________
GnuBook.prototype.pruneUnusedImgs = function() {
    //console.log('current: ' + this.currentIndexL + ' ' + this.currentIndexR);
    for (var key in this.prefetchedImgs) {
        //console.log('key is ' + key);
        if ((key != this.currentIndexL) && (key != this.currentIndexR)) {
            //console.log('removing key '+ key);
            $(this.prefetchedImgs[key]).remove();
        }
        if ((key < this.currentIndexL-4) || (key > this.currentIndexR+4)) {
            //console.log('deleting key '+ key);
            delete this.prefetchedImgs[key];
        }
    }
}

// prefetch()
//______________________________________________________________________________
GnuBook.prototype.prefetch = function() {

    var lim = this.currentIndexL-4;
    var i;
    lim = Math.max(lim, 0);
    for (i = lim; i < this.currentIndexL; i++) {
        this.prefetchImg(i);
    }
    
    if (this.numLeafs > (this.currentIndexR+1)) {
        lim = Math.min(this.currentIndexR+4, this.numLeafs-1);
        for (i=this.currentIndexR+1; i<=lim; i++) {
            this.prefetchImg(i);
        }
    }
}

// getPageWidth2UP()
//______________________________________________________________________________
GnuBook.prototype.getPageWidth2UP = function(index) {
    var height  = this.getPageHeight(index); 
    var width   = this.getPageWidth(index);    
    return Math.floor(this.twoPageH*width/height);
}    

// search()
//______________________________________________________________________________
GnuBook.prototype.search = function(term) {
    $('#GnuBookSearchScript').remove();
 	var script  = document.createElement("script");
 	script.setAttribute('id', 'GnuBookSearchScript');
	script.setAttribute("type", "text/javascript");
	script.setAttribute("src", 'http://'+this.server+'/GnuBook/flipbook_search_gb.php?url='+escape(this.bookPath+'/'+this.bookId+'_djvu.xml')+'&term='+term+'&format=XML&callback=gb.GBSearchCallback');
	document.getElementsByTagName('head')[0].appendChild(script);
	$('#GnuBookSearchResults').html('Searching...');
}

// GBSearchCallback()
//______________________________________________________________________________
GnuBook.prototype.GBSearchCallback = function(txt) {
    //alert(txt);
    if (jQuery.browser.msie) {
        var dom=new ActiveXObject("Microsoft.XMLDOM");
        dom.async="false";
        dom.loadXML(txt);    
    } else {
        var parser = new DOMParser();
        var dom = parser.parseFromString(txt, "text/xml");    
    }
    
    $('#GnuBookSearchResults').empty();    
    $('#GnuBookSearchResults').append('<ul>');
    
    for (var key in this.searchResults) {
        if (null != this.searchResults[key].div) {
            $(this.searchResults[key].div).remove();
        }
        delete this.searchResults[key];
    }
    
    var pages = dom.getElementsByTagName('PAGE');
    
    if (0 == pages.length) {
        // $$$ it would be nice to echo the (sanitized) search result here
        $('#GnuBookSearchResults').append('<li>No search results found</li>');
    } else {    
        for (var i = 0; i < pages.length; i++){
            //console.log(pages[i].getAttribute('file').substr(1) +'-'+ parseInt(pages[i].getAttribute('file').substr(1), 10));
    
            
            var re = new RegExp (/_(\d{4})/);
            var reMatch = re.exec(pages[i].getAttribute('file'));
            var index = parseInt(reMatch[1], 10);
            //var index = parseInt(pages[i].getAttribute('file').substr(1), 10);
            
            var children = pages[i].childNodes;
            var context = '';
            for (var j=0; j<children.length; j++) {
                //console.log(j + ' - ' + children[j].nodeName);
                //console.log(children[j].firstChild.nodeValue);
                if ('CONTEXT' == children[j].nodeName) {
                    context += children[j].firstChild.nodeValue;
                } else if ('WORD' == children[j].nodeName) {
                    context += '<b>'+children[j].firstChild.nodeValue+'</b>';
                    
                    var index = this.leafNumToIndex(index);
                    if (null != index) {
                        //coordinates are [left, bottom, right, top, [baseline]]
                        //we'll skip baseline for now...
                        var coords = children[j].getAttribute('coords').split(',',4);
                        if (4 == coords.length) {
                            this.searchResults[index] = {'l':coords[0], 'b':coords[1], 'r':coords[2], 't':coords[3], 'div':null};
                        }
                    }
                }
            }
            var pageName = this.getPageName(index);
            //TODO: remove hardcoded instance name
            $('#GnuBookSearchResults').append('<li><b><a href="javascript:gb.jumpToIndex('+index+');">' + pageName + '</a></b> - ' + context + '</li>');
        }
    }
    $('#GnuBookSearchResults').append('</ul>');

    this.updateSearchHilites();
}

// updateSearchHilites()
//______________________________________________________________________________
GnuBook.prototype.updateSearchHilites = function() {
    if (2 == this.mode) {
        this.updateSearchHilites2UP();
    } else {
        this.updateSearchHilites1UP();
    }
}

// showSearchHilites1UP()
//______________________________________________________________________________
GnuBook.prototype.updateSearchHilites1UP = function() {

    for (var key in this.searchResults) {
        
        if (-1 != jQuery.inArray(parseInt(key), this.displayedIndices)) {
            var result = this.searchResults[key];
            if(null == result.div) {
                result.div = document.createElement('div');
                $(result.div).attr('className', 'GnuBookSearchHilite').appendTo('#pagediv'+key);
                //console.log('appending ' + key);
            }    
            $(result.div).css({
                width:  (result.r-result.l)/this.reduce + 'px',
                height: (result.b-result.t)/this.reduce + 'px',
                left:   (result.l)/this.reduce + 'px',
                top:    (result.t)/this.reduce +'px'
            });

        } else {
            //console.log(key + ' not displayed');
            this.searchResults[key].div=null;
        }
    }
}

// showSearchHilites2UP()
//______________________________________________________________________________
GnuBook.prototype.updateSearchHilites2UP = function() {

    var middle = ($('#GBcontainer').width() >> 1);

    for (var key in this.searchResults) {
        key = parseInt(key, 10);
        if (-1 != jQuery.inArray(key, this.displayedIndices)) {
            var result = this.searchResults[key];
            if(null == result.div) {
                result.div = document.createElement('div');
                $(result.div).attr('className', 'GnuBookSearchHilite').css('zIndex', 3).appendTo('#GBcontainer');
                //console.log('appending ' + key);
            }

            var height = this.getPageHeight(key);
            var width  = this.getPageWidth(key)
            var reduce = this.twoPageH/height;
            var scaledW = parseInt(width*reduce);
            
            var gutter = middle + this.gutterOffsetForIndex(this.currentIndexL);
            
            if ('L' == this.getPageSide(key)) {
                var pageL = gutter-scaledW;
            } else {
                var pageL = gutter;
            }
            var pageT  = ($('#GBcontainer').height() - this.twoPageH) >> 1;                
                        
            $(result.div).css({
                width:  (result.r-result.l)*reduce + 'px',
                height: (result.b-result.t)*reduce + 'px',
                left:   pageL+(result.l)*reduce + 'px',
                top:    pageT+(result.t)*reduce +'px'
            });

        } else {
            //console.log(key + ' not displayed');
            if (null != this.searchResults[key].div) {
                //console.log('removing ' + key);
                $(this.searchResults[key].div).remove();
            }
            this.searchResults[key].div=null;
        }
    }
}

// removeSearchHilites()
//______________________________________________________________________________
GnuBook.prototype.removeSearchHilites = function() {
    for (var key in this.searchResults) {
        if (null != this.searchResults[key].div) {
            $(this.searchResults[key].div).remove();
            this.searchResults[key].div=null;
        }        
    }
}

// showEmbedCode()
//______________________________________________________________________________
GnuBook.prototype.showEmbedCode = function() {
    if (null != this.embedPopup) { // check if already showing
        return;
    }
    this.autoStop();
    this.embedPopup = document.createElement("div");
    $(this.embedPopup).css({
        position: 'absolute',
        top:      '20px',
        left:     ($('#GBcontainer').width()-400)/2 + 'px',
        width:    '400px',
        padding:  "20px",
        border:   "3px double #999999",
        zIndex:   3,
        backgroundColor: "#fff"
    }).appendTo('#GnuBook');

    htmlStr =  '<p style="text-align:center;"><b>Embed Bookreader in your blog!</b></p>';
    htmlStr += '<p>The bookreader uses iframes for embedding. It will not work on web hosts that block iframes. The embed feature has been tested on blogspot.com blogs as well as self-hosted Wordpress blogs. This feature will NOT work on wordpress.com blogs.</p>';
    htmlStr += '<p>Embed Code: <input type="text" size="40" value="' + this.getEmbedCode() + '"></p>';
    htmlStr += '<p style="text-align:center;"><a href="" onclick="gb.embedPopup = null; $(this.parentNode.parentNode).remove(); return false">Close popup</a></p>';    

    this.embedPopup.innerHTML = htmlStr;
    $(this.embedPopup).find('input').bind('click', function() {
        this.select();
    })
}

// autoToggle()
//______________________________________________________________________________
GnuBook.prototype.autoToggle = function() {

    var bComingFrom1up = false;
    if (2 != this.mode) {
        bComingFrom1up = true;
        this.switchMode(2);
    }

    var self = this;
    if (null == this.autoTimer) {
        this.flipSpeed = 2000;
        
        // $$$ Draw events currently cause layout problems when they occur during animation.
        //     There is a specific problem when changing from 1-up immediately to autoplay in RTL so
        //     we workaround for now by not triggering immediate animation in that case.
        //     See https://bugs.launchpad.net/gnubook/+bug/328327
        if (('rl' == this.pageProgression) && bComingFrom1up) {
            // don't flip immediately -- wait until timer fires
        } else {
            // flip immediately
            this.flipFwdToIndex();        
        }

        $('#GBtoolbar .play').hide();
        $('#GBtoolbar .pause').show();
        this.autoTimer=setInterval(function(){
            if (self.animating) {return;}
            
            if (Math.max(self.currentIndexL, self.currentIndexR) >= self.lastDisplayableIndex()) {
                self.flipBackToIndex(1); // $$$ really what we want?
            } else {            
                self.flipFwdToIndex();
            }
        },5000);
    } else {
        this.autoStop();
    }
}

// autoStop()
//______________________________________________________________________________
GnuBook.prototype.autoStop = function() {
    if (null != this.autoTimer) {
        clearInterval(this.autoTimer);
        this.flipSpeed = 'fast';
        $('#GBtoolbar .pause').hide();
        $('#GBtoolbar .play').show();
        this.autoTimer = null;
    }
}

// keyboardNavigationIsDisabled(event)
//   - returns true if keyboard navigation should be disabled for the event
//______________________________________________________________________________
GnuBook.prototype.keyboardNavigationIsDisabled = function(event) {
    if (event.target.tagName == "INPUT") {
        return true;
    }   
    return false;
}

// gutterOffsetForIndex
//______________________________________________________________________________
//
// Returns the gutter offset for the spread containing the given index.
// This function supports RTL
GnuBook.prototype.gutterOffsetForIndex = function(pindex) {

    // To find the offset of the gutter from the middle we calculate our percentage distance
    // through the book (0..1), remap to (-0.5..0.5) and multiply by the total page edge width
    var offset = parseInt(((pindex / this.numLeafs) - 0.5) * this.twoPageEdgeW);
    
    // But then again for RTL it's the opposite
    if ('rl' == this.pageProgression) {
        offset = -offset;
    }
    
    return offset;
}

// leafEdgeWidth
//______________________________________________________________________________
// Returns the width of the leaf edge div for the page with index given
GnuBook.prototype.leafEdgeWidth = function(pindex) {
    // $$$ could there be single pixel rounding errors for L vs R?
    if ((this.getPageSide(pindex) == 'L') && (this.pageProgression != 'rl')) {
        return parseInt( (pindex/this.numLeafs) * this.twoPageEdgeW + 0.5);
    } else {
        return parseInt( (1 - pindex/this.numLeafs) * this.twoPageEdgeW + 0.5);
    }
}

// jumpIndexForLeftEdgePageX
//______________________________________________________________________________
// Returns the target jump leaf given a page coordinate (inside the left page edge div)
GnuBook.prototype.jumpIndexForLeftEdgePageX = function(pageX) {
    if ('rl' != this.pageProgression) {
        // LTR - flipping backward
        var jumpIndex = this.currentIndexL - ($(this.leafEdgeL).offset().left + $(this.leafEdgeL).width() - pageX) * 10;

        // browser may have resized the div due to font size change -- see https://bugs.launchpad.net/gnubook/+bug/333570        
        jumpIndex = GnuBook.util.clamp(Math.round(jumpIndex), this.firstDisplayableIndex(), this.currentIndexL - 2);
        return jumpIndex;

    } else {
        var jumpIndex = this.currentIndexL + ($(this.leafEdgeL).offset().left + $(this.leafEdgeL).width() - pageX) * 10;
        jumpIndex = GnuBook.util.clamp(Math.round(jumpIndex), this.currentIndexL + 2, this.lastDisplayableIndex());
        return jumpIndex;
    }
}

// jumpIndexForRightEdgePageX
//______________________________________________________________________________
// Returns the target jump leaf given a page coordinate (inside the right page edge div)
GnuBook.prototype.jumpIndexForRightEdgePageX = function(pageX) {
    if ('rl' != this.pageProgression) {
        // LTR
        var jumpIndex = this.currentIndexR + (pageX - $(this.leafEdgeR).offset().left) * 10;
        jumpIndex = GnuBook.util.clamp(Math.round(jumpIndex), this.currentIndexR + 2, this.lastDisplayableIndex());
        return jumpIndex;
    } else {
        var jumpIndex = this.currentIndexR - (pageX - $(this.leafEdgeR).offset().left) * 10;
        jumpIndex = GnuBook.util.clamp(Math.round(jumpIndex), this.firstDisplayableIndex(), this.currentIndexR - 2);
        return jumpIndex;
    }
}

GnuBook.prototype.initToolbar = function(mode, ui) {
    $("#GnuBook").append("<div id='GBtoolbar'><span style='float:left;'>"
        + "<a class='GBicon logo rollover' href='" + this.logoURL + "'>&nbsp;</a>"
        + " <button class='GBicon rollover zoom_out' onclick='gb.zoom1up(-1); return false;'/>" 
        + "<button class='GBicon rollover zoom_in' onclick='gb.zoom1up(1); return false;'/>"
        + " <span class='label'>Zoom: <span id='GBzoom'>25</span>%</span>"
        + " <button class='GBicon rollover one_page_mode' onclick='gb.switchMode(1); return false;'/>"
        + " <button class='GBicon rollover two_page_mode' onclick='gb.switchMode(2); return false;'/>"
        + "&nbsp;&nbsp;<a class='GBblack title' href='"+this.bookUrl+"' target='_blank'>"+this.shortTitle(50)+"</a>"
        + "</span></div>");
        
    if (ui == "embed") {
        $("#GnuBook a.logo").attr("target","_blank");
    }

    // $$$ turn this into a member variable
    var jToolbar = $('#GBtoolbar'); // j prefix indicates jQuery object
    
    // We build in mode 2
    jToolbar.append("<span id='GBtoolbarbuttons' style='float: right'>"
        + "<button class='GBicon rollover embed' />"
        + "<form class='GBpageform' action='javascript:' onsubmit='gb.jumpToPage(this.elements[0].value)'> <span class='label'>Page:<input id='GBpagenum' type='text' size='3' onfocus='gb.autoStop();'></input></span></form>"
        + "<div class='GBtoolbarmode2' style='display: none'><button class='GBicon rollover book_leftmost' /><button class='GBicon rollover book_left' /><button class='GBicon rollover book_right' /><button class='GBicon rollover book_rightmost' /></div>"
        + "<div class='GBtoolbarmode1' style='display: none'><button class='GBicon rollover book_top' /><button class='GBicon rollover book_up' /> <button class='GBicon rollover book_down' /><button class='GBicon rollover book_bottom' /></div>"
        + "<button class='GBicon rollover play' /><button class='GBicon rollover pause' style='display: none' /></span>");

    this.bindToolbarNavHandlers(jToolbar);
    
    // Setup tooltips -- later we could load these from a file for i18n
    var titles = { '.logo': 'Go to Archive.org',
                   '.zoom_in': 'Zoom in',
                   '.zoom_out': 'Zoom out',
                   '.one_page_mode': 'One-page view',
                   '.two_page_mode': 'Two-page view',
                   '.embed': 'Embed bookreader',
                   '.book_left': 'Flip left',
                   '.book_right': 'Flip right',
                   '.book_up': 'Page up',
                   '.book_down': 'Page down',
                   '.play': 'Play',
                   '.pause': 'Pause',
                   '.book_top': 'First page',
                   '.book_bottom': 'Last page'
                  };
    if ('rl' == this.pageProgression) {
        titles['.book_leftmost'] = 'Last page';
        titles['.book_rightmost'] = 'First page';
    } else { // LTR
        titles['.book_leftmost'] = 'First page';
        titles['.book_rightmost'] = 'Last page';
    }
                  
    for (var icon in titles) {
        jToolbar.find(icon).attr('title', titles[icon]);
    }

    // Switch to requested mode -- binds other click handlers
    this.switchToolbarMode(mode);

}


// switchToolbarMode
//______________________________________________________________________________
// Update the toolbar for the given mode (changes navigation buttons)
// $$$ we should soon split the toolbar out into its own module
GnuBook.prototype.switchToolbarMode = function(mode) {
    if (1 == mode) {
        // 1-up     
        $('#GBtoolbar .GBtoolbarmode2').hide();
        $('#GBtoolbar .GBtoolbarmode1').show().css('display', 'inline');
    } else {
        // 2-up
        $('#GBtoolbar .GBtoolbarmode1').hide();
        $('#GBtoolbar .GBtoolbarmode2').show().css('display', 'inline');
    }
}

// bindToolbarNavHandlers
//______________________________________________________________________________
// Binds the toolbar handlers
GnuBook.prototype.bindToolbarNavHandlers = function(jToolbar) {

    jToolbar.find('.book_left').bind('click', function(e) {
        gb.left();
        return false;
    });
         
    jToolbar.find('.book_right').bind('click', function(e) {
        gb.right();
        return false;
    });
        
    jToolbar.find('.book_up').bind('click', function(e) {
        gb.prev();
        return false;
    });        
        
    jToolbar.find('.book_down').bind('click', function(e) {
        gb.next();
        return false;
    });
        
    jToolbar.find('.embed').bind('click', function(e) {
        gb.showEmbedCode();
        return false;
    });

    jToolbar.find('.play').bind('click', function(e) {
        gb.autoToggle();
        return false;
    });

    jToolbar.find('.pause').bind('click', function(e) {
        gb.autoToggle();
        return false;
    });
    
    jToolbar.find('.book_top').bind('click', function(e) {
        gb.first();
        return false;
    });

    jToolbar.find('.book_bottom').bind('click', function(e) {
        gb.last();
        return false;
    });
    
    jToolbar.find('.book_leftmost').bind('click', function(e) {
        gb.leftmost();
        return false;
    });
  
    jToolbar.find('.book_rightmost').bind('click', function(e) {
        gb.rightmost();
        return false;
    });
}

// firstDisplayableIndex
//______________________________________________________________________________
// Returns the index of the first visible page, dependent on the mode.
// $$$ Currently we cannot display the front/back cover in 2-up and will need to update
// this function when we can as part of https://bugs.launchpad.net/gnubook/+bug/296788
GnuBook.prototype.firstDisplayableIndex = function() {
    if (this.mode == 0) {
        return 0;
    } else {
        return 1; // $$$ we assume there are enough pages... we need logic for very short books
    }
}

// lastDisplayableIndex
//______________________________________________________________________________
// Returns the index of the last visible page, dependent on the mode.
// $$$ Currently we cannot display the front/back cover in 2-up and will need to update
// this function when we can as pa  rt of https://bugs.launchpad.net/gnubook/+bug/296788
GnuBook.prototype.lastDisplayableIndex = function() {
    if (this.mode == 2) {
        if (this.lastDisplayableIndex2up === null) {
            // Calculate and cache
            var candidate = this.numLeafs - 1;
            for ( ; candidate >= 0; candidate--) {
                var spreadIndices = this.getSpreadIndices(candidate);
                if (Math.max(spreadIndices[0], spreadIndices[1]) < (this.numLeafs - 1)) {
                    break;
                }
            }
            this.lastDisplayableIndex2up = candidate;
        }
        return this.lastDisplayableIndex2up;
    } else {
        return this.numLeafs - 1;
    }
}

// shortTitle(maximumCharacters)
//________
// Returns a shortened version of the title with the maximum number of characters
GnuBook.prototype.shortTitle = function(maximumCharacters) {
    if (this.bookTitle.length < maximumCharacters) {
        return this.bookTitle;
    }
    
    var title = this.bookTitle.substr(0, maximumCharacters - 3);
    title += '...';
    return title;
}



// Parameter related functions

// updateFromParams(params)
//________
// Update ourselves from the params object.
//
// e.g. this.updateFromParams(this.paramsFromFragment(window.location.hash))
GnuBook.prototype.updateFromParams = function(params) {
    if ('undefined' != typeof(params.mode)) {
        this.switchMode(params.mode);
    }

    // $$$ process /search
    // $$$ process /zoom
    
    // We only respect page if index is not set
    if ('undefined' != typeof(params.index)) {
        if (params.index != this.currentIndex()) {
            this.jumpToIndex(params.index);
        }
    } else if ('undefined' != typeof(params.page)) {
        // $$$ this assumes page numbers are unique
        if (params.page != this.getPageNum(this.currentIndex())) {
            this.jumpToPage(params.page);
        }
    }
    
    // $$$ process /region
    // $$$ process /highlight
}

// paramsFromFragment(urlFragment)
//________
// Returns a object with configuration parametes from a URL fragment.
//
// E.g paramsFromFragment(window.location.hash)
GnuBook.prototype.paramsFromFragment = function(urlFragment) {
    // URL fragment syntax specification: http://openlibrary.org/dev/docs/bookurls
    
    var params = {};
    
    // For convenience we allow an initial # character (as from window.location.hash)
    // but don't require it
    if (urlFragment.substr(0,1) == '#') {
        urlFragment = urlFragment.substr(1);
    }
    
    // Simple #nn syntax
    var oldStyleLeafNum = parseInt( /^\d+$/.exec(urlFragment) );
    if ( !isNaN(oldStyleLeafNum) ) {
        params.index = oldStyleLeafNum;
        
        // Done processing if using old-style syntax
        return params;
    }
    
    // Split into key-value pairs
    var urlArray = urlFragment.split('/');
    var urlHash = {};
    for (var i = 0; i < urlArray.length; i += 2) {
        urlHash[urlArray[i]] = urlArray[i+1];
    }
    
    // Mode
    if ('1up' == urlHash['mode']) {
        params.mode = this.constMode1up;
    } else if ('2up' == urlHash['mode']) {
        params.mode = this.constMode2up;
    }
    
    // Index and page
    if ('undefined' != typeof(urlHash['page'])) {
        // page was set -- may not be int
        params.page = urlHash['page'];
    }
    
    // $$$ process /region
    // $$$ process /search
    // $$$ process /highlight
        
    return params;
}

// paramsFromCurrent()
//________
// Create a params object from the current parameters.
GnuBook.prototype.paramsFromCurrent = function() {

    var params = {};

    var pageNum = this.getPageNum(this.currentIndex());
    if ((pageNum === 0) || pageNum) {
        params.page = pageNum;
    }
    
    params.index = this.currentIndex();
    params.mode = this.mode;
    
    // $$$ highlight
    // $$$ region
    // $$$ search
    
    return params;
}

// fragmentFromParams(params)
//________
// Create a fragment string from the params object.
// See http://openlibrary.org/dev/docs/bookurls for an explanation of the fragment syntax.
GnuBook.prototype.fragmentFromParams = function(params) {
    var separator = '/';
    
    var fragments = [];
    
    if ('undefined' != typeof(params.page)) {
        fragments.push('page', params.page);
    } else {
        // Don't have page numbering -- use index instead
        fragments.push('page', 'n' + params.index);
    }
    
    // $$$ highlight
    // $$$ region
    // $$$ search
    
    // mode
    if ('undefined' != typeof(params.mode)) {    
        if (params.mode == this.constMode1up) {
            fragments.push('mode', '1up');
        } else if (params.mode == this.constMode2up) {
            fragments.push('mode', '2up');
        } else {
            throw 'fragmentFromParams called with unknown mode ' + params.mode;
        }
    }
    
    return fragments.join(separator);
}

// getPageIndex(pageNum)
//________
// Returns the *highest* index the given page number, or undefined
GnuBook.prototype.getPageIndex = function(pageNum) {
    var pageIndices = this.getPageIndices(pageNum);
    
    if (pageIndices.length > 0) {
        return pageIndices[pageIndices.length - 1];
    }

    return undefined;
}

// getPageIndices(pageNum)
//________
// Returns an array (possibly empty) of the indices with the given page number
GnuBook.prototype.getPageIndices = function(pageNum) {
    var indices = [];

    // Check for special "nXX" page number
    if (pageNum.slice(0,1) == 'n') {
        try {
            var pageIntStr = pageNum.slice(1, pageNum.length);
            var pageIndex = parseInt(pageIntStr);
            indices.append(pageIndex);
            return indices;
        } catch(err) {
            // Do nothing... will run through page names and see if one matches
        }
    }

    var i;
    for (i=0; i<this.numLeafs; i++) {
        if (this.getPageNum(i) == pageNum) {
            indices.push(i);
        }
    }
    
    return indices;
}

// getPageName(index)
//________
// Returns the name of the page as it should be displayed in the user interface
GnuBook.prototype.getPageName = function(index) {
    return 'Page ' + this.getPageNum(index);
}

// updateLocationHash
//________
// Update the location hash from the current parameters.  Call this instead of manually
// using window.location.replace
GnuBook.prototype.updateLocationHash = function() {
    var newHash = '#' + this.fragmentFromParams(this.paramsFromCurrent());
    window.location.replace(newHash);
    
    // This is the variable checked in the timer.  Only user-generated changes
    // to the URL will trigger the event.
    this.oldLocationHash = newHash;
}

// startLocationPolling
//________
// Starts polling of window.location to see hash fragment changes
GnuBook.prototype.startLocationPolling = function() {
    var self = this; // remember who I am
    self.oldLocationHash = window.location.hash;
    
    if (this.locationPollId) {
        clearInterval(this.locationPollID);
        this.locationPollId = null;
    }
    
    this.locationPollId = setInterval(function() {
        var newHash = window.location.hash;
        if (newHash != self.oldLocationHash) {
            if (newHash != self.oldUserHash) { // Only process new user hash once
                //console.log('url change detected ' + self.oldLocationHash + " -> " + newHash);
                
                // Queue change if animating
                if (self.animating) {
                    self.autoStop();
                    self.animationFinishedCallback = function() {
                        self.updateFromParams(self.paramsFromFragment(newHash));
                    }                        
                } else { // update immediately
                    self.updateFromParams(self.paramsFromFragment(newHash));
                }
                self.oldUserHash = newHash;
            }
        }
    }, 500);
}

// getEmbedURL
//________
// Returns a URL for an embedded version of the current book
GnuBook.prototype.getEmbedURL = function() {
    // We could generate a URL hash fragment here but for now we just leave at defaults
    return 'http://' + window.location.host + '/stream/'+this.bookId + '?ui=embed';
}

// getEmbedCode
//________
// Returns the embed code HTML fragment suitable for copy and paste
GnuBook.prototype.getEmbedCode = function() {
    return "<iframe src='" + this.getEmbedURL() + "' width='480px' height='430px'></iframe>";
}


// Library functions
GnuBook.util = {
    clamp: function(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
}