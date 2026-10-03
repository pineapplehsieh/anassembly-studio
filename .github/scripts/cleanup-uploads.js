// 清掉 uploads/ 裡「已經沒有任何內容在用」的檔案（以及它們在 thumbs/uploads/ 的縮圖）。
//
// 安全規則：
//  1. 只動 uploads/ 與 thumbs/uploads/，絕不碰 images/、images2~4/ 這些手動放的資料夾。
//  2. 一個檔案「最後一次被 commit」要超過 GRACE_DAYS 天（預設 7）才會被刪。
//     後台是先上傳圖片、再存內容，中間隔幾秒到幾分鐘，這個寬限期保證不會把剛上傳、
//     還沒被引用的檔案誤刪。
//  3. 「有在用」＝ content/*.json、index.html、admin/index.html 任何一處提到這個路徑
//     （原樣、或網址編碼後的樣子都算）。
//  4. 讀不到內容、或一個引用都找不到時直接中止，不刪任何東西（避免 JSON 壞掉時整批誤刪）。
//  5. 刪掉的檔案都還留在 git 歷史裡，需要時可以救回來。
//
// 用法：node .github/scripts/cleanup-uploads.js [--dry]   （環境變數 DRY_RUN=true 也是試跑）
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry") || process.env.DRY_RUN === "true";
const GRACE_DAYS = Number(process.env.GRACE_DAYS || 7);
const NOW = Date.now() / 1000;

function read(rel){ return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function listFiles(dir){
  const abs = path.join(ROOT, dir);
  if(!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).filter(e => e.isFile()).map(e => dir + "/" + e.name);
}
function lastCommitTime(rel){
  const out = execFileSync("git", ["log", "-1", "--format=%ct", "--", rel], { cwd: ROOT }).toString().trim();
  return out ? Number(out) : null;
}

// --- 1. 收集「有在用」的文字來源 ---
const sources = ["index.html", "admin/index.html"];
fs.readdirSync(path.join(ROOT, "content")).filter(f => f.endsWith(".json")).forEach(f => sources.push("content/" + f));
let haystack = "";
for(const s of sources){
  const text = read(s);
  if(s.endsWith(".json")) JSON.parse(text); // 壞掉的 JSON 直接丟錯中止
  haystack += "\n" + text;
}
const refCount = (haystack.match(/uploads\//g) || []).length;
const uploads = listFiles("uploads");
if(uploads.length && refCount === 0){
  console.error("ABORT: 找不到任何 uploads/ 的引用，可能是內容檔壞了，不刪除任何東西。");
  process.exit(1);
}

function isReferenced(rel){
  const name = rel.slice(rel.indexOf("/") + 1);
  return haystack.includes(rel) || haystack.includes("uploads/" + encodeURIComponent(name)) || haystack.includes(encodeURI(rel));
}

// --- 2. 找出該刪的 uploads/ 檔案 ---
const toDelete = [];
const kept = { referenced: 0, tooNew: 0 };
for(const rel of uploads){
  if(isReferenced(rel)){ kept.referenced++; continue; }
  const t = lastCommitTime(rel);
  if(t === null || (NOW - t) / 86400 < GRACE_DAYS){ kept.tooNew++; continue; }
  toDelete.push(rel);
}

// --- 3. 孤兒縮圖：thumbs/uploads/<名稱>.jpg 對應的原圖（任何副檔名）已經不存在 ---
const remainingBases = new Set(
  uploads.filter(r => !toDelete.includes(r)).map(r => path.basename(r).replace(/\.[^.]+$/, ""))
);
const orphanThumbs = listFiles("thumbs/uploads").filter(rel => !remainingBases.has(path.basename(rel).replace(/\.[^.]+$/, "")));

// --- 4. 執行 ---
const all = [...toDelete, ...orphanThumbs];
const mb = (rels) => (rels.reduce((a, r) => a + fs.statSync(path.join(ROOT, r)).size, 0) / 1048576).toFixed(1);
const lines = [
  `${DRY ? "【試跑，沒有真的刪除】" : "已清除"}`,
  `uploads/ 共 ${uploads.length} 個檔案：使用中 ${kept.referenced}、未滿 ${GRACE_DAYS} 天先保留 ${kept.tooNew}、要刪除 ${toDelete.length}（${mb(toDelete)}MB）`,
  `孤兒縮圖要刪除 ${orphanThumbs.length} 個（${mb(orphanThumbs)}MB）`,
  ...all.map(r => "  - " + r),
];
console.log(lines.join("\n"));
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
if(!DRY) all.forEach(r => fs.unlinkSync(path.join(ROOT, r)));
