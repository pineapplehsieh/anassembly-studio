// 讀取 GoatCounter 的訪客統計，整理成後台儀表板要用的簡單格式。
// API token 放在環境變數裡、不會暴露給瀏覽器：
//   GOATCOUNTER_SITE       — GoatCounter 網站代碼（例如 mysite，對應 mysite.goatcounter.com）
//   GOATCOUNTER_API_TOKEN  — GoatCounter 帳號設定裡產生的 API key
//
// GoatCounter 的 API 限制「每秒最多 4 個請求」，超過會回 429。所以這裡的請求一律
// 排隊、間隔至少 MIN_GAP_MS 才送下一個，被限流時也會依照對方建議的等待時間自動重試。
const FAR_PAST = "2020-01-01T00:00:00Z";
const MIN_GAP_MS = 300;
const MAX_TRIES = 4;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let lastRequestAt = 0;

function isoDaysAgo(days){
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function gcFetch(site, token, path, params){
  const qs = new URLSearchParams(params || {});
  const url = `https://${site}.goatcounter.com/api/v0${path}?${qs.toString()}`;

  for(let attempt = 1; attempt <= MAX_TRIES; attempt++){
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if(wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if(res.ok) return res.json();

    const text = await res.text().catch(() => "");
    if(res.status === 429 && attempt < MAX_TRIES){
      const m = /try again in ([\d.]+)\s*ms/i.exec(text);
      await sleep(Math.max(m ? Math.ceil(parseFloat(m[1])) + 100 : 0, 600));
      continue;
    }
    const brief = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`GoatCounter ${path} ${res.status}: ${brief}`);
  }
}

// 後台頁面在 pineapplehsieh.github.io，這支函式在 netlify.app，是不同網域，
// 瀏覽器會要求回應帶 CORS 許可標頭才肯把內容交給頁面，沒有的話後台只會看到
// 「Failed to fetch」。只開放給自己的網站網域，不對所有人開放。
const ALLOWED_ORIGIN = "https://pineapplehsieh.github.io";

function json(statusCode, body){
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Vary": "Origin",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async () => {
  const site = process.env.GOATCOUNTER_SITE;
  const token = process.env.GOATCOUNTER_API_TOKEN;

  if(!site || !token){
    return json(500, { error: "缺少環境變數 GOATCOUNTER_SITE / GOATCOUNTER_API_TOKEN" });
  }

  try{
    const now = new Date().toISOString();

    // 上面四個數字是核心，任何一個失敗就整個回報錯誤。
    const today = await gcFetch(site, token, "/stats/total", { start: isoDaysAgo(0), end: now });
    const last7 = await gcFetch(site, token, "/stats/total", { start: isoDaysAgo(7), end: now });
    const last30 = await gcFetch(site, token, "/stats/total", { start: isoDaysAgo(30), end: now });
    const allTime = await gcFetch(site, token, "/stats/total", { start: FAR_PAST, end: now });

    // 熱門頁面是附加資訊，失敗的話不要拖垮上面的數字，只把原因帶回去給後台顯示。
    let topPages = [];
    let topPagesError = null;
    try{
      const hits = await gcFetch(site, token, "/stats/hits", { start: FAR_PAST, end: now, limit: 10 });
      topPages = (hits.hits || []).map(h => ({ path: h.path, title: h.title, count: h.count }));
    }catch(err){
      topPagesError = err.message;
    }

    return json(200, {
      today: today.total,
      last7Days: last7.total,
      last30Days: last30.total,
      allTime: allTime.total,
      topPages,
      topPagesError,
      dashboardUrl: `https://${site}.goatcounter.com`,
    });
  }catch(err){
    return json(502, { error: err.message });
  }
};
