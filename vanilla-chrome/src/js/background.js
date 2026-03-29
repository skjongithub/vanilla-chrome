importScripts('../lib/URI.js', 'main.js', 'cookies.js');

var whiteList;
var darkList;
var protectedCookies;
var log;

var option;

// Initialize option after myStore cache is loaded
function initOptions() {
  option = {
    protectCookies: new Option("protectCookies", true),
    clearCookiesOnStartup: new Option("clearCookiesOnStartup", false),
    showUpdates: new Option("showUpdates", false),
    logging: new Option("logging", false),
    autoDelDark: new Option("autoDelDark", false),
    autoDelDarkMinutes: new Option("autoDelDarkMinutes", 30),
    hideTabIcon: new Option("hideTabIcon", false)
  };
}

function WhiteList() {
  var list=myStore.get("whiteList", new Array());

  this.get=function () { return list; };
  this.isEmpty=function () { return list.length==0; };
  this.onChanged=null;

  function realName(name) {
    return strStartsWith(name, "*.")?name.substr(2):name;
  }

  function sort() {
    list.sort(function (a, b) { return realName(a).localeCompare(realName(b)); });
  }

  this.save=function () {
    myStore.set("whiteList", list);
    if (this.onChanged) this.onChanged();
  }

  this.contains=function (dom) {
    return listContains(list, dom);
  }

  this.add=function (dom, dontSave) {
    if (dom!=null&&dom.length>0) {
      dom=dom.toLowerCase();
      if (!this.contains(dom)) {
        list.push(dom);
        sort();
        if (!dontSave) this.save();
      }
    }
  };

  this.remove=function (dom) {
    var idx=listIndexOf(list, dom);
    if (idx>=0) {
      list.splice(idx, 1);
      this.save();
    }
  }

  function isWhiteMatch(def, dom) {
    dom=getRealDom(dom);
    if (strStartsWith(def, "*.")) {
      return dom==def.substr(2)||strEndsWith(dom, def.substr(1));
    }
    else return def==dom;
  }

  this.getItemFor=function (dom) {
    for (var i=0; i<list.length; i++) {
      if (isWhiteMatch(list[i], dom)) return list[i];
    }
    return null;
  }

  this.isWhite=function (dom) {
    return this.getItemFor(dom)!=null;
  }

  this.exportText=function () {
    return arrayToText(list);
  }

  this.importText=function (val) {
    var sites=val.split("\n");
    var newList=new Array();
    for (var i=0; i<sites.length; i++) {
      var dom=sites[i].trim();
      if (dom.length>0) newList.push(dom.toLowerCase());
    }
    if (newList.length>0) {
      list=newList;
      sort();
      this.save();
    }
  }
}

function DarkList() {
  var dict=new Object();

  function getExp(minutes) {
    return Date.now()+minutes*60000;
  }

  this.clear=function () { dict=new Object(); };

  this.add=function (c, dontOverwrite) {
    var exp=getExp(option.autoDelDarkMinutes.get());
    if (dontOverwrite&&dict[uidFromCookie(c)]!=null) return;

    dict[uidFromCookie(c)]= {
      exp: exp,
      domain: c.domain,
      detail: {
        url: urlFromCookie(c),
        name: c.name,
        storeId: c.storeId
      }
    };
  };

  this.process=function () {
    getAllActiveDomains(function (active) {
      var check=Date.now();
      if (log) log.write("checking dark");
      for (var x in dict) {
        var d=dict[x];
        if (d.exp<check) {
          var root=getRootDom(d.domain);
          if (!listContains(active, root)) {
            if (!whiteList.isWhite(d.domain)) {
              if (log) log.write("clear-dark "+d.domain);
              chrome.cookies.remove(d.detail);
            }
            delete dict[x];
          } else {
            d.exp=getExp(5);
            if (log) log.write("extend-dark-active "+d.domain+" by 5 min.");
          }
        } else {
          if (log) log.write("keep-dark "+d.domain+" for "+((d.exp-check)/60000).toFixed(1)+" min.");
        }
      }
    });
  };
}

