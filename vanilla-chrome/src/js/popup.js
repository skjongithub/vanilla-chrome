
var whiteListData = [];

jQuery(document).ready(function () {
  chrome.runtime.sendMessage({ cmd: "getState" }, function (state) {
    whiteListData = state.whiteList;
    loadAllCookies(makeWhiteListProxy(whiteListData), make);
  });
});

// Minimal proxy so cookies.js functions work with plain list data
function makeWhiteListProxy(list) {
  return {
    get: function () { return list; },
    isEmpty: function () { return list.length == 0; },
    isWhite: function (dom) { return getItemFor(dom) != null; },
    getItemFor: getItemFor,
    contains: function (dom) { return list.indexOf(dom) >= 0; }
  };

  function isWhiteMatch(def, dom) {
    dom = getRealDom(dom);
    if (strStartsWith(def, "*.")) {
      return dom == def.substr(2) || strEndsWith(dom, def.substr(1));
    }
    else return def == dom;
  }

  function getItemFor(dom) {
    for (var i = 0; i < list.length; i++) {
      if (isWhiteMatch(list[i], dom)) return list[i];
    }
    return null;
  }
}

function make(result) {
  var view=$("#menu");
  var wl=makeWhiteListProxy(whiteListData);

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs[0];
    var uri = new URI(tab.url);
    var dom;
    if (uri.scheme=="http"||uri.scheme=="https") dom=uriHostAuthority(uri);

    if (dom!=null) {
      var onList=wl.getItemFor(dom);

      if (!onList) {
        var subs=splitSubdom2(dom);
        for (var i=0; i<subs.length; i++) {
          var item=subs[i];
          addWLItem(view, item, !wl.contains(item));
        }
      }
      else addWLItem(view, onList, false);
    }

    view.append($("<div></div>").addClass("menuItem").html(ti18n("popupClearAll", result.black.length, result.total)).click(ClearAll));

    view.append($("<div></div>").addClass("menuItem").html(ti18n("labelOptions")).click(function () {
      showOptions(dom!=null?uriHostAuthority(uri):"");
      window.close();
    }));
  });
}

function addWLItem(view, item, enable) {
  var div=$("<div></div>").addClass("menuItem").html(ti18n("popup"+(enable?"Add":"Del")+"White", item)).click(function () { doCmd(enable, item); });
  view.append(div);
}

function doCmd(add, dom) {
  var cmd = add ? "addWhite" : "delWhite";
  chrome.runtime.sendMessage({ cmd: cmd, domain: dom });
  window.close();
}

function ClearAll() {
  var wl = makeWhiteListProxy(whiteListData);
  if (wl.isEmpty()) {
    $("#menu").text(ti18n("popupErrorEmpty"));
  }
  else {
    chrome.runtime.sendMessage({ cmd: "clearAll" }, function (result) {
      $("#menu").text(ti18n("popupClearAllMsg", result.black, result.total));
    });
  }
  return false;
}
