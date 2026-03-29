var whiteListData = [];
var optionData = {};
var protectedCookiesByDom = [];

jQuery(document).ready(function () {
  if (location.href.indexOf("?")>0)
    whitelist_edit_entry=location.href.substring(location.href.indexOf("?")+1);

  chrome.runtime.sendMessage({ cmd: "getState" }, function (state) {
    whiteListData = state.whiteList;
    optionData = state.options;
    protectedCookiesByDom = state.protectedCookiesByDom;

    showWhitelist();
    showExport();
    showOptions();
    localizePage();

    $("#diagRefresh").click(showDiag);
    $("#accordion").accordion({ collapsible: true, active: false, autoHeight: false, animated: false });

    setVersionInfo();
  });
});

function showOptions() {
  initOption($('#clearCookiesOnStartup'), 'clearCookiesOnStartup');
  initOption($('#protectCookies'), 'protectCookies');
  initOption($('#showUpdates'), 'showUpdates');
  initOption($('#hideTabIcon'), 'hideTabIcon');
  initOption($('#logEnable'), 'logging');

  disableOtherOption($("#clearCookiesOnStartup"), $("#protectCookies"), 'protectCookies');
  disableOtherOption($("#protectCookies"), $("#clearCookiesOnStartup"), 'clearCookiesOnStartup');

  $("#protectCookies").change(showWarning);
  showWarning();

  var m = optionData.autoDelDarkMinutes;
  if (!optionData.autoDelDark) m = 0;
  $("<option>").attr("value", 0).text(ti18n("optionsAutoDelDarkNever")).appendTo("#autoDelDarkMinutes");
  $.each(new Array(5, 10, 15, 20, 30, 45, 60), function(i, value) {
    var o=$("<option>").attr("value", value);
    if (value==m) o.attr("selected", "selected");
    o.text(ti18n("optionsAutoDelDarkMinutes", value)).appendTo("#autoDelDarkMinutes");
  });

  $("#autoDelDarkMinutes").change(function () {
    var v = parseInt($("#autoDelDarkMinutes").val(), 10);
    chrome.runtime.sendMessage({ cmd: "setOption", name: "autoDelDarkMinutes", value: v });
    chrome.runtime.sendMessage({ cmd: "setOption", name: "autoDelDark", value: v > 0 });
    optionData.autoDelDarkMinutes = v;
    optionData.autoDelDark = v > 0;
  });

  $('.optionDescription').click(function () {
    $(this).closest('tr').find('input').click().change();
    $(this).prev('input').click().change();
  });
}

function initOption(checkBox, optionName) {
  checkBox.attr('checked', optionData[optionName]);
  checkBox.change(function () {
    var newVal = checkBox.is(':checked');
    optionData[optionName] = newVal;
    chrome.runtime.sendMessage({ cmd: "setOption", name: optionName, value: newVal });
  });
}

function disableOtherOption(checkBox1, checkBox2, optionName) {
  checkBox1.change(function () {
    if (checkBox1.is(':checked') && checkBox2.is(':checked')) {
      checkBox2.click().change();
      optionData[optionName] = false;
      chrome.runtime.sendMessage({ cmd: "setOption", name: optionName, value: false });
    }
  });
}

function showWarning() {
  var msg = optionData.protectCookies ? "1" : "2";
  $("#protectCookiesWarning").html(ti18n("optionsProtectCookiesWarning"+msg));
}

function showLog() {
  var diagLog=$("#diagLog");
  chrome.runtime.sendMessage({ cmd: "getLog" }, function (logData) {
    var txt="";
    if (logData && logData.length) {
      txt=listToTable(logData, "diag_table", function (x) {
        return $('<div/>').text(x.time+" "+x.text+" ("+x.count+")");
      });
    }
    $(diagLog).html(txt);
  });
}

function showExport() {
  var expImp=$("#expimp");
  $("#btnImport").click(function () {
    chrome.runtime.sendMessage({ cmd: "importWhite", text: expImp.val() }, function () {
      location.reload(true);
    });
  });
  $("#btnExport").click(function () { expImp.val(arrayToText(whiteListData)); });
}

function showDiag() {
  var wl = makeWhiteListProxy(whiteListData);
  loadAllCookies(wl, function (result) {
    var total=result.total;
    var blackDom=groupCookiesByDom(result.black);
    var whiteDom=groupCookiesByDom(result.white);
    var prot=protectedCookiesByDom;
    var format=function (x) { return $('<div/>').text(x.dom+" ("+x.count+")"); };
    var format2=function (x) {
      var rc=$("<div/>");
      rc.append($('<a href="#"/>').text(x.dom).click(function () { setWLEdit(x.dom); }));
      rc.append($("<span/>").text(" ("+x.count+")"));
      return rc;
    };

    $("#diagBlack").html(listToTable(blackDom, "diag_table", format2));
    $("#diagWhite").html(listToTable(whiteDom, "diag_table", format));
    $("#diagProtected").html(listToTable(prot, "diag_table", format));
  });
  showLog();
  return false;
}