function Option(name, defaultValue) {
  var optionName=name;
  var value=myStore.get(optionName, defaultValue);
  this.get=function () { return value; };
  this.set=function (newValue) {
    value=newValue;
    myStore.set(optionName, value);
    if (this.onChanged!=null) this.onChanged(value);
  };
}

function bgStartup() {
  var version=getVersion();
  var lastVersion=myStore.get("lastVersion", "");
  myStore.set("lastVersion", version);
  var isNewOrUpdated=lastVersion!=version;

  initOptions();
  whiteList=new WhiteList();
  darkList=new DarkList();
  protectedCookies=new CookieStore();

  chrome.runtime.onMessage.addListener(onMessage);
  chrome.cookies.onChanged.addListener(onCookieChanged);

  // Replace setInterval with alarms (service workers can't use setInterval)
  chrome.alarms.create("idleLong", { periodInMinutes: 2 });
  chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name=="idleLong") onIdleLong();
  });

  whiteList.onChanged=onWhiteListChanged;
  option.logging.onChanged=onLoggingChanged;
  option.protectCookies.onChanged=onProtectCookiesChanged;
  option.autoDelDark.onChanged=onAutoDelDarkChanged;
  option.hideTabIcon.onChanged=onHideTabIconChanged;
  onLoggingChanged();

  if (log) log.write("start");

  if (option.protectCookies.get()) {
    restoreProtectedCookies(protectedCookies.getAll(), true);
    if (!isNewOrUpdated) reloadAllTabs();
  }

  if (option.clearCookiesOnStartup.get()) {
    clearUnwantedCookies(whiteList, null, log);
  }

  chrome.tabs.onUpdated.addListener(setTabIcon);
  onWhiteListChanged();

  if (lastVersion=="") {
    option.protectCookies.set(false);
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html"), selected: false });
  }
  else if (isNewOrUpdated&&option.showUpdates.get()) chrome.tabs.create({ url: chrome.runtime.getURL("updated.html"), selected: false });
}

function onMessage(request, sender, sendResponse) {
  if (sender.id !== chrome.runtime.id) return false;

  var cmd=request.cmd;
  if (log) log.write("on-message "+cmd);

  if (cmd=="getState") {
    var optionValues={};
    for (var k in option) {
      optionValues[k]=option[k].get();
    }
    sendResponse({
      whiteList: whiteList.get(),
      options: optionValues,
      protectedCookiesByDom: groupCookiesByDom(protectedCookies.getAll())
    });
    return false;
  }
  else if (cmd=="getLog") {
    sendResponse(log?log.dump():[]);
    return false;
  }
  else if (cmd=="addWhite") {
    whiteList.add(request.domain);
    refreshOptions(false);
    sendResponse({});
    return false;
  }
  else if (cmd=="delWhite") {
    whiteList.remove(request.domain);
    refreshOptions(false);
    sendResponse({});
    return false;
  }
  else if (cmd=="importWhite") {
    whiteList.importText(request.text);
    sendResponse({});
    return false;
  }
  else if (cmd=="setOption") {
    if (option[request.name]) option[request.name].set(request.value);
    sendResponse({});
    return false;
  }
  else if (cmd=="clearAll") {
    clearUnwantedCookies(whiteList, function (result) {
      sendResponse({ black: result.black.length, total: result.total });
    }, log);
    return true; // async response
  }
  else if (cmd=="refreshOptions") {
    refreshOptions(request.show, request.domain);
    return false;
  }
}

function refreshOptions(show, dom) {
  var param;
  if (dom!=null) param="?"+dom;
  openExtUrl("options.html", !show, param);
}

function onLoggingChanged() {
  log=option.logging.get()?new Log(200):null;
}

