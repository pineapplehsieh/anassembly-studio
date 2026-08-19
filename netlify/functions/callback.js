// 這支函式負責 OAuth 流程的第二步：GitHub 把使用者導回這裡（帶著一次性的 code），
// 這裡拿 code 跟 GitHub 換成真正的 access token，再用一個小網頁把 token
// 透過 postMessage 傳回原本開啟登入視窗的 /admin 頁面，跟 Decap CMS 溝通用的協定
// 是 Decap CMS 本身內建、固定的格式，這裡照著實作。
exports.handler = async (event) => {
  const code = event.queryStringParameters && event.queryStringParameters.code;
  const clientId = process.env.OAUTH_GITHUB_CLIENT_ID;
  const clientSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET;

  let payload;
  let messageType = "success";

  if (!code) {
    messageType = "error";
    payload = { message: "缺少授權碼（code）" };
  } else if (!clientId || !clientSecret) {
    messageType = "error";
    payload = { message: "缺少環境變數 OAUTH_GITHUB_CLIENT_ID / OAUTH_GITHUB_CLIENT_SECRET" };
  } else {
    try {
      const resp = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const data = await resp.json();
      if (data.error) {
        messageType = "error";
        payload = { message: data.error_description || data.error };
      } else {
        payload = { token: data.access_token, provider: "github" };
      }
    } catch (err) {
      messageType = "error";
      payload = { message: err.message };
    }
  }

  const payloadJson = JSON.stringify(payload).replace(/</g, "\\u003c");

  const html = `<!DOCTYPE html>
<html>
<body>
<script>
(function () {
  function receiveMessage(e) {
    window.opener.postMessage(
      'authorization:github:${messageType}:${payloadJson}',
      e.origin
    );
    window.removeEventListener("message", receiveMessage, false);
  }
  window.addEventListener("message", receiveMessage, false);
  window.opener.postMessage("authorizing:github", "*");
})();
</script>
${messageType === "success" ? "Authorized. 這個視窗會自動關閉…" : "登入失敗，這個視窗可以直接關閉。"}
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: html,
  };
};
