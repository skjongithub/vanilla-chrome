/// <reference path="../lib/jquery-1.8.3.min.js" />

// In-memory cache of chrome.storage.local contents.
// Must be populated via myStore.loadAll() before constructing WhiteList/Option/CookieStore.
var myStore = (function () {
  var cache = {};

  return {
    _cache: cache,

    // Populate cache from chrome.storage.local, then call callback.
    loadAll: function (callback) {
      chrome.storage.local.get(null, function (items) {
        for (var k in items) cache[k] = items[k];
        if (callback) callback();
      });
    },

    get: function (key, defaultValue) {
      return cache.hasOwnProperty(key) ? cache[key] : defaultValue;
    },

    set: function (key, value, callback) {
      cache[key] = value;
      var obj = {};
      obj[key] = value;
      chrome.storage.local.set(obj, callback);
    },

    getAllKeys: function () {
      return Object.keys(cache);
    },

    del: function (key, callback) {
      delete cache[key];
      chrome.storage.local.remove(key, callback);
    }
  };
})();

function getVersion() {
  return chrome.runtime.getManifest().version;
}

function objectEquals(a, b) {
  if (a==b) return true;
  if (a==null||b==null) return false;
  for (var x in a) {
    if (a[x]) {
      var t=typeof (a[x]);
      if (typeof (b[x])!=t) return false;
      switch (t) {
        case 'object': if (!objectEquals(a[x], b[x])) return false; break;
        case 'function': break;
        default: if (a[x]!=b[x]) return false;
      }
    }
    else if (b[x]) return false;
  }
  for (var x in b)
    if (typeof (b[x])!='function'&&typeof (a[x])=='undefined') return false;
  return true;
}

function strStartsWith(str, find) {
  return str!=null?str.indexOf(find)==0:false;
}

function strEndsWith(str, find) {
  if (str!=null) {
    var lastIndex=str.lastIndexOf(find);
    return (lastIndex!= -1)&&(lastIndex+find.length==str.length);
  }
  else return false;
}

function forEach(list, callback) {
  for (var i=0; i<list.length; i++)
    callback(list[i]);
}

function listIndexOf(list, item, selector) {
  if (selector==null) selector=function (x) { return x; };
  for (var i=0; i<list.length; i++) {
    if (item==selector(list[i])) return i;
  }
  return -1;
}

function listContains(list, item, selector) {
  return listIndexOf(list, item, selector)>=0;
}

function arrayToText(list) {
  var rc="";
  for (var i=0; i<list.length; i++)
    rc=rc.concat(list[i], "\n");
  return rc;
}

function openExtUrl(url, refreshOnly, param, onReady) {
  var baseUrl=chrome.runtime.getURL(url);
  if (param==null) param="";

  getAllTabs(function (allTabs) {
    var ok=false;
    for (var i=0; i<allTabs.length; i++) {
      var tab=allTabs[i];
      if (tab.url.indexOf(baseUrl)==0) {
        chrome.tabs.update(tab.id, { "url": baseUrl+param, "selected": !refreshOnly });
        ok=true;
        break;
      }
    }

    if (!refreshOnly&&!ok) chrome.tabs.create({ "url": baseUrl+param, "selected": true });

    if (onReady!=null) onReady();
  });
}

function showOptions(domain) {
  chrome.runtime.sendMessage({ cmd: "refreshOptions", show: true, domain: domain });
}

function ti18n(msg, p1, p2, p3, p4, p5) {
  return chrome.i18n.getMessage(msg, [p1, p2, p3, p4, p5]);
}

function localizePage() {
  $("[i18n]:not(.i18n-replaced)").each(function () {
    $(this).html(ti18n($(this).attr("i18n")));
  });
  $("[i18n_value]:not(.i18n-replaced)").each(function () {
    $(this).val(ti18n($(this).attr("i18n_value")));
  });
  $("[i18n_title]:not(.i18n-replaced)").each(function () {
    $(this).attr("title", ti18n($(this).attr("i18n_title")));
  });
  $("[i18n_replacement_el]:not(.i18n-replaced)").each(function () {
    var dummy_link=$("a", this);
    var text=dummy_link.text();
    var real_el=$("#"+$(this).attr("i18n_replacement_el"));
    real_el.text(text).val(text).replaceAll(dummy_link);
    $(this).addClass("i18n-replaced");
  });
}

function setVersionInfo() {
  $("#versionInfo").text("v"+getVersion()+" by Christian Zangl, coralllama@gmail.com");
}

function splitSubdom(dom) {
  var xmatch=function (dom, regex) {
    var rc=dom.match(regex);
    if (rc&&rc.length>=1) return rc[0];
    return null;
  }

  var suffix;
  if ((suffix=xmatch(dom, /\.[a-z]{2,3}\.[a-z]{2}$/i))) dom=dom.substr(0, dom.length-suffix.length);
  else if ((suffix=xmatch(dom, /\.[a-z]{2,4}$/i))) dom=dom.substr(0, dom.length-suffix.length);
  else suffix="";

  var rc=new Array();
  while (true) {
    var name=dom+suffix;

    rc.push(dom+suffix);
    var i=dom.indexOf(".");
    if (i<0) break;
    dom=dom.substr(i+1);
  }
  return rc;
}

function uriHostAuthority(uri) {
  return uri.authority.split(':')[0];
}

function splitSubdom2(dom) {
  var rc=splitSubdom(dom);
  var i=rc.length-1;
  if (i>=0) rc[i]="*."+rc[i];
  return rc;
}

function getRealDom(dom) {
  if (strStartsWith(dom, ".")) dom=dom.substr(1);
  return dom;
}

function getRootDom(dom) {
  var rc=splitSubdom(getRealDom(dom));
  var i=rc.length-1;
  if (i>=0) return rc[i]; else return null;
}

function getAllTabs(callback) {
  chrome.windows.getAll({ populate: true }, function (windows) {
    var rc=new Array();
    for (var i=0; i<windows.length; i++)
      rc=rc.concat(windows[i].tabs);
    callback(rc);
  });
}

function getAllActiveDomains(callback) {
  var rc=new Array();
  getAllTabs(function (tabs) {
    for (var i=0; i<tabs.length; i++) {
      var uri=new URI(tabs[i].url);
      if (uri.scheme=="http"||uri.scheme=="https") {
        var dom=getRootDom(uriHostAuthority(uri));
        if (!listContains(rc, dom)) rc.push(dom);
      }
    }
    callback(rc);
  });
}

function Log(maxEntries) {
  var log=new Array();
  this.write=function (text) {
    var now=new Date(Date.now()).toLocaleTimeString();
    var last=null;
    if (log.length>0) last=log[0];
    if (last!=null&&last.time==now&&last.text==text) last.count++;
    else log.unshift({ time: now, text: text, count: 1 });
    if (log.length>maxEntries) log=log.slice(maxEntries);
  };

  this.dump=function () {
    return log;
  };
}