function onProtectCookiesChanged(enabled) {
  if (log) log.write("on-protectcookies-changed");
  if (enabled) {
    backupProtectedCookies(function () {
      restoreProtectedCookies(protectedCookies.getAll());
    });
  }
  else
    protectedCookies.clear();
}

function onWhiteListChanged() {
  if (log) log.write("on-whitelist-changed");
  updateAllTabIcons();
  backupProtectedCookies();
  onAutoDelDarkChanged();
}

function onAutoDelDarkChanged() {
  if (option.autoDelDark.get()) {
    loadAllCookies(whiteList, function (result) {
      forEach(result.black, function (c) { darkList.add(c, true); });
    });
  }
  else
    darkList.clear();
}

function onHideTabIconChanged() {
  updateAllTabIcons();
}

function onIdleLong() {
  if (option.autoDelDark.get())
    darkList.process();
}

function onCookieChanged(changeInfo) {
  var c=changeInfo.cookie;
  if (log) log.write("on-cookie-changed: "+getRealDom(c.domain));
  if (whiteList.isWhite(c.domain)) {
    if (option.protectCookies.get()) {
      if (changeInfo.removed) protectedCookies.remove(c);
      else protectedCookies.add(c);
    }
  }
  else if (!changeInfo.removed&&option.autoDelDark.get())
    darkList.add(c);
}

function reloadAllTabs() {
  if (log) log.write("start-restored");
  getAllTabs(function (tabs) {
    for (var i=0; i<tabs.length; i++) {
      var t=tabs[i];
      if (strStartsWith(t.url, "http")) {
        chrome.tabs.update(t.id, { url: t.url });
        chrome.tabs.executeScript(t.id, { code: "location.reload()" });
      }
    }
  });
}

function updateAllTabIcons() {
  getAllTabs(function (tabs) {
    for (var i=0; i<tabs.length; i++)
      setTabIcon(tabs[i].id, null, tabs[i]);
  });
}

function setTabIcon(tabId, changeInfo, tab) {
  if (!option.hideTabIcon.get()) {
    var url=tab.url;
    if (strStartsWith(url, "http:")||strStartsWith(url, "https:")) {
      var uri=new URI(url);
      var white=whiteList.isWhite(uriHostAuthority(uri));
      showTabIcon(tabId, true, white);
    }
    else if (strStartsWith(url, "chrome://newtab")||url=="about:blank") showTabIcon(tabId, true, true);
    else showTabIcon(tabId, false);
  }
  else showTabIcon(tabId, false);
}

var _iconCache = {};

function loadIconImageData(path) {
  if (_iconCache[path]) return Promise.resolve(_iconCache[path]);
  return fetch(chrome.runtime.getURL(path))
    .then(function (r) { return r.blob(); })
    .then(function (blob) { return createImageBitmap(blob); })
    .then(function (bitmap) {
      var canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      var ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      var imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      _iconCache[path] = imageData;
      return imageData;
    });
}

function showTabIcon(tabId, enable, white) {
  var path = enable ? "img/"+(white?"icon32":"disabled")+".png" : "img/disabled.png";
  loadIconImageData(path).then(function (imageData) {
    chrome.action.setIcon({ tabId: tabId, imageData: imageData });
    if (enable) chrome.action.enable(tabId);
    else chrome.action.disable(tabId);
  });
}

function backupProtectedCookies(callback) {
  if (option.protectCookies.get()) {
    loadAllCookies(whiteList, function (result) {
      var list=result.white;
      for (var i=0; i<list.length; i++)
        protectedCookies.add(list[i]);
      protectedCookies.cleanUp(whiteList);
      if (callback!=null) callback();
    });
  }
}

function restoreProtectedCookies(list, forceOverwrite) {
  if (option.protectCookies.get()) {
    for (var i=0; i<list.length; i++)
      protectedCookies.restore(list[i], forceOverwrite);
  }
}

// Startup: load all storage into cache first, then initialize
myStore.loadAll(bgStartup);