// Minimal whitelist proxy for cookies.js functions
function makeWhiteListProxy(list) {
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

  return {
    get: function () { return list; },
    isEmpty: function () { return list.length == 0; },
    isWhite: function (dom) { return getItemFor(dom) != null; },
    getItemFor: getItemFor,
    contains: function (dom) { return list.indexOf(dom) >= 0; }
  };
}

function listToTable(list, className, createEntry) {
  if (createEntry==null) createEntry=function (x) { return $('<div/>').text(x); }
  var table=$("<table></table>").addClass("className");
  $.each(list, function (i, x) {
    $("<tr></tr>").append($("<td>").html(createEntry(x))).appendTo(table);
  });
  return table;
}

function setWLEdit(entry) {
  whitelist_edit_entry=entry;
  showWhitelist();
}

function showWhitelist() {
  var view=$("#whitelisted_domains");

  var table=$("<table></table>").addClass("entry_table");
  view.html(table);

  $.each(whiteListData, function (i, entry) {
    var hasSubs=strStartsWith(entry, "*.");
    var cellTd=$("<td>").text(entry);
    var cellDel=$('<a href="#"></a>').css("margin-left", "10px").text(ti18n("optionsRemove")).click(function (event) {
      event.preventDefault();
      chrome.runtime.sendMessage({ cmd: "delWhite", domain: entry }, function () {
        var idx = whiteListData.indexOf(entry);
        if (idx >= 0) whiteListData.splice(idx, 1);
        showWhitelist();
      });
    });
    var cellEdit=$('<a href="#"></a>').css("margin-left", "5px").text(ti18n("optionsEdit")).click(function (event) {
      event.preventDefault();
      chrome.runtime.sendMessage({ cmd: "delWhite", domain: entry }, function () {
        var idx = whiteListData.indexOf(entry);
        if (idx >= 0) whiteListData.splice(idx, 1);
        setWLEdit(entry);
      });
    });

    var cellToggle=$('<span/>').css("margin-left", "7px");
    var tchk=$('<input type="checkbox">');
    tchk.attr('checked', hasSubs);
    tchk.change(function () {
      var newEntry = hasSubs ? entry.substr(2) : "*."+entry;
      chrome.runtime.sendMessage({ cmd: "delWhite", domain: entry }, function () {
        var idx = whiteListData.indexOf(entry);
        if (idx >= 0) whiteListData.splice(idx, 1);
        chrome.runtime.sendMessage({ cmd: "addWhite", domain: newEntry }, function () {
          whiteListData.push(newEntry);
          showWhitelist();
        });
      });
    });
    cellToggle.append(tchk);
    cellToggle.append($('<a href="#"></a>').text(ti18n("optionsToggleSub")).click(function (event) { tchk.click().change(); }));

    $("<tr></tr>").append(cellTd).append(cellEdit).append(cellDel).append(cellToggle).appendTo(table);
  });

  var cell1=$("<td><input id='txtWhitelistedDomain' /></td>");
  var cell2=$("<input/>", {
    type: "button", id: "btnWhitelist", value: ti18n("optionsAdd"),
    disabled: "disabled", style: "height:22px;margin-top:2px;"
  });

  $("<tr></tr>").append(cell1).append(cell2).appendTo(table);

  $("#btnWhitelist").click(function () {
    var domain=$("#txtWhitelistedDomain").val();
    if (domain=="") return;

    chrome.runtime.sendMessage({ cmd: "addWhite", domain: domain }, function () {
      whiteListData.push(domain);
      $("#txtWhitelistedDomain").val("");
      showWhitelist();
    });
  });

  $('#txtWhitelistedDomain').keypress(function (event) {
    if (event.keyCode=='13'&&$("#btnWhitelist").attr("disabled")==false) {
      event.preventDefault();
      $("#btnWhitelist").click();
    }
  });

  $("#txtWhitelistedDomain").keyup(function () {
    var domain=$(this).val();
    var ok=domain.length>0;
    $("#btnWhitelist").attr("disabled", ok?null:"disabled");
  });

  if (typeof whitelist_edit_entry!="undefined") {
    $('#txtWhitelistedDomain').val(whitelist_edit_entry);
    $("#txtWhitelistedDomain").keyup();
    delete whitelist_edit_entry;
  }

  showDiag();
}
