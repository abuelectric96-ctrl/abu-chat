// Thin wrapper around Meta Graph API calls we actually need.
// Docs: https://developers.facebook.com/docs/instagram-platform
const axios = require('axios');

const GRAPH = 'https://graph.facebook.com/v19.0';

async function exchangeCodeForToken({ code, appId, appSecret, redirectUri }) {
  // Step 1: short-lived user token
  const r = await axios.get(`${GRAPH}/oauth/access_token`, {
    params: {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    },
  });
  return r.data; // { access_token, token_type, expires_in }
}

async function getLongLivedUserToken({ shortToken, appId, appSecret }) {
  const r = await axios.get(`${GRAPH}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    },
  });
  return r.data; // { access_token, expires_in (~60 days) }
}

async function getUserPages(userToken) {
  // Pages the user manages — each may have an Instagram Business account attached.
  const r = await axios.get(`${GRAPH}/me/accounts`, {
    params: {
      access_token: userToken,
      fields: 'id,name,access_token,instagram_business_account{id,username,profile_picture_url}',
    },
  });
  return r.data.data; // [{ id, name, access_token, instagram_business_account?: { id, username, ... } }]
}

async function subscribePageToWebhook(pageId, pageAccessToken) {
  // Tells Meta to forward Instagram comment events for this page to our app.
  const r = await axios.post(`${GRAPH}/${pageId}/subscribed_apps`, null, {
    params: {
      subscribed_fields: 'comments,mentions',
      access_token: pageAccessToken,
    },
  });
  return r.data;
}

async function replyToComment({ commentId, message, pageAccessToken }) {
  const r = await axios.post(`${GRAPH}/${commentId}/replies`, null, {
    params: {
      message,
      access_token: pageAccessToken,
    },
  });
  return r.data; // { id }
}

async function getComment({ commentId, pageAccessToken }) {
  const r = await axios.get(`${GRAPH}/${commentId}`, {
    params: {
      fields: 'id,text,username,from,parent_id,media{id}',
      access_token: pageAccessToken,
    },
  });
  return r.data;
}

module.exports = {
  exchangeCodeForToken,
  getLongLivedUserToken,
  getUserPages,
  subscribePageToWebhook,
  replyToComment,
  getComment,
};
