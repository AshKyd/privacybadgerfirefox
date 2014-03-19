/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Cc, Ci } = require("chrome");
const ContentPolicy = require("./contentPolicy");
const pbUI = require("./ui");
const events = require("sdk/system/events");
const heuristicBlocker = require("./heuristicBlocker");
const userStorage = require("./userStorage");
const utils = require("./utils");
const { storage } = require("sdk/simple-storage");
const { on, once, off, emit } = require('sdk/event/core');

/**
 *  http-on-examine-response:
 *    update the heuristic blocker
 */

function onExamineResponse(event) {
  let channel = event.subject.QueryInterface(Ci.nsIHttpChannel);

  // Do nothing if this is a first-party channel
  if (!utils.isThirdPartyChannel(channel)) {
    return null;
  }

  heuristicBlocker.updateHeuristics(channel);
}

/**
 *  http-on-modify-request:
 *    userYellow - clear referer, add DNT, send the request
 *    userGreen and other requests - add DNT, send the request
 *
 *  Note that userRed and other blocked requests are handled by ContentPolicy.
 *  userYellow cookie clobbering is also handled separately. There's no need
 *  to re-clobber cookies on every request.
 *
 */

function onModifyRequest(event) {
  let channel = event.subject.QueryInterface(Ci.nsIHttpChannel);

  // Always set DNT?
  channel.setRequestHeader("DNT", "1", false);

  // Do nothing more if this is a first-party channel
  if (!utils.isThirdPartyChannel(channel)) {
    return null;
  }

  // TODO: investigate moving blocking from ContentPolicy to here because we
  // have a nice way to get the top window from a channel.
  let aWin = utils.getTopWindowForChannel(channel);

  // shouldCookieblockRequest emits cookieblock / usercookieblock / noaction.
  if (ContentPolicy.Policy.shouldCookieblockRequest(channel.URI, aWin)) {
    // Clear referer for all requests where we would clobber cookies.
    channel.setRequestHeader("Referer", "", false);
  }
}

function main(options) {
  heuristicBlocker.init();
  userStorage.init();
  userStorage.sync();

  let categoryManager = Cc["@mozilla.org/categorymanager;1"]
                          .getService(Ci.nsICategoryManager);
  categoryManager.addCategoryEntry(
    "content-policy", "PrivacyBadgerContentPolicy",
    ContentPolicy.ContentPolicyFactory.contract, false, true);

  events.on("http-on-examine-response", onExamineResponse, false);
  events.on("http-on-modify-request", onModifyRequest, false);

  // This listener below is a weird hack because I couldn't get any of the
  // regular startup notifications to fire. From the docs, it seems that
  // pbUI.onStartup should be be listening for sessionstore-windows-restored.
  events.once("http-on-modify-request", pbUI.onStartup, false);
  console.log("started up!");
}

function unload(reason) {
  let categoryManager = Cc["@mozilla.org/categorymanager;1"]
                       .getService(Ci.nsICategoryManager);
  categoryManager.deleteCategoryEntry("content-policy",
                                      "PrivacyBadgerContentPolicy", false);
  events.off("http-on-examine-response", onExamineResponse);
  events.off("http-on-modify-request", onModifyRequest);
  // Remove webprogress listener
  pbUI.onShutdown();
  // Remove settings listeners
  off(pbUI.settingsMap);
  console.log("successful unload");
}

exports.main = main;
exports.onUnload = unload;