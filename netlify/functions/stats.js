// 讀取 GoatCounter 的訪客統計，整理成後台儀表板要用的簡單格式。
// API token 放在環境變數裡、不會暴露給瀏覽器：
//   GOATCOUNTER_SITE       — GoatCounter 網站代碼（例如 mysite，對應 mysite.goatcounter.com）
//   GOATCOUNTER_API_TOKEN  — GoatCounter 帳號設定裡產生的 API key
const FAR_PAST = "2020-01-01T00:00:00Z";

function isoDaysAgo(days){
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function gcFetch(site, token, path, params){
  const qs = new URLSearchParams(params || {});
  const url = `https://${site}.goatcounter.com/api/v0${path}?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if(!res.ok){
    const text = await res.text().catch(() => "");
    throw new Error(`GoatCounter ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

exports.handler = async () => {
  const site = process.env.GOATCOUNTER_SITE;
  const token = process.env.GOATCOUNTER_API_TOKEN;

  if(!site || !token){
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "缺少環境變數 GOATCOUNTER_SITE / GOATCOUNTER_API_TOKEN" }),
    };
  }

  try{
    const now = new Date().toISOString();
    const [today, last7, last30, allTime, topPages] = await Promise.all([
      gcFetch(site, token, "/stats/total", { start: isoDaysAgo(0), end: now }),
      gcFetch(site, token, "/stats/total", { start: isoDaysAgo(7), end: now }),
      gcFetch(site, token, "/stats/total", { start: isoDaysAgo(30), end: now }),
      gcFetch(site, token, "/stats/total", { start: FAR_PAST, end: now }),
      gcFetch(site, token, "/stats/hits", { start: FAR_PAST, end: now, limit: 10 }),
    ]);

    const body = {
      today: today.total,
      last7Days: last7.total,
      last30Days: last30.total,
      allTime: allTime.total,
      topPages: (topPages.hits || []).map(h => ({
        path: h.path,
        title: h.title,
        count: h.count,
      })),
      dashboardUrl: `https://${site}.goatcounter.com`,
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify(body),
    };
  }catch(err){
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
