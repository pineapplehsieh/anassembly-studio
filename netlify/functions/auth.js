// 這支函式負責 OAuth 流程的第一步：把使用者導到 GitHub 的授權頁面。
// 需要在 Netlify 網站設定裡加兩個環境變數：
//   OAUTH_GITHUB_CLIENT_ID     — GitHub OAuth App 的 Client ID
//   OAUTH_GITHUB_CLIENT_SECRET — GitHub OAuth App 的 Client Secret
exports.handler = async (event) => {
  const clientId = process.env.OAUTH_GITHUB_CLIENT_ID;
  if (!clientId) {
    return { statusCode: 500, body: "缺少環境變數 OAUTH_GITHUB_CLIENT_ID" };
  }

  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  const redirectUri = `${proto}://${host}/.netlify/functions/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo,user",
  });

  return {
    statusCode: 302,
    headers: {
      Location: `https://github.com/login/oauth/authorize?${params.toString()}`,
    },
    body: "",
  };
};
