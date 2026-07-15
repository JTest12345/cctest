// ===================================================================
// 週レシピ管理アプリ - メインロジック
// データはすべて localStorage に保存
// ===================================================================

const STORAGE_KEYS = {
  recipes: 'wr_recipes_v1',
  weekPlan: 'wr_weekplan_v1',
  history: 'wr_history_v1',
  sampleDataVersion: 'wr_sample_data_version',
  schemaVersion: 'wr_schema_version',
  templates: 'wr_templates_v1',   // 献立テンプレート
  shopping: 'wr_shopping_v1',     // 買い物リストのチェック状態（週ごと）
  purchases: 'wr_purchases_v1'    // 買い物・食費記録
};

const SCHEMA_VERSION = 2; // 1: 1日1レシピ, 2: 1日複数レシピ
const IDB_NAME = 'WeekRecipePhotoDB';
const IDB_VERSION = 2;
const IDB_STORE = 'photos';
const IDB_BACKUP_STORE = 'backup';
const EXPORT_FORMAT_VERSION = 3; // v3: マージ対応（レシピupdatedAt・メモ/URL）。v1/v2ファイルも取り込み可

// 写真圧縮設定
const PHOTO_MAX_DIM = 1024;     // 長辺の最大px
const PHOTO_QUALITY = 0.7;       // JPEG品質

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_ORDER_JP = ['月', '火', '水', '木', '金', '土', '日'];

// 食材カテゴリ分類ルール（買い物リストのグループ分け用・上から順にマッチ）
const CATEGORY_RULES = [
  { cat: '魚介', kw: ['鮭','さば','ぶり','えび', 'エビ','いか','イカ','たこ','タコ','あさり','しじみ','まぐろ','マグロ','サーモン','かに','カニ','貝','ツナ','たら','タラ','ほたて','ホタテ','魚','切り身','刺身','うなぎ'] },
  { cat: '肉類', kw: ['肉','鶏','豚','牛','ひき肉','挽き肉','ベーコン','ハム','ウインナー','ソーセージ','チャーシュー','ささみ','レバー','ミンチ'] },
  { cat: '卵・乳・豆腐', kw: ['卵','たまご','牛乳','チーズ','バター','生クリーム','ヨーグルト','豆腐','油揚げ','厚揚げ','がんも','練乳','モッツァレラ'] },
  { cat: '野菜・きのこ', kw: ['玉ねぎ','たまねぎ','人参','にんじん','じゃがいも','ジャガイモ','さつまいも','里芋','大根','キャベツ','白菜','ねぎ','長ねぎ','小ねぎ','なす','ナス','トマト','きゅうり','ピーマン','パプリカ','ほうれん草','小松菜','チンゲン菜','春菊','レタス','もやし','にら','ニラ','ブロッコリー','ごぼう','れんこん','かぼちゃ','にんにく','ニンニク','生姜','しょうが','椎茸','しいたけ','しめじ','えのき','まいたけ','エリンギ','きのこ','アボカド','セロリ','ズッキーニ','みょうが','大葉','たけのこ','とうもろこし','コーン','枝豆','三つ葉','クレソン','ズッキー','かぶ'] },
  { cat: '主食・麺・粉', kw: ['ご飯','米','うどん','そば','そうめん','パスタ','スパゲ','中華麺','焼きそば','ラーメン','麺','食パン','パン','バゲット','餃子の皮','春巻きの皮','焼売の皮','マカロニ','トルティーヤ','春雨','ビーフン','フォー','小麦粉','薄力粉','強力粉','片栗粉','パン粉','ホットケーキミックス','米粉'] },
  { cat: '調味料・乾物', kw: ['醤油','しょうゆ','味噌','みそ','塩','砂糖','みりん','酒','酢','油','ソース','ケチャップ','マヨネーズ','だし','出汁','豆板醤','甜麺醤','コチュジャン','オイスター','コンソメ','ルー','こしょう','胡椒','ごま','ナンプラー','カレー粉','唐辛子','鷹の爪','わさび','からし','ポン酢','めんつゆ','はちみつ','ジャム','のり','海苔','わかめ','昆布','かつお節','ふりかけ','ガラス','鶏がら','ココナッツ','ペースト','ドレッシング','スパイス','ガラムマサラ','クミン'] }
];

// 常備品（除外候補）— 名前にこれらを含むと「常備品」とみなす
const STAPLE_KEYWORDS = ['醤油','しょうゆ','塩','砂糖','みりん','酒','酢','こしょう','胡椒','塩こしょう','サラダ油','ごま油','オリーブオイル','油','味噌','みそ','だし','出汁','片栗粉','小麦粉','薄力粉','パン粉','マヨネーズ','ケチャップ','バター','にんにく','生姜','しょうが','揚げ油','コンソメ','和風だし','鶏がら','ガラスープ','水'];

// ===================================================================
// ストレージ操作
// ===================================================================
const Storage = {
  load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('localStorage load error', e);
      return fallback;
    }
  },
  save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('localStorage save error', e);
      showToast('保存に失敗しました');
    }
  }
};

// ===================================================================
// アプリ状態
// ===================================================================
const state = {
  recipes: [],
  weekPlan: {},          // { "W-2026-05-25": { mon: [{slotId, recipeId, checked, completed, completedAt}], ... } }
  history: [],           // [{ historyId, recipeId, recipeName, completedAt, photoId|null }]
  currentWeekStart: null, // Date (月曜日)
  currentTab: 'week',
  currentCategoryFilter: 'all',
  currentEditingRecipeId: null,
  currentCookingSlotId: null,
  currentCookingDay: null,
  currentCookingWeekKey: null,
  selectModalTargetDay: null,
  currentPhotoHistoryIdx: null,
  photoDB: null,
  // 追加機能用
  templates: [],          // [{id, name, createdAt, plan:{mon:[recipeId,...],...}}]
  shopping: {},           // { [weekKey]: { checked:{name:true}, extras:[{name,checked}], excludeStaples, excludeCompleted } }
  purchases: [],          // [{id, date, store, items:[{name,qty,price}], total, note, photoId}]
  photoTarget: null,      // 写真取得対象 {type:'history',idx} | {type:'receipt'}
  recipeSortMode: 'name', // 'name' | 'suggest'
  recordsMonth: null,     // Date（その月の1日）
  editingPurchaseId: null,
  editingPurchaseItems: [],
  editingReceiptPhotoId: null,
  statsPeriod: '30',      // カテゴリ構成の集計期間 '30' | 'all'
  dayPickerRecipeId: null // 「また作る」対象レシピ
};

// ===================================================================
// IndexedDB (写真保存)
// ===================================================================
const PhotoDB = {
  open() {
    return new Promise((resolve, reject) => {
      if (state.photoDB) { resolve(state.photoDB); return; }
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(IDB_BACKUP_STORE)) {
          db.createObjectStore(IDB_BACKUP_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        state.photoDB = e.target.result;
        resolve(state.photoDB);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },
  async save(id, blob) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ id, blob, createdAt: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },
  async get(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = (e) => reject(e.target.error);
    });
  },
  async delete(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },
  async getAllKeys() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  },
  async getAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  },
  async clear() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }
};

// バックアップストア操作
const BackupDB = {
  async save(snapshot) {
    const db = await PhotoDB.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_BACKUP_STORE, 'readwrite');
      tx.objectStore(IDB_BACKUP_STORE).put({ id: 'last_backup', ...snapshot });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },
  async get() {
    const db = await PhotoDB.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_BACKUP_STORE, 'readonly');
      const req = tx.objectStore(IDB_BACKUP_STORE).get('last_backup');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  },
  async delete() {
    const db = await PhotoDB.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_BACKUP_STORE, 'readwrite');
      tx.objectStore(IDB_BACKUP_STORE).delete('last_backup');
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }
};

// ===================================================================
// データ管理（エクスポート / インポート / バックアップ）
// ===================================================================

// Blob → Base64 dataURL
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Blobの読み取りに失敗しました'));
    reader.readAsDataURL(blob);
  });
}

// Base64 dataURL → Blob
function dataURLToBlob(dataURL) {
  const parts = dataURL.split(',');
  const mimeMatch = parts[0].match(/data:([^;]+);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(parts[1]);
  const len = binary.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// 容量しきい値（書き出しJSONの推定サイズ基準）
const SIZE_CAUTION = 30 * 1024 * 1024;  // 30MB：やや大きい
const SIZE_DANGER = 80 * 1024 * 1024;   // 80MB：失敗リスク大
// Base64化(+33%) + JSON内エスケープ等の概算係数
const BASE64_OVERHEAD = 1.37;

// 書き出しサイズを事前推定（重いBase64変換をせずに概算）
async function estimateExportSize() {
  let photoBytes = 0;
  let photoCount = 0;
  try {
    const photos = await PhotoDB.getAll();
    photoCount = photos.length;
    photos.forEach(p => { if (p && p.blob) photoBytes += p.blob.size; });
  } catch (e) { /* IndexedDB未対応時は0扱い */ }
  const textBytes =
    JSON.stringify(state.recipes).length +
    JSON.stringify(state.weekPlan).length +
    JSON.stringify(state.history).length;
  const estBytes = textBytes + Math.round(photoBytes * BASE64_OVERHEAD);
  return { estBytes, photoCount, photoBytes, textBytes };
}

// 全データを集約
async function buildExportPayload() {
  const photos = await PhotoDB.getAll();
  const photosMap = {};
  for (const p of photos) {
    if (p && p.id && p.blob) {
      try {
        photosMap[p.id] = await blobToDataURL(p.blob);
      } catch (e) {
        console.warn('photo skipped:', p.id, e);
      }
    }
  }
  return {
    format: 'week-recipe-app',
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    recipes: state.recipes,
    weekPlan: state.weekPlan,
    history: state.history,
    templates: state.templates,
    shopping: state.shopping,
    purchases: state.purchases,
    photos: photosMap,
    sampleDataVersion: window.SAMPLE_DATA_VERSION || 1,
    schemaVersion: 2
  };
}

// エクスポート実行
async function exportData() {
  // 事前に容量を推定して警告
  const { estBytes, photoCount } = await estimateExportSize();
  if (estBytes >= SIZE_DANGER) {
    const ok = confirm(
      `⚠️ 書き出すデータが非常に大きいです（推定 ${formatBytes(estBytes)}・写真${photoCount}枚）。\n\n` +
      `iPhoneでは書き出しや取り込みに失敗する可能性があります。\n` +
      `不要な履歴や写真を削除すると安全に転送できます。\n\n` +
      `このまま続けますか？`
    );
    if (!ok) return;
  } else if (estBytes >= SIZE_CAUTION) {
    const ok = confirm(
      `書き出すデータがやや大きめです（推定 ${formatBytes(estBytes)}・写真${photoCount}枚）。\n` +
      `処理に少し時間がかかる場合があります。\n\n続けますか？`
    );
    if (!ok) return;
  }

  showUploadingOverlay('データを書き出し中...');
  try {
    const payload = await buildExportPayload();
    const json = JSON.stringify(payload);
    const blob = new Blob([json], { type: 'application/json' });
    const now = new Date();
    const filename = `recipe-app-backup-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.json`;
    const file = new File([blob], filename, { type: 'application/json' });

    hideUploadingOverlay();

    // Web Share API（iPhone Safari等）で共有シート起動を試行
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'レシピ管理データ' });
        showToast('共有しました');
        return;
      } catch (e) {
        if (e.name === 'AbortError') {
          // ユーザーがキャンセル → ダウンロードにフォールバック
        } else {
          console.warn('share failed, fallback to download', e);
        }
      }
    }

    // フォールバック：通常ダウンロード
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`書き出しました（${formatBytes(blob.size)}）`);
  } catch (err) {
    hideUploadingOverlay();
    console.error(err);
    showToast('書き出しに失敗しました: ' + (err.message || ''));
  }
}

// インポート：プレビューデータ
let pendingImportPayload = null;

async function handleImportFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

  // 巨大ファイルは解析前に警告（解析中のクラッシュを防ぐ）
  if (file.size >= SIZE_DANGER) {
    const ok = confirm(
      `⚠️ 取り込むファイルが非常に大きいです（${formatBytes(file.size)}）。\n\n` +
      `iPhoneでは取り込み中にアプリが落ちる可能性があります。\n\n` +
      `このまま続けますか？`
    );
    if (!ok) return;
  } else if (file.size >= SIZE_CAUTION) {
    const ok = confirm(
      `取り込むファイルがやや大きめです（${formatBytes(file.size)}）。\n` +
      `解析に少し時間がかかる場合があります。\n\n続けますか？`
    );
    if (!ok) return;
  }

  showUploadingOverlay('ファイルを解析中...');
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    // バリデーション
    if (!payload || payload.format !== 'week-recipe-app') {
      throw new Error('このアプリのバックアップファイルではありません');
    }
    if (typeof payload.formatVersion !== 'number') {
      throw new Error('ファイル形式が認識できません');
    }
    if (payload.formatVersion > EXPORT_FORMAT_VERSION) {
      throw new Error(`新しいバージョンのファイルです（v${payload.formatVersion}）。アプリを更新してください`);
    }
    if (!Array.isArray(payload.recipes) || !payload.weekPlan || !Array.isArray(payload.history)) {
      throw new Error('ファイル内容が壊れています');
    }
    pendingImportPayload = payload;
    hideUploadingOverlay();
    await showImportPreview(payload, file.size);
  } catch (err) {
    hideUploadingOverlay();
    console.error(err);
    showToast('読み込み失敗: ' + (err.message || ''));
  }
}

async function showImportPreview(payload, fileSize) {
  const content = document.getElementById('importPreviewContent');
  const photoCount = payload.photos ? Object.keys(payload.photos).length : 0;
  const planCount = countPlanSlots(payload.weekPlan);
  const exportedAt = payload.exportedAt ? new Date(payload.exportedAt) : null;
  const exportedAtStr = exportedAt ? `${exportedAt.getFullYear()}/${exportedAt.getMonth() + 1}/${exportedAt.getDate()} ${String(exportedAt.getHours()).padStart(2, '0')}:${String(exportedAt.getMinutes()).padStart(2, '0')}` : '不明';

  const diff = await computeMergeDiff(payload);

  content.innerHTML = `
    <div class="preview-row title"><span>取り込み元データ</span><span>${exportedAtStr}</span></div>
    <div class="preview-row"><span>レシピ</span><span>${payload.recipes.length}件</span></div>
    <div class="preview-row"><span>献立予定</span><span>${planCount}件</span></div>
    <div class="preview-row"><span>完了履歴</span><span>${payload.history.length}件</span></div>
    <div class="preview-row"><span>写真</span><span>${photoCount}枚</span></div>
    <div class="preview-row"><span>ファイルサイズ</span><span>${formatBytes(fileSize)}</span></div>
    <div class="preview-row title" style="margin-top:10px;"><span>🔀 マージした場合に増える分</span><span></span></div>
    <div class="preview-row"><span>新しいレシピ</span><span>+${diff.newRecipes}件${diff.updatedRecipes ? `（更新 ${diff.updatedRecipes}件）` : ''}</span></div>
    <div class="preview-row"><span>新しい履歴</span><span>+${diff.newHistory}件</span></div>
    <div class="preview-row"><span>新しい写真</span><span>+${diff.newPhotos}枚</span></div>
    <div class="preview-row"><span>新しい食費記録</span><span>+${diff.newPurchases}件</span></div>
    <div class="preview-row"><span>新しいテンプレート</span><span>+${diff.newTemplates}件</span></div>
    <div class="preview-row title" style="margin-top:10px;"><span>現在のデータ</span><span></span></div>
    <div class="preview-row"><span>レシピ</span><span>${state.recipes.length}件</span></div>
    <div class="preview-row"><span>完了履歴</span><span>${state.history.length}件</span></div>
  `;
  showModal('importPreviewModal');
}

// マージした場合の差分を事前計算
async function computeMergeDiff(payload) {
  const localRecipeIds = new Set(state.recipes.map(r => r.id));
  const newRecipes = (payload.recipes || []).filter(r => r && r.id && !localRecipeIds.has(r.id)).length;
  let updatedRecipes = 0;
  (payload.recipes || []).forEach(inc => {
    if (!inc || !inc.id) return;
    const loc = state.recipes.find(r => r.id === inc.id);
    if (loc && (inc.updatedAt || '') > (loc.updatedAt || '')) updatedRecipes++;
  });
  const localHist = new Set(state.history.map(h => h.historyId));
  const newHistory = (payload.history || []).filter(h => h && h.historyId && !localHist.has(h.historyId)).length;
  const localPur = new Set(state.purchases.map(p => p.id));
  const newPurchases = (payload.purchases || []).filter(p => p && p.id && !localPur.has(p.id)).length;
  const localTpl = new Set(state.templates.map(t => t.id));
  const newTemplates = (payload.templates || []).filter(t => t && t.id && !localTpl.has(t.id)).length;
  let newPhotos = 0;
  try {
    const localKeys = new Set(await PhotoDB.getAllKeys());
    newPhotos = Object.keys(payload.photos || {}).filter(id => !localKeys.has(id)).length;
  } catch (e) {}
  return { newRecipes, updatedRecipes, newHistory, newPurchases, newTemplates, newPhotos };
}

// マージ取り込み実行：両端末のデータを統合（削除は伝搬しない）
async function executeMergeImport() {
  if (!pendingImportPayload) return;
  showUploadingOverlay('バックアップ取得中...');
  try {
    await takeAutoBackup();
    showUploadingOverlay('データをマージ中...');
    const p = pendingImportPayload;

    // レシピ：idで統合、updatedAtが新しい方を採用（両方未編集なら現状維持）
    const byId = new Map(state.recipes.map(r => [r.id, r]));
    (p.recipes || []).forEach(inc => {
      if (!inc || !inc.id) return;
      const loc = byId.get(inc.id);
      if (!loc) { byId.set(inc.id, inc); return; }
      if ((inc.updatedAt || '') > (loc.updatedAt || '')) byId.set(inc.id, inc);
    });
    state.recipes = [...byId.values()];

    // 履歴：historyIdの和集合、完了日時の新しい順
    const histIds = new Set(state.history.map(h => h.historyId));
    (p.history || []).forEach(h => {
      if (h && h.historyId && !histIds.has(h.historyId)) {
        state.history.push(h);
        histIds.add(h.historyId);
      }
    });
    state.history.sort((a, b) => ((a.completedAt || '') < (b.completedAt || '') ? 1 : -1));
    if (state.history.length > 500) {
      const removed = state.history.splice(500);
      removed.forEach(h => { if (h.photoId) PhotoDB.delete(h.photoId).catch(() => {}); });
    }

    // 食費記録・テンプレート：idの和集合（同idは取り込み側を優先）
    const purById = new Map(state.purchases.map(x => [x.id, x]));
    (p.purchases || []).forEach(x => { if (x && x.id) purById.set(x.id, x); });
    state.purchases = [...purById.values()];
    const tplById = new Map(state.templates.map(x => [x.id, x]));
    (p.templates || []).forEach(x => { if (x && x.id) tplById.set(x.id, x); });
    state.templates = [...tplById.values()];

    // 週プラン：週×曜日でslotIdの和集合（同slotIdは完了済みを優先）
    Object.entries(p.weekPlan || {}).forEach(([wk, days]) => {
      if (!state.weekPlan[wk]) { state.weekPlan[wk] = days; return; }
      Object.entries(days || {}).forEach(([dk, slots]) => {
        if (!Array.isArray(slots)) return;
        const locSlots = Array.isArray(state.weekPlan[wk][dk]) ? state.weekPlan[wk][dk] : [];
        const map = new Map(locSlots.map(s => [s.slotId, s]));
        slots.forEach(s => {
          if (!s || !s.slotId) return;
          const loc = map.get(s.slotId);
          if (!loc) map.set(s.slotId, s);
          else if (s.completed && !loc.completed) map.set(s.slotId, s);
        });
        state.weekPlan[wk][dk] = [...map.values()];
      });
    });

    // 買い物リスト：チェックはOR、手動品目は名前で和集合
    Object.entries(p.shopping || {}).forEach(([wk, inc]) => {
      if (!inc) return;
      if (!state.shopping[wk]) { state.shopping[wk] = inc; return; }
      const loc = state.shopping[wk];
      Object.entries(inc.checked || {}).forEach(([k, v]) => {
        if (v) { (loc.checked = loc.checked || {})[k] = true; }
      });
      const names = new Set((loc.extras || []).map(e => e.name));
      (inc.extras || []).forEach(e => {
        if (e && e.name && !names.has(e.name)) (loc.extras = loc.extras || []).push(e);
      });
    });

    // 写真：ローカルにないIDのみ追加（ローカル写真は消さない）
    showUploadingOverlay('写真をマージ中...');
    const localKeys = new Set(await PhotoDB.getAllKeys());
    for (const [id, dataURL] of Object.entries(p.photos || {})) {
      if (localKeys.has(id)) continue;
      try {
        await PhotoDB.save(id, dataURLToBlob(dataURL));
      } catch (e) {
        console.warn('photo merge skipped:', id, e);
      }
    }

    Storage.save(STORAGE_KEYS.recipes, state.recipes);
    Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
    Storage.save(STORAGE_KEYS.history, state.history);
    Storage.save(STORAGE_KEYS.templates, state.templates);
    Storage.save(STORAGE_KEYS.shopping, state.shopping);
    Storage.save(STORAGE_KEYS.purchases, state.purchases);

    pendingImportPayload = null;
    hideUploadingOverlay();
    hideModal('importPreviewModal');
    renderAll();
    renderDataTab();
    showToast('🔀 マージが完了しました');
  } catch (err) {
    hideUploadingOverlay();
    console.error(err);
    showToast('マージに失敗しました: ' + (err.message || ''));
  }
}

function countPlanSlots(weekPlan) {
  let n = 0;
  Object.values(weekPlan || {}).forEach(week => {
    Object.values(week || {}).forEach(day => {
      if (Array.isArray(day)) n += day.length;
    });
  });
  return n;
}

// 自動バックアップを取得
async function takeAutoBackup() {
  const photos = await PhotoDB.getAll();
  await BackupDB.save({
    savedAt: new Date().toISOString(),
    recipes: state.recipes,
    weekPlan: state.weekPlan,
    history: state.history,
    templates: state.templates,
    shopping: state.shopping,
    purchases: state.purchases,
    photos: photos.map(p => ({ id: p.id, blob: p.blob })),
    sampleDataVersion: Storage.load(STORAGE_KEYS.sampleDataVersion, 0)
  });
}

// インポート実行
async function executeImport() {
  if (!pendingImportPayload) return;
  if (!confirm('現在のデータが全て上書きされます。\n本当に取り込みますか？')) return;

  showUploadingOverlay('バックアップ取得中...');
  try {
    // 1. 自動バックアップ
    await takeAutoBackup();

    showUploadingOverlay('データを書き戻し中...');

    // 2. 既存写真クリア
    await PhotoDB.clear();

    // 3. 新写真投入
    const photos = pendingImportPayload.photos || {};
    for (const [id, dataURL] of Object.entries(photos)) {
      try {
        const blob = dataURLToBlob(dataURL);
        await PhotoDB.save(id, blob);
      } catch (e) {
        console.warn('photo restore skipped:', id, e);
      }
    }

    // 4. localStorageに書き戻し（旧v1ファイルには新項目がないため既定値で補完）
    state.recipes = pendingImportPayload.recipes;
    state.weekPlan = pendingImportPayload.weekPlan;
    state.history = pendingImportPayload.history;
    state.templates = Array.isArray(pendingImportPayload.templates) ? pendingImportPayload.templates : [];
    state.shopping = pendingImportPayload.shopping && typeof pendingImportPayload.shopping === 'object' ? pendingImportPayload.shopping : {};
    state.purchases = Array.isArray(pendingImportPayload.purchases) ? pendingImportPayload.purchases : [];
    Storage.save(STORAGE_KEYS.recipes, state.recipes);
    Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
    Storage.save(STORAGE_KEYS.history, state.history);
    Storage.save(STORAGE_KEYS.templates, state.templates);
    Storage.save(STORAGE_KEYS.shopping, state.shopping);
    Storage.save(STORAGE_KEYS.purchases, state.purchases);
    if (pendingImportPayload.sampleDataVersion) {
      Storage.save(STORAGE_KEYS.sampleDataVersion, pendingImportPayload.sampleDataVersion);
    }
    Storage.save(STORAGE_KEYS.schemaVersion, 2);

    pendingImportPayload = null;
    hideUploadingOverlay();
    hideModal('importPreviewModal');
    renderAll();
    renderDataTab();
    showToast('取り込みが完了しました');
  } catch (err) {
    hideUploadingOverlay();
    console.error(err);
    showToast('取り込みに失敗しました: ' + (err.message || ''));
  }
}

// バックアップから復元
async function restoreFromBackup() {
  const backup = await BackupDB.get();
  if (!backup) { showToast('バックアップがありません'); return; }

  const savedAt = new Date(backup.savedAt);
  const savedAtStr = `${savedAt.getFullYear()}/${savedAt.getMonth() + 1}/${savedAt.getDate()} ${String(savedAt.getHours()).padStart(2, '0')}:${String(savedAt.getMinutes()).padStart(2, '0')}`;
  if (!confirm(`${savedAtStr} 時点の状態に復元します。\n現在のデータは失われます。よろしいですか？`)) return;
  if (!confirm('本当に復元しますか？（この操作は取り消せません）')) return;

  showUploadingOverlay('復元中...');
  try {
    await PhotoDB.clear();
    for (const p of (backup.photos || [])) {
      if (p && p.id && p.blob) {
        await PhotoDB.save(p.id, p.blob);
      }
    }
    state.recipes = backup.recipes;
    state.weekPlan = backup.weekPlan;
    state.history = backup.history;
    state.templates = Array.isArray(backup.templates) ? backup.templates : [];
    state.shopping = backup.shopping && typeof backup.shopping === 'object' ? backup.shopping : {};
    state.purchases = Array.isArray(backup.purchases) ? backup.purchases : [];
    Storage.save(STORAGE_KEYS.recipes, state.recipes);
    Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
    Storage.save(STORAGE_KEYS.history, state.history);
    Storage.save(STORAGE_KEYS.templates, state.templates);
    Storage.save(STORAGE_KEYS.shopping, state.shopping);
    Storage.save(STORAGE_KEYS.purchases, state.purchases);
    if (backup.sampleDataVersion != null) {
      Storage.save(STORAGE_KEYS.sampleDataVersion, backup.sampleDataVersion);
    }

    hideUploadingOverlay();
    renderAll();
    renderDataTab();
    showToast('復元しました');
  } catch (err) {
    hideUploadingOverlay();
    console.error(err);
    showToast('復元に失敗しました: ' + (err.message || ''));
  }
}

// データタブ描画
async function renderDataTab() {
  document.getElementById('statRecipeCount').textContent = `${state.recipes.length}件`;
  document.getElementById('statPlanCount').textContent = `${countPlanSlots(state.weekPlan)}件`;
  document.getElementById('statHistoryCount').textContent = `${state.history.length}件`;

  try {
    const photos = await PhotoDB.getAll();
    let totalPhotoBytes = 0;
    photos.forEach(p => { if (p && p.blob) totalPhotoBytes += p.blob.size; });
    document.getElementById('statPhotoCount').textContent = `${photos.length}枚（${formatBytes(totalPhotoBytes)}）`;

    // 端末内の実データ量：localStorage (概算) + 写真
    const lsBytes =
      JSON.stringify(state.recipes).length +
      JSON.stringify(state.weekPlan).length +
      JSON.stringify(state.history).length;
    document.getElementById('statTotalSize').textContent = formatBytes(lsBytes + totalPhotoBytes);

    // 書き出し時の推定サイズ（Base64オーバーヘッド込み）でステータス判定
    const estBytes = lsBytes + Math.round(totalPhotoBytes * BASE64_OVERHEAD);
    const badge = document.getElementById('exportSizeBadge');
    if (badge) {
      if (estBytes >= SIZE_DANGER) {
        badge.className = 'size-badge danger';
        badge.textContent = `🔴 書き出し推定 ${formatBytes(estBytes)}・転送に失敗する可能性があります`;
      } else if (estBytes >= SIZE_CAUTION) {
        badge.className = 'size-badge caution';
        badge.textContent = `🟡 書き出し推定 ${formatBytes(estBytes)}・やや大きめです`;
      } else {
        badge.className = 'size-badge safe';
        badge.textContent = `✅ 書き出し推定 ${formatBytes(estBytes)}・安全な容量です`;
      }
    }
  } catch (e) {
    document.getElementById('statPhotoCount').textContent = '取得失敗';
    document.getElementById('statTotalSize').textContent = '-';
  }

  // バックアップ情報
  try {
    const backup = await BackupDB.get();
    const restoreBtn = document.getElementById('restoreBackupBtn');
    const infoEl = document.getElementById('backupInfoText');
    if (backup && backup.savedAt) {
      const d = new Date(backup.savedAt);
      const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      infoEl.textContent = `${dateStr} に取得したバックアップに戻します（写真${(backup.photos || []).length}枚 / 履歴${(backup.history || []).length}件）`;
      restoreBtn.disabled = false;
      restoreBtn.style.opacity = '1';
    } else {
      infoEl.textContent = 'バックアップはまだありません';
      restoreBtn.disabled = true;
      restoreBtn.style.opacity = '0.5';
    }
  } catch (e) {}
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function bindDataHandlers() {
  document.getElementById('exportDataBtn').addEventListener('click', exportData);
  document.getElementById('importDataBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });
  document.getElementById('importFileInput').addEventListener('change', handleImportFileSelected);
  document.getElementById('confirmImportBtn').addEventListener('click', executeImport);
  document.getElementById('confirmMergeBtn').addEventListener('click', executeMergeImport);
  document.getElementById('restoreBackupBtn').addEventListener('click', restoreFromBackup);
}

// ===================================================================
// 写真圧縮
// ===================================================================
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        // 長辺をPHOTO_MAX_DIMに合わせて縮小
        if (width > height && width > PHOTO_MAX_DIM) {
          height = Math.round(height * PHOTO_MAX_DIM / width);
          width = PHOTO_MAX_DIM;
        } else if (height >= width && height > PHOTO_MAX_DIM) {
          width = Math.round(width * PHOTO_MAX_DIM / height);
          height = PHOTO_MAX_DIM;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('画像の圧縮に失敗しました'));
        }, 'image/jpeg', PHOTO_QUALITY);
      };
      img.onerror = () => reject(new Error('画像を読み込めませんでした'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('ファイルを読み込めませんでした'));
    reader.readAsDataURL(file);
  });
}

// ===================================================================
// 初期化
// ===================================================================
function init() {
  loadAllData();
  state.currentWeekStart = getMondayOf(new Date());

  bindTabs();
  bindWeekNav();
  bindRecipeManagement();
  bindModals();
  bindCookModal();

  bindHistoryControls();
  bindPhotoHandlers();
  bindDataHandlers();
  bindShoppingHandlers();
  bindTemplateHandlers();
  bindRecordsHandlers();
  bindStatsHandlers();
  bindWeekSwipe();
  bindInstallBanner();
  bindSuggestHandlers();

  state.recordsMonth = firstOfMonth(new Date());
  if (state.suggestWithSub === undefined) state.suggestWithSub = true;
  if (state.suggestWithSoup === undefined) state.suggestWithSoup = false;
  if (!state.suggestSeason) state.suggestSeason = 'auto';

  renderAll();
  registerServiceWorker();
  PhotoDB.open()
    .then(() => { setTimeout(() => cleanupOrphanPhotos(), 4000); })
    .catch(err => console.warn('IndexedDB open failed:', err));

  if (state._sampleUpdated) {
    showToast('サンプルレシピを最新版に更新しました');
    state._sampleUpdated = false;
  }
  if (state._schemaMigrated) {
    setTimeout(() => showToast('1日に複数料理を設定できるようになりました'), 1500);
    state._schemaMigrated = false;
  }
}

function loadAllData() {
  const currentSampleVersion = window.SAMPLE_DATA_VERSION || 1;
  const savedSampleVersion = Storage.load(STORAGE_KEYS.sampleDataVersion, 0);
  const savedRecipes = Storage.load(STORAGE_KEYS.recipes, null);

  if (savedRecipes === null) {
    // 初回起動：サンプル全投入
    state.recipes = [...(window.SAMPLE_RECIPES || [])];
    Storage.save(STORAGE_KEYS.recipes, state.recipes);
    Storage.save(STORAGE_KEYS.sampleDataVersion, currentSampleVersion);
  } else if (savedSampleVersion < currentSampleVersion) {
    // バージョンアップ時：サンプルのみ入れ替え、ユーザー追加分（'u'始まりID）は保護
    const userRecipes = savedRecipes.filter(r => typeof r.id === 'string' && r.id.startsWith('u'));
    state.recipes = [...(window.SAMPLE_RECIPES || []), ...userRecipes];
    Storage.save(STORAGE_KEYS.recipes, state.recipes);
    Storage.save(STORAGE_KEYS.sampleDataVersion, currentSampleVersion);
    // 通知は後でinitの最後に
    state._sampleUpdated = true;
  } else {
    state.recipes = savedRecipes;
  }
  state.weekPlan = Storage.load(STORAGE_KEYS.weekPlan, {});
  state.history = Storage.load(STORAGE_KEYS.history, []);
  state.templates = Storage.load(STORAGE_KEYS.templates, []);
  state.shopping = Storage.load(STORAGE_KEYS.shopping, {});
  state.purchases = Storage.load(STORAGE_KEYS.purchases, []);

  // スキーマv1 → v2 マイグレーション（1日1レシピ → 1日複数レシピ）
  const savedSchemaVersion = Storage.load(STORAGE_KEYS.schemaVersion, 1);
  if (savedSchemaVersion < 2) {
    migrateWeekPlanToV2();
    migrateHistoryToV2();
    Storage.save(STORAGE_KEYS.schemaVersion, 2);
    Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
    Storage.save(STORAGE_KEYS.history, state.history);
    state._schemaMigrated = true;
  }
}

// 旧: weekPlan[weekKey][dayKey] = { recipeId, ... }
// 新: weekPlan[weekKey][dayKey] = [{ slotId, recipeId, ... }]
function migrateWeekPlanToV2() {
  Object.keys(state.weekPlan).forEach(weekKey => {
    const week = state.weekPlan[weekKey];
    Object.keys(week).forEach(dayKey => {
      const entry = week[dayKey];
      if (!Array.isArray(entry) && entry && typeof entry === 'object' && entry.recipeId) {
        // 旧形式を配列化
        week[dayKey] = [{
          slotId: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          recipeId: entry.recipeId,
          checked: entry.checked || [],
          completed: !!entry.completed,
          completedAt: entry.completedAt || null
        }];
      } else if (!Array.isArray(entry)) {
        delete week[dayKey];
      }
    });
  });
}

function migrateHistoryToV2() {
  // 既存履歴に historyId と photoId 追加
  state.history = state.history.map(h => ({
    historyId: h.historyId || ('h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 4)),
    recipeId: h.recipeId,
    recipeName: h.recipeName,
    category: h.category,
    completedAt: h.completedAt,
    photoId: h.photoId || null
  }));
}

// 材料表示用ヘルパー：オブジェクト形式 / 文字列形式の両方に対応
function getIngredientName(ing) {
  if (ing == null) return '';
  if (typeof ing === 'string') return ing;
  if (typeof ing === 'object') return ing.name || '';
  return String(ing);
}
function getIngredientAmount(ing) {
  if (ing && typeof ing === 'object' && ing.amount) return ing.amount;
  return '';
}
function getIngredientLabel(ing) {
  const name = getIngredientName(ing);
  const amount = getIngredientAmount(ing);
  return amount ? `${name}  ${amount}` : name;
}
// カタカナ→ひらがな変換＋小文字化（「からあげ」で「唐揚げ（カラアゲ表記）」等を検索可能に）
function normalizeKana(s) {
  return String(s || '').toLowerCase().replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
function matchesQuery(text, normalizedQuery) {
  return normalizeKana(text).includes(normalizedQuery);
}
function searchIngredient(ing, query) {
  const nq = normalizeKana(query);
  return matchesQuery(getIngredientName(ing), nq) ||
         matchesQuery(getIngredientAmount(ing), nq);
}

// ===================================================================
// 日付ユーティリティ
// ===================================================================
function getMondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatJapaneseDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getWeekKey(monday) {
  // ISO週番号は複雑なので、月曜日の日付をキーとして使う
  return `W-${formatDate(monday)}`;
}

function isSameDate(a, b) {
  return formatDate(a) === formatDate(b);
}

// ===================================================================
// タブ切り替え
// ===================================================================
function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'week') renderWeek();
  else if (tab === 'recipes') renderRecipeList();
  else if (tab === 'history') renderHistory();
  else if (tab === 'data') renderDataTab();
  else if (tab === 'records') renderRecords();
  else if (tab === 'stats') renderStats();
}

// ===================================================================
// 週ナビゲーション
// ===================================================================
function bindWeekNav() {
  document.getElementById('prevWeek').addEventListener('click', () => {
    state.currentWeekStart = addDays(state.currentWeekStart, -7);
    renderWeek();
  });
  document.getElementById('nextWeek').addEventListener('click', () => {
    state.currentWeekStart = addDays(state.currentWeekStart, 7);
    renderWeek();
  });
  document.getElementById('todayBtn').addEventListener('click', () => {
    state.currentWeekStart = getMondayOf(new Date());
    renderWeek();
  });
  document.getElementById('clearWeekBtn').addEventListener('click', clearCurrentWeek);
}

// 表示中の週の献立を一括削除（履歴・写真は残す）
function clearCurrentWeek() {
  const wk = currentWeekKey();
  const week = state.weekPlan[wk] || {};
  let total = 0, completed = 0;
  DAY_ORDER.forEach(d => {
    const slots = Array.isArray(week[d]) ? week[d] : [];
    total += slots.length;
    completed += slots.filter(s => s.completed).length;
  });
  if (total === 0) {
    showToast('この週に献立はありません');
    return;
  }
  const monday = state.currentWeekStart;
  const sunday = addDays(monday, 6);
  const msg =
    `${formatJapaneseDate(monday)}（月）〜${formatJapaneseDate(sunday)}（日）の献立 ${total}品をすべて削除しますか？\n\n` +
    (completed > 0 ? `・完了済み ${completed}品の履歴・写真は残ります\n` : '') +
    `・この週の買い物リストのチェック状態もリセットされます`;
  if (!confirm(msg)) return;
  delete state.weekPlan[wk];
  delete state.shopping[wk];
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
  Storage.save(STORAGE_KEYS.shopping, state.shopping);
  renderWeek();
  showToast('この週の献立を削除しました');
}

// 献立タブの左右スワイプで週移動
function bindWeekSwipe() {
  const area = document.getElementById('tab-week');
  let sx = 0, sy = 0, tracking = false;
  area.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  area.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    // 横方向が明確に優勢なときだけ週移動（縦スクロールを邪魔しない）
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      state.currentWeekStart = addDays(state.currentWeekStart, dx < 0 ? 7 : -7);
      renderWeek();
    }
  }, { passive: true });
}

// ホーム画面追加の案内バナー（iOS Safariのブラウザ表示時のみ）
function bindInstallBanner() {
  const banner = document.getElementById('installBanner');
  const closeBtn = document.getElementById('installBannerClose');
  if (!banner || !closeBtn) return;
  closeBtn.addEventListener('click', () => {
    banner.classList.add('hidden');
    try { localStorage.setItem('wr_install_banner_dismissed', '1'); } catch (e) {}
  });
  try {
    const dismissed = localStorage.getItem('wr_install_banner_dismissed');
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (isIOS && !standalone && !dismissed) banner.classList.remove('hidden');
  } catch (e) {}
}

// ===================================================================
// 週カレンダー描画
// ===================================================================
function renderWeek() {
  const monday = state.currentWeekStart;
  const sunday = addDays(monday, 6);
  document.getElementById('weekLabel').textContent =
    `${formatJapaneseDate(monday)}（月）〜 ${formatJapaneseDate(sunday)}（日）`;

  // 現在週以外を表示中は「今日の週に戻る」を出す
  const todayBtn = document.getElementById('todayBtn');
  if (todayBtn) {
    todayBtn.classList.toggle('hidden', formatDate(monday) === formatDate(getMondayOf(new Date())));
  }

  const container = document.getElementById('weekContainer');
  container.innerHTML = '';

  const weekKey = getWeekKey(monday);
  const planForWeek = state.weekPlan[weekKey] || {};
  const today = new Date();

  const dayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  dayOrder.forEach((dayKey, idx) => {
    const date = addDays(monday, idx);
    const dayJp = ['月', '火', '水', '木', '金', '土', '日'][idx];
    const slots = Array.isArray(planForWeek[dayKey]) ? planForWeek[dayKey] : [];
    const card = document.createElement('div');
    card.className = 'day-card multi';
    if (dayKey === 'sat') card.classList.add('saturday');
    if (dayKey === 'sun') card.classList.add('sunday');
    if (isSameDate(date, today)) card.classList.add('today');
    if (slots.length > 0 && slots.every(s => s.completed)) card.classList.add('completed');

    // 上部：曜日表記と「＋追加」ボタン
    const headerRow = document.createElement('div');
    headerRow.className = 'day-header-row';
    headerRow.innerHTML = `
      <div class="day-label">
        <span class="day-name">${dayJp}</span>
        <span class="day-date">${date.getDate()}</span>
      </div>
      <div class="day-recipe ${slots.length === 0 ? 'empty' : ''}" style="flex:1;">
        ${slots.length === 0 ? 'タップして料理を追加' : `${slots.length}品の予定`}
      </div>
      <button class="day-action add-slot-btn" type="button">＋追加</button>
    `;
    headerRow.querySelector('.add-slot-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openSelectRecipeModal(weekKey, dayKey);
    });
    // 空のときヘッダー自体タップでも追加できる
    if (slots.length === 0) {
      headerRow.addEventListener('click', () => openSelectRecipeModal(weekKey, dayKey));
    }
    card.appendChild(headerRow);

    // 各スロット
    if (slots.length > 0) {
      const stack = document.createElement('div');
      stack.className = 'day-recipes-stack';
      const purchaseSat = weekPurchaseSaturday(monday);
      slots.forEach(slot => {
        const recipe = state.recipes.find(r => r.id === slot.recipeId);
        const recipeName = recipe ? recipe.name : '（削除されたレシピ）';
        const metaText = slot.completed ? '✓ 完了' : '未調理';
        // 役割バッジ
        let roleHtml = '';
        if (recipe) {
          const role = dishRole(recipe);
          roleHtml = `<span class="role-badge role-${role}">${ROLE_LABEL[role] || '主菜'}</span>`;
        }
        // 使用期限（購入した土曜基準）
        let shelfHtml = '';
        if (recipe) {
          const u = dishUrgency(recipe);
          const dl = dishDeadlineDate(recipe, purchaseSat);
          if (dl) {
            shelfHtml = `<div class="slot-shelf ${shelfClassOf(u.days)}">🧊 ${formatMdDow(dl)}まで</div>`;
          }
        }
        const slotEl = document.createElement('div');
        slotEl.className = 'recipe-slot' + (slot.completed ? ' completed' : '');
        slotEl.innerHTML = `
          <div class="recipe-slot-body">
            <div class="recipe-slot-name">${roleHtml}${escapeHtml(recipeName)}</div>
            ${shelfHtml}
          </div>
          <div class="recipe-slot-meta">${escapeHtml(metaText)}</div>
        `;
        slotEl.addEventListener('click', () => openCookModal(weekKey, dayKey, slot.slotId));
        stack.appendChild(slotEl);
      });
      card.appendChild(stack);
    }

    container.appendChild(card);
  });
}

// ===================================================================
// レシピ選択モーダル
// ===================================================================
function openSelectRecipeModal(weekKey, dayKey) {
  state.selectModalTargetDay = { weekKey, dayKey };
  state.selectRoleFilter = state.selectRoleFilter || 'all';
  document.getElementById('selectSearch').value = '';
  document.querySelectorAll('.srole-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.role === state.selectRoleFilter));
  renderSelectSuggestions();
  renderSelectRecipeList('');
  showModal('selectRecipeModal');
}

// 「しばらく作っていない・高評価」のおすすめチップ
function renderSelectSuggestions() {
  const container = document.getElementById('selectSuggestions');
  if (!container) return;
  container.innerHTML = '';
  if (state.recipes.length === 0) return;

  const lastCookedMap = buildLastCookedMap();
  const top = state.recipes
    .filter(r => !r.excludeFromSuggest)
    .sort((a, b) => suggestionScore(b, lastCookedMap) - suggestionScore(a, lastCookedMap))
    .slice(0, 6);
  if (top.length === 0) return;

  const title = document.createElement('div');
  title.className = 'suggest-title';
  title.textContent = '💡 おすすめ（最近作っていない・高評価）';
  container.appendChild(title);

  const chips = document.createElement('div');
  chips.className = 'suggest-chips';
  top.forEach(r => {
    const label = lastCookedLabel(r.id, lastCookedMap);
    const chip = document.createElement('button');
    chip.className = 'suggest-chip';
    chip.type = 'button';
    const ratingStr = (r.rating || 0) > 0 ? '★'.repeat(r.rating) : '';
    chip.innerHTML = `${escapeHtml(r.name)}<span class="chip-meta">${ratingStr}${label.never ? ' 未調理' : ''}</span>`;
    chip.addEventListener('click', () => assignRecipeToDay(r.id));
    chips.appendChild(chip);
  });
  container.appendChild(chips);
}

function renderSelectRecipeList(query) {
  const list = document.getElementById('selectRecipeList');
  list.innerHTML = '';
  const q = (query || '').trim();
  const nq = normalizeKana(q);
  const roleFilter = state.selectRoleFilter || 'all';
  // 検索中・ジャンル絞り込み中はおすすめを隠す
  const sug = document.getElementById('selectSuggestions');
  if (sug) sug.style.display = (q || roleFilter !== 'all') ? 'none' : '';
  const filtered = state.recipes
    .filter(r => roleFilter === 'all' || dishRole(r) === roleFilter)
    .filter(r => !q || matchesQuery(r.name, nq) || r.ingredients.some(i => searchIngredient(i, q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  if (filtered.length === 0) {
    list.innerHTML = '<div class="history-empty">該当するレシピがありません</div>';
    return;
  }

  filtered.forEach(r => {
    const role = dishRole(r);
    const card = document.createElement('div');
    card.className = 'recipe-card';
    card.innerHTML = `
      <div class="recipe-card-name">
        <span class="role-badge role-${role}">${ROLE_LABEL[role]}</span>
        <span class="recipe-card-cat">${escapeHtml(r.category)}</span>
        ${escapeHtml(r.name)}
      </div>
      <div class="recipe-card-meta">材料 ${r.ingredients.length}個</div>
    `;
    card.addEventListener('click', () => assignRecipeToDay(r.id));
    list.appendChild(card);
  });
}

function assignRecipeToDay(recipeId) {
  const target = state.selectModalTargetDay;
  if (!target) return;
  if (!state.weekPlan[target.weekKey]) state.weekPlan[target.weekKey] = {};
  if (!Array.isArray(state.weekPlan[target.weekKey][target.dayKey])) {
    state.weekPlan[target.weekKey][target.dayKey] = [];
  }
  state.weekPlan[target.weekKey][target.dayKey].push({
    slotId: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    recipeId,
    checked: [],
    completed: false,
    completedAt: null
  });
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
  hideModal('selectRecipeModal');
  renderWeek();
  showToast('献立に追加しました');
}

// スロットを取得するヘルパー
function getCurrentSlot() {
  if (!state.currentCookingWeekKey || !state.currentCookingDay) return null;
  const day = state.weekPlan[state.currentCookingWeekKey] && state.weekPlan[state.currentCookingWeekKey][state.currentCookingDay];
  if (!Array.isArray(day)) return null;
  return day.find(s => s.slotId === state.currentCookingSlotId) || null;
}

// ===================================================================
// 調理モーダル（材料チェック）
// ===================================================================
function bindCookModal() {
  document.getElementById('completeCookBtn').addEventListener('click', completeCooking);
  document.getElementById('removeFromWeekBtn').addEventListener('click', removeFromWeek);
}

function openCookModal(weekKey, dayKey, slotId) {
  state.currentCookingWeekKey = weekKey;
  state.currentCookingDay = dayKey;
  state.currentCookingSlotId = slotId;
  const slot = getCurrentSlot();
  if (!slot) {
    showToast('スロットが見つかりません');
    return;
  }
  const recipe = state.recipes.find(r => r.id === slot.recipeId);
  if (!recipe) {
    showToast('レシピが見つかりません');
    return;
  }
  document.getElementById('cookRecipeName').textContent = recipe.name;
  renderCookIngredients(recipe, slot);
  showModal('cookModal');
}

function renderCookIngredients(recipe, slot) {
  const ul = document.getElementById('cookIngredients');
  ul.innerHTML = '';
  const servingsLabel = recipe.servings ? `（${recipe.servings}人前）` : '';
  document.getElementById('cookRecipeName').textContent = recipe.name + servingsLabel;

  // ステータス表示
  const statusEl = document.getElementById('cookStatusText');
  if (slot.completed) {
    statusEl.textContent = `✓ 完了済み（${formatCompletedAt(slot.completedAt)}）`;
    statusEl.classList.add('completed');
  } else {
    statusEl.textContent = '材料を確認して、調理後に「料理完了」を押してください';
    statusEl.classList.remove('completed');
  }

  // 評価スター（このレシピに対して即時保存）
  const cookStarsEl = document.getElementById('cookStars');
  const onSetCookRating = (v) => {
    recipe.rating = v;
    recipe.updatedAt = new Date().toISOString();
    Storage.save(STORAGE_KEYS.recipes, state.recipes);
    renderStars(cookStarsEl, v, onSetCookRating);
    showToast(v > 0 ? `評価を★${v}にしました` : '評価をクリアしました');
  };
  renderStars(cookStarsEl, recipe.rating || 0, onSetCookRating);

  // メモ・参考URL
  const noteWrap = document.getElementById('cookNoteWrap');
  const noteEl = document.getElementById('cookNote');
  if (recipe.note) {
    noteEl.textContent = recipe.note;
    noteWrap.classList.remove('hidden');
  } else {
    noteWrap.classList.add('hidden');
  }
  const urlLink = document.getElementById('cookUrlLink');
  if (recipe.url && /^https?:\/\//i.test(recipe.url)) {
    urlLink.href = recipe.url;
    urlLink.classList.remove('hidden');
  } else {
    urlLink.classList.add('hidden');
  }

  // 料理全体の使用期限サマリー（この料理の週の土曜購入基準）
  const summaryEl = document.getElementById('cookShelfSummary');
  const urg = dishUrgency(recipe);
  if (urg.days >= SHELF_DEFAULT) {
    summaryEl.className = 'cook-shelf-summary keep';
    summaryEl.textContent = '🧊 日持ちする食材が中心です（早めに使う必要のある生鮮はありません）';
  } else {
    const monday = state.currentCookingWeekKey ? mondayFromWeekKey(state.currentCookingWeekKey) : getMondayOf(new Date());
    const dl = addDays(weekPurchaseSaturday(monday), urg.days);
    summaryEl.className = 'cook-shelf-summary ' + shelfClassOf(urg.days);
    summaryEl.textContent = `🧊 この料理の使用期限：最短の食材「${urg.ingName}」で約${urg.days}日 → ${formatMdDow(dl)}頃まで（土曜まとめ買い基準）`;
  }

  // 材料リスト（チェックなし、表示専用・材料ごとの日持ち付き）
  recipe.ingredients.forEach(ing => {
    const ingName = getIngredientName(ing);
    const amount = getIngredientAmount(ing);
    const days = ingredientShelfDays(ingName);
    let shelfChip = '';
    if (days < SHELF_DEFAULT) {
      shelfChip = `<div class="ing-shelf ${shelfClassOf(days)}">🧊約${days}日</div>`;
    }
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="ing-bullet"></div>
      <div class="ing-name">${escapeHtml(ingName)}</div>
      ${amount ? `<div class="ing-amount">${escapeHtml(amount)}</div>` : ''}
      ${shelfChip}
    `;
    ul.appendChild(li);
  });

  // 完了ボタン制御
  const btn = document.getElementById('completeCookBtn');
  btn.disabled = !!slot.completed;
  btn.textContent = slot.completed ? '完了済み' : '✓ 料理完了（履歴に追加）';
}

function formatCompletedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function completeCooking() {
  const slot = getCurrentSlot();
  if (!slot) return;
  const recipe = state.recipes.find(r => r.id === slot.recipeId);
  if (!recipe) return;
  if (slot.completed) return;

  slot.completed = true;
  slot.completedAt = new Date().toISOString();
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);

  // 履歴に追加（historyId・photoIdを含む）
  state.history.unshift({
    historyId: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    recipeId: recipe.id,
    recipeName: recipe.name,
    category: recipe.category,
    completedAt: slot.completedAt,
    photoId: null
  });
  // 履歴は最新500件まで保持（写真メタデータのみ）
  if (state.history.length > 500) {
    const removed = state.history.splice(500);
    // 削除分の写真もIndexedDBから消す
    removed.forEach(h => {
      if (h.photoId) PhotoDB.delete(h.photoId).catch(() => {});
    });
  }
  Storage.save(STORAGE_KEYS.history, state.history);

  hideModal('cookModal');
  renderWeek();
  showToast(`🎉 ${recipe.name}を完了しました`);
}

function removeFromWeek() {
  if (!confirm('この料理を削除しますか？\n（履歴は残ります）')) return;
  const day = state.weekPlan[state.currentCookingWeekKey][state.currentCookingDay];
  if (Array.isArray(day)) {
    const idx = day.findIndex(s => s.slotId === state.currentCookingSlotId);
    if (idx >= 0) day.splice(idx, 1);
    if (day.length === 0) delete state.weekPlan[state.currentCookingWeekKey][state.currentCookingDay];
  }
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
  hideModal('cookModal');
  renderWeek();
  showToast('削除しました');
}

// ===================================================================
// レシピ管理
// ===================================================================
function bindRecipeManagement() {
  document.getElementById('recipeSearch').addEventListener('input', () => renderRecipeList());
  document.getElementById('selectSearch').addEventListener('input', (e) => renderSelectRecipeList(e.target.value));
  document.querySelectorAll('.srole-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.srole-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectRoleFilter = btn.dataset.role;
      renderSelectRecipeList(document.getElementById('selectSearch').value);
    });
  });
  document.getElementById('addRecipeBtn').addEventListener('click', () => openEditRecipeModal(null));
  document.getElementById('saveRecipeBtn').addEventListener('click', saveRecipeFromForm);
  document.getElementById('editRole').addEventListener('change', updateEditRoleHint);
  document.getElementById('editName').addEventListener('input', updateEditRoleHint);
  document.getElementById('editCategory').addEventListener('change', updateEditRoleHint);
  document.getElementById('editIngredients').addEventListener('input', updateEditRoleHint);
  document.getElementById('deleteRecipeBtn').addEventListener('click', deleteCurrentRecipe);

  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentCategoryFilter = btn.dataset.cat;
      renderRecipeList();
    });
  });

  const sortToggle = document.getElementById('recipeSortToggle');
  if (sortToggle) {
    sortToggle.addEventListener('click', () => {
      state.recipeSortMode = state.recipeSortMode === 'name' ? 'suggest' : 'name';
      sortToggle.textContent = state.recipeSortMode === 'name'
        ? '並び替え：名前順'
        : '並び替え：おすすめ順（最近作ってない・高評価）';
      renderRecipeList();
    });
  }
}

function renderRecipeList() {
  const list = document.getElementById('recipeList');
  list.innerHTML = '';
  const query = document.getElementById('recipeSearch').value.trim();
  const nq = normalizeKana(query);
  const cat = state.currentCategoryFilter;
  const lastCookedMap = buildLastCookedMap();

  let filtered = state.recipes
    .filter(r => cat === 'all' || r.category === cat)
    .filter(r => !query || matchesQuery(r.name, nq) || matchesQuery(r.note || '', nq) || r.ingredients.some(i => searchIngredient(i, query)));

  if (state.recipeSortMode === 'suggest') {
    filtered = filtered.slice().sort((a, b) => suggestionScore(b, lastCookedMap) - suggestionScore(a, lastCookedMap));
  } else {
    filtered = filtered.slice().sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="history-empty">該当するレシピがありません</div>';
    return;
  }

  filtered.forEach(r => {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    const rating = r.rating || 0;
    const starsHtml = rating > 0
      ? `<span class="stars small readonly">${[1,2,3,4,5].map(n => `<span class="star ${n <= rating ? 'filled' : ''}">★</span>`).join('')}</span>`
      : '';
    const lastCookedHtml = lastCookedLabel(r.id, lastCookedMap);
    const role = dishRole(r);
    const exclBadge = r.excludeFromSuggest ? '<span class="excl-badge">提案対象外</span>' : '';
    card.innerHTML = `
      <div class="recipe-card-name">${escapeHtml(r.name)}</div>
      <div class="recipe-card-meta">
        <span class="role-badge role-${role}">${ROLE_LABEL[role]}</span>
        <span class="recipe-card-cat">${escapeHtml(r.category)}</span>
        材料 ${r.ingredients.length}個
      </div>
      <div class="recipe-card-rating">${starsHtml}<span class="recipe-card-lastcooked ${lastCookedHtml.never ? 'never' : ''}">${lastCookedHtml.text}</span>${exclBadge}</div>
    `;
    card.addEventListener('click', () => openEditRecipeModal(r.id));
    list.appendChild(card);
  });
}

// 各レシピの最終調理日時マップ（recipeId → ISO文字列）
function buildLastCookedMap() {
  const map = {};
  state.history.forEach(h => {
    if (!h.recipeId || !h.completedAt) return;
    if (!map[h.recipeId] || h.completedAt > map[h.recipeId]) {
      map[h.recipeId] = h.completedAt;
    }
  });
  return map;
}

// おすすめスコア：長く作っていないほど・高評価ほど高い
function suggestionScore(recipe, lastCookedMap) {
  const last = lastCookedMap[recipe.id];
  let daysSince;
  if (!last) {
    daysSince = 9999; // 未調理は最優先
  } else {
    daysSince = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  }
  const ratingBoost = (recipe.rating || 0) * 7; // 星1つにつき約1週間ぶん優先
  return daysSince + ratingBoost;
}

function lastCookedLabel(recipeId, lastCookedMap) {
  const last = lastCookedMap[recipeId];
  if (!last) return { text: 'まだ作っていません', never: true };
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  if (days <= 0) return { text: '今日作りました', never: false };
  if (days === 1) return { text: '昨日作りました', never: false };
  return { text: `最終調理：${days}日前`, never: false };
}

function openEditRecipeModal(recipeId) {
  state.currentEditingRecipeId = recipeId;
  const deleteBtn = document.getElementById('deleteRecipeBtn');
  if (recipeId) {
    const r = state.recipes.find(x => x.id === recipeId);
    if (!r) return;
    document.getElementById('editModalTitle').textContent = 'レシピ編集';
    document.getElementById('editName').value = r.name;
    document.getElementById('editCategory').value = r.category;
    document.getElementById('editServings').value = r.servings || 2;
    state.editingRating = r.rating || 0;
    // 「材料名,分量」形式で1行ずつ
    const lines = r.ingredients.map(ing => {
      const name = getIngredientName(ing);
      const amount = getIngredientAmount(ing);
      return amount ? `${name}, ${amount}` : name;
    });
    document.getElementById('editIngredients').value = lines.join('\n');
    document.getElementById('editNote').value = r.note || '';
    document.getElementById('editUrl').value = r.url || '';
    document.getElementById('editRole').value = r.role || 'auto';
    document.getElementById('editIncludeSuggest').checked = !r.excludeFromSuggest;
    deleteBtn.classList.remove('hidden');
  } else {
    document.getElementById('editModalTitle').textContent = '新規レシピ';
    document.getElementById('editName').value = '';
    document.getElementById('editCategory').value = '和食';
    document.getElementById('editServings').value = 2;
    document.getElementById('editIngredients').value = '';
    document.getElementById('editNote').value = '';
    document.getElementById('editUrl').value = '';
    document.getElementById('editRole').value = 'auto';
    document.getElementById('editIncludeSuggest').checked = true;
    state.editingRating = 0;
    deleteBtn.classList.add('hidden');
  }
  const editStarsEl = document.getElementById('editStars');
  const onSetEditRating = (v) => {
    state.editingRating = v;
    renderStars(editStarsEl, v, onSetEditRating);
  };
  renderStars(editStarsEl, state.editingRating, onSetEditRating);
  updateEditRoleHint();
  showModal('editRecipeModal');
}

// レシピ編集フォームの現在の入力から材料配列を作る
function parseIngredientsFromForm() {
  return document.getElementById('editIngredients').value.split('\n')
    .map(s => s.trim()).filter(Boolean)
    .map(line => {
      const i = line.search(/[,、]/);
      return i > 0 ? { name: line.slice(0, i).trim(), amount: line.slice(i + 1).trim() } : { name: line, amount: '' };
    });
}

// ジャンルが「自動判定」のとき、推定結果をヒント表示
function updateEditRoleHint() {
  const sel = document.getElementById('editRole').value;
  const hint = document.getElementById('editRoleHint');
  if (!hint) return;
  if (sel !== 'auto') { hint.textContent = ''; return; }
  const temp = {
    name: document.getElementById('editName').value.trim(),
    category: document.getElementById('editCategory').value,
    ingredients: parseIngredientsFromForm()
  };
  hint.textContent = `→ 自動判定：${ROLE_LABEL[autoDishRole(temp)] || '主菜'}`;
}

// 星評価を描画。onSet(value) を渡すとクリック可能
function renderStars(container, rating, onSet) {
  if (!container) return;
  container.innerHTML = '';
  container.classList.toggle('readonly', !onSet);
  for (let n = 1; n <= 5; n++) {
    const star = document.createElement('span');
    star.className = 'star' + (n <= rating ? ' filled' : '');
    star.textContent = '★';
    if (onSet) {
      star.addEventListener('click', () => {
        // 同じ星を再タップで0（解除）
        const newVal = (rating === n) ? 0 : n;
        onSet(newVal);
      });
    }
    container.appendChild(star);
  }
}

function saveRecipeFromForm() {
  const name = document.getElementById('editName').value.trim();
  const category = document.getElementById('editCategory').value;
  const servings = parseInt(document.getElementById('editServings').value, 10) || 2;
  const ingredientsRaw = document.getElementById('editIngredients').value;
  // 各行を "材料名, 分量" として解釈
  const ingredients = ingredientsRaw.split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(line => {
      const commaIdx = line.search(/[,、]/);
      if (commaIdx > 0) {
        return {
          name: line.slice(0, commaIdx).trim(),
          amount: line.slice(commaIdx + 1).trim()
        };
      }
      return { name: line, amount: '' };
    });

  if (!name) { showToast('料理名を入力してください'); return; }
  if (ingredients.length === 0) { showToast('材料を1つ以上入力してください'); return; }

  const rating = state.editingRating || 0;
  const note = document.getElementById('editNote').value.trim();
  const url = document.getElementById('editUrl').value.trim();
  const role = document.getElementById('editRole').value;  // 'auto' | 'main' | 'sub' | 'soup'
  const excludeFromSuggest = !document.getElementById('editIncludeSuggest').checked;
  const updatedAt = new Date().toISOString(); // マージ時の新旧判定用
  if (state.currentEditingRecipeId) {
    const r = state.recipes.find(x => x.id === state.currentEditingRecipeId);
    if (r) {
      r.name = name;
      r.category = category;
      r.servings = servings;
      r.ingredients = ingredients;
      r.rating = rating;
      r.note = note;
      r.url = url;
      r.role = role;
      r.excludeFromSuggest = excludeFromSuggest;
      r.updatedAt = updatedAt;
    }
  } else {
    state.recipes.push({
      id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, category, servings, ingredients, rating, note, url, role, excludeFromSuggest, updatedAt
    });
  }
  Storage.save(STORAGE_KEYS.recipes, state.recipes);
  hideModal('editRecipeModal');
  renderRecipeList();
  showToast('保存しました');
}

function deleteCurrentRecipe() {
  if (!state.currentEditingRecipeId) return;
  const r = state.recipes.find(x => x.id === state.currentEditingRecipeId);
  if (!r) return;
  if (!confirm(`「${r.name}」を削除しますか？\n（既に割り当てた献立や履歴は残ります）`)) return;
  state.recipes = state.recipes.filter(x => x.id !== state.currentEditingRecipeId);
  Storage.save(STORAGE_KEYS.recipes, state.recipes);
  hideModal('editRecipeModal');
  renderRecipeList();
  showToast('削除しました');
}

// ===================================================================
// 履歴描画 / 削除
// ===================================================================
function bindHistoryControls() {
  const clearAllBtn = document.getElementById('clearAllHistoryBtn');
  if (clearAllBtn) clearAllBtn.addEventListener('click', clearAllHistory);
}

function renderHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '';
  const clearAllBtn = document.getElementById('clearAllHistoryBtn');

  if (state.history.length === 0) {
    list.innerHTML = '<div class="history-empty">まだ完了した料理はありません</div>';
    if (clearAllBtn) clearAllBtn.classList.add('hidden');
    return;
  }
  if (clearAllBtn) clearAllBtn.classList.remove('hidden');

  state.history.forEach((h, idx) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-photo-slot" data-idx="${idx}"></div>
      <div class="history-info">
        <div class="history-name">${escapeHtml(h.recipeName)}</div>
        <div class="history-date">
          <span class="recipe-card-cat">${escapeHtml(h.category || '')}</span>
          ${formatCompletedAt(h.completedAt)}
        </div>
      </div>
      <button class="again-btn" aria-label="また作る" title="また作る">🔁</button>
      <button class="history-delete-btn" aria-label="この履歴を削除">✕</button>
    `;
    item.querySelector('.again-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openDayPicker(h.recipeId, h.recipeName);
    });
    item.querySelector('.history-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteHistoryItem(idx);
    });
    const photoSlot = item.querySelector('.history-photo-slot');
    renderHistoryPhotoSlot(photoSlot, h, idx);
    list.appendChild(item);
  });
}

async function renderHistoryPhotoSlot(slotEl, history, idx) {
  if (history.photoId) {
    try {
      const blob = await PhotoDB.get(history.photoId);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.className = 'history-photo';
        img.src = url;
        img.alt = history.recipeName;
        img.addEventListener('click', (e) => {
          e.stopPropagation();
          openPhotoView(idx);
        });
        // 古いobjectURLは解放（メモリリーク防止）
        img.addEventListener('load', () => {
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        });
        slotEl.appendChild(img);
        return;
      }
    } catch (e) {
      console.warn('photo load error', e);
    }
  }
  // 写真未登録 or 読み込み失敗
  const placeholder = document.createElement('div');
  placeholder.className = 'history-photo-placeholder';
  placeholder.textContent = '📷';
  placeholder.title = '写真を追加';
  placeholder.addEventListener('click', (e) => {
    e.stopPropagation();
    openPhotoSourceModal(idx);
  });
  slotEl.appendChild(placeholder);
}

function deleteHistoryItem(idx) {
  const h = state.history[idx];
  if (!h) return;
  if (!confirm(`「${h.recipeName}」の履歴を削除しますか？${h.photoId ? '\n（写真も削除されます）' : ''}`)) return;
  // 写真も削除
  if (h.photoId) PhotoDB.delete(h.photoId).catch(() => {});
  state.history.splice(idx, 1);
  Storage.save(STORAGE_KEYS.history, state.history);
  renderHistory();
  showToast('削除しました');
}

function clearAllHistory() {
  if (state.history.length === 0) return;
  const photoCount = state.history.filter(h => h.photoId).length;
  const msg = photoCount > 0
    ? `履歴を全て削除します（${state.history.length}件、うち写真${photoCount}枚）。\nこの操作は取り消せません。よろしいですか？`
    : `履歴を全て削除します（${state.history.length}件）。\nこの操作は取り消せません。よろしいですか？`;
  if (!confirm(msg)) return;
  if (!confirm('本当に全履歴を削除しますか？')) return;
  // 写真もすべて削除
  state.history.forEach(h => {
    if (h.photoId) PhotoDB.delete(h.photoId).catch(() => {});
  });
  state.history = [];
  Storage.save(STORAGE_KEYS.history, state.history);
  renderHistory();
  showToast('全履歴を削除しました');
}

// ===================================================================
// 写真処理
// ===================================================================
function bindPhotoHandlers() {
  document.getElementById('photoFromCameraBtn').addEventListener('click', () => {
    document.getElementById('photoInputCamera').click();
  });
  document.getElementById('photoFromAlbumBtn').addEventListener('click', () => {
    document.getElementById('photoInputAlbum').click();
  });
  document.getElementById('photoInputCamera').addEventListener('change', handlePhotoSelected);
  document.getElementById('photoInputAlbum').addEventListener('change', handlePhotoSelected);
  document.getElementById('photoReplaceBtn').addEventListener('click', () => {
    hideModal('photoViewModal');
    openPhotoSourceModal(state.currentPhotoHistoryIdx);
  });
  document.getElementById('photoDeleteBtn').addEventListener('click', deleteCurrentPhoto);
}

function openPhotoSourceModal(target) {
  // target: 数値（履歴idx・後方互換） or {type:'history',idx} or {type:'receipt'}
  if (typeof target === 'number') target = { type: 'history', idx: target };
  state.photoTarget = target || { type: 'history', idx: null };
  state.currentPhotoHistoryIdx = (state.photoTarget.type === 'history') ? state.photoTarget.idx : null;
  showModal('photoSourceModal');
}

async function handlePhotoSelected(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const target = state.photoTarget || { type: 'history', idx: state.currentPhotoHistoryIdx };

  hideModal('photoSourceModal');
  showUploadingOverlay();

  try {
    if (!file.type.startsWith('image/')) {
      throw new Error('画像ファイルを選択してください');
    }
    const compressedBlob = await compressImage(file);

    if (target.type === 'receipt') {
      // レシート写真：IndexedDBに保存し、編集中フォームに紐付け
      // 直前に追加した一時写真（元写真ではない）があれば削除。元写真は保存時まで残す
      if (state.editingReceiptPhotoId && state.editingReceiptPhotoId !== state.editingPurchaseOrigPhotoId) {
        await PhotoDB.delete(state.editingReceiptPhotoId).catch(() => {});
      }
      const photoId = 'rp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await PhotoDB.save(photoId, compressedBlob);
      state.editingReceiptPhotoId = photoId;
      hideUploadingOverlay();
      await renderReceiptPreview();
      showToast(`レシート写真を追加しました（${Math.round(compressedBlob.size / 1024)}KB）`);
      return;
    }

    // 履歴写真
    if (target.idx == null) throw new Error('対象が不明です');
    const history = state.history[target.idx];
    if (!history) throw new Error('履歴が見つかりません');
    if (history.photoId) {
      await PhotoDB.delete(history.photoId).catch(() => {});
    }
    const photoId = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await PhotoDB.save(photoId, compressedBlob);
    history.photoId = photoId;
    Storage.save(STORAGE_KEYS.history, state.history);

    hideUploadingOverlay();
    renderHistory();
    showToast(`写真を保存しました（${Math.round(compressedBlob.size / 1024)}KB）`);
  } catch (err) {
    hideUploadingOverlay();
    console.error(err);
    showToast(err.message || '写真の保存に失敗しました');
  }
}

async function openPhotoView(historyIdx) {
  state.currentPhotoHistoryIdx = historyIdx;
  const h = state.history[historyIdx];
  if (!h || !h.photoId) return;
  try {
    const blob = await PhotoDB.get(h.photoId);
    if (!blob) { showToast('写真が見つかりませんでした'); return; }
    const url = URL.createObjectURL(blob);
    const img = document.getElementById('photoViewImg');
    img.src = url;
    document.getElementById('photoViewTitle').textContent = `${h.recipeName}（${formatCompletedAt(h.completedAt)}）`;
    showModal('photoViewModal');
    // モーダルを閉じたタイミングでobjectURLを解放
    const cleanup = () => {
      URL.revokeObjectURL(url);
      document.getElementById('photoViewModal').removeEventListener('transitionend', cleanup);
    };
    setTimeout(cleanup, 5000);
  } catch (e) {
    console.warn(e);
    showToast('写真を読み込めませんでした');
  }
}

async function deleteCurrentPhoto() {
  if (state.currentPhotoHistoryIdx == null) return;
  if (!confirm('この写真を削除しますか？')) return;
  const h = state.history[state.currentPhotoHistoryIdx];
  if (!h) return;
  if (h.photoId) {
    await PhotoDB.delete(h.photoId).catch(() => {});
    h.photoId = null;
    Storage.save(STORAGE_KEYS.history, state.history);
  }
  hideModal('photoViewModal');
  renderHistory();
  showToast('写真を削除しました');
}

function showUploadingOverlay(msg) {
  const text = msg || '写真を保存中...';
  let el = document.getElementById('uploadingOverlay');
  if (el) {
    const textEl = el.querySelector('.uploading-text');
    if (textEl) textEl.textContent = text;
    return;
  }
  el = document.createElement('div');
  el.id = 'uploadingOverlay';
  el.className = 'uploading-overlay';
  el.innerHTML = `<div class="uploading-spinner"><div class="spinner-dot"></div><div class="uploading-text">${escapeHtml(text)}</div></div>`;
  document.body.appendChild(el);
}

function hideUploadingOverlay() {
  const el = document.getElementById('uploadingOverlay');
  if (el) el.remove();
}

// ===================================================================
// モーダル共通
// ===================================================================
function bindModals() {
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => hideModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideModal(modal.id);
    });
  });
}

function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function hideModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.body.style.overflow = '';
}

// ===================================================================
// トースト
// ===================================================================
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

// ===================================================================
// ユーティリティ
// ===================================================================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAll() {
  renderWeek();
  renderRecipeList();
  renderHistory();
}

// ===================================================================
// Service Worker 登録
// ===================================================================
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(err => {
        console.warn('SW registration failed:', err);
      });
    });
  }
}

// ===================================================================
// 食材カテゴリ分類・常備品判定
// ===================================================================
function categorizeIngredient(name) {
  for (const rule of CATEGORY_RULES) {
    if (rule.kw.some(k => name.includes(k))) return rule.cat;
  }
  return 'その他';
}

const STAPLE_EXACT = ['水', '塩', '油', '酒', '酢'];
const STAPLE_INCLUDES = ['醤油', 'しょうゆ', '砂糖', 'みりん', 'こしょう', '胡椒', '塩こしょう',
  'サラダ油', 'ごま油', 'オリーブオイル', '味噌', 'みそ', 'だし', '出汁', '片栗粉', '小麦粉',
  '薄力粉', 'パン粉', 'マヨネーズ', 'ケチャップ', 'バター', 'にんにく', '生姜', 'しょうが',
  '揚げ油', 'コンソメ', '鶏がら', 'ガラスープ', '顆粒'];
function isStaple(name) {
  const n = (name || '').trim();
  if (STAPLE_EXACT.includes(n)) return true;
  return STAPLE_INCLUDES.some(k => n.includes(k));
}

// ===================================================================
// 買い物リスト
// ===================================================================
function bindShoppingHandlers() {
  document.getElementById('shoppingListBtn').addEventListener('click', openShoppingModal);
  document.getElementById('excludeStaplesToggle').addEventListener('change', (e) => {
    const st = getWeekShoppingState();
    st.excludeStaples = e.target.checked;
    saveShopping();
    renderShoppingList();
  });
  document.getElementById('excludeCompletedToggle').addEventListener('change', (e) => {
    const st = getWeekShoppingState();
    st.excludeCompleted = e.target.checked;
    saveShopping();
    renderShoppingList();
  });
  document.getElementById('shoppingAddBtn').addEventListener('click', addShoppingExtra);
  document.getElementById('shoppingAddInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addShoppingExtra();
  });
  document.getElementById('shoppingShareBtn').addEventListener('click', shareShoppingList);
}

function currentWeekKey() { return getWeekKey(state.currentWeekStart); }

function getWeekShoppingState() {
  const wk = currentWeekKey();
  if (!state.shopping[wk]) {
    state.shopping[wk] = { checked: {}, extras: [], excludeStaples: false, excludeCompleted: false };
  }
  const st = state.shopping[wk];
  if (!st.checked) st.checked = {};
  if (!st.extras) st.extras = [];
  return st;
}
function saveShopping() { Storage.save(STORAGE_KEYS.shopping, state.shopping); }

function aggregateWeekIngredients(excludeCompleted) {
  const week = state.weekPlan[currentWeekKey()] || {};
  const map = {};
  DAY_ORDER.forEach(dayKey => {
    const slots = Array.isArray(week[dayKey]) ? week[dayKey] : [];
    slots.forEach(slot => {
      if (excludeCompleted && slot.completed) return;
      const recipe = state.recipes.find(r => r.id === slot.recipeId);
      if (!recipe) return;
      recipe.ingredients.forEach(ing => {
        const name = getIngredientName(ing);
        if (!name) return;
        const amount = getIngredientAmount(ing);
        if (!map[name]) map[name] = { name, amounts: [], recipes: [] };
        if (amount) map[name].amounts.push(amount);
        if (!map[name].recipes.includes(recipe.name)) map[name].recipes.push(recipe.name);
      });
    });
  });
  return Object.values(map);
}

function openShoppingModal() {
  const st = getWeekShoppingState();
  document.getElementById('excludeStaplesToggle').checked = !!st.excludeStaples;
  document.getElementById('excludeCompletedToggle').checked = !!st.excludeCompleted;
  const monday = state.currentWeekStart;
  const sunday = addDays(monday, 6);
  document.getElementById('shoppingWeekLabel').textContent =
    `${formatJapaneseDate(monday)}（月）〜 ${formatJapaneseDate(sunday)}（日）の献立から集計`;
  renderShoppingList();
  showModal('shoppingModal');
}

function renderShoppingList() {
  const st = getWeekShoppingState();
  const container = document.getElementById('shoppingListContent');
  container.innerHTML = '';

  let items = aggregateWeekIngredients(st.excludeCompleted);
  if (st.excludeStaples) items = items.filter(it => !isStaple(it.name));

  // カテゴリ別グループ化
  const groups = {};
  items.forEach(it => {
    const cat = categorizeIngredient(it.name);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(it);
  });

  const catOrder = ['野菜・きのこ', '肉類', '魚介', '卵・乳・豆腐', '主食・麺・粉', '調味料・乾物', 'その他'];

  if (items.length === 0 && st.extras.length === 0) {
    container.innerHTML = '<div class="shopping-empty">この週にはまだ献立がありません。<br>「献立」タブで料理を追加すると、必要な食材がここに集計されます。</div>';
    return;
  }

  catOrder.forEach(cat => {
    const list = groups[cat];
    if (!list || list.length === 0) return;
    list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    const group = document.createElement('div');
    group.className = 'shopping-cat-group';
    const title = document.createElement('div');
    title.className = 'shopping-cat-title';
    title.textContent = cat;
    group.appendChild(title);

    list.forEach(it => {
      const checked = !!st.checked[it.name];
      const row = document.createElement('div');
      row.className = 'shopping-item' + (checked ? ' checked' : '');
      const amountStr = it.amounts.length > 0 ? it.amounts.join(' ＋ ') : '';
      const recipeNote = it.recipes.length > 1 ? `${it.recipes.length}品で使用` : (it.recipes[0] || '');
      row.innerHTML = `
        <div class="shop-check"></div>
        <div class="shop-name">${escapeHtml(it.name)}<div style="font-size:0.72rem;color:#aaa;">${escapeHtml(recipeNote)}</div></div>
        <div class="shop-amount">${escapeHtml(amountStr)}</div>
      `;
      row.addEventListener('click', () => toggleShoppingItem(it.name));
      group.appendChild(row);
    });
    container.appendChild(group);
  });

  // 手動追加品目
  if (st.extras.length > 0) {
    const group = document.createElement('div');
    group.className = 'shopping-cat-group';
    const title = document.createElement('div');
    title.className = 'shopping-cat-title';
    title.textContent = '手動で追加';
    group.appendChild(title);
    st.extras.forEach((ex, idx) => {
      const row = document.createElement('div');
      row.className = 'shopping-item' + (ex.checked ? ' checked' : '');
      row.innerHTML = `
        <div class="shop-check"></div>
        <div class="shop-name">${escapeHtml(ex.name)}</div>
        <button class="shop-extra-del" type="button">✕</button>
      `;
      row.querySelector('.shop-name').addEventListener('click', () => toggleExtra(idx));
      row.querySelector('.shop-check').addEventListener('click', () => toggleExtra(idx));
      row.querySelector('.shop-extra-del').addEventListener('click', (e) => {
        e.stopPropagation();
        removeExtra(idx);
      });
      group.appendChild(row);
    });
    container.appendChild(group);
  }
}

function toggleShoppingItem(name) {
  const st = getWeekShoppingState();
  st.checked[name] = !st.checked[name];
  saveShopping();
  renderShoppingList();
}

function addShoppingExtra() {
  const input = document.getElementById('shoppingAddInput');
  const name = input.value.trim();
  if (!name) return;
  const st = getWeekShoppingState();
  st.extras.push({ name, checked: false });
  input.value = '';
  saveShopping();
  renderShoppingList();
}
function toggleExtra(idx) {
  const st = getWeekShoppingState();
  if (st.extras[idx]) st.extras[idx].checked = !st.extras[idx].checked;
  saveShopping();
  renderShoppingList();
}
function removeExtra(idx) {
  const st = getWeekShoppingState();
  st.extras.splice(idx, 1);
  saveShopping();
  renderShoppingList();
}

async function shareShoppingList() {
  const st = getWeekShoppingState();
  let items = aggregateWeekIngredients(st.excludeCompleted);
  if (st.excludeStaples) items = items.filter(it => !isStaple(it.name));

  const monday = state.currentWeekStart;
  const sunday = addDays(monday, 6);
  let text = `🛒 買い物リスト（${formatJapaneseDate(monday)}〜${formatJapaneseDate(sunday)}）\n\n`;

  const groups = {};
  items.forEach(it => {
    const cat = categorizeIngredient(it.name);
    (groups[cat] = groups[cat] || []).push(it);
  });
  const catOrder = ['野菜・きのこ', '肉類', '魚介', '卵・乳・豆腐', '主食・麺・粉', '調味料・乾物', 'その他'];
  catOrder.forEach(cat => {
    if (!groups[cat]) return;
    text += `【${cat}】\n`;
    groups[cat].sort((a, b) => a.name.localeCompare(b.name, 'ja')).forEach(it => {
      const amt = it.amounts.length ? `（${it.amounts.join(' ＋ ')}）` : '';
      text += `□ ${it.name}${amt}\n`;
    });
    text += '\n';
  });
  if (st.extras.length) {
    text += `【その他】\n`;
    st.extras.forEach(ex => { text += `□ ${ex.name}\n`; });
  }

  try {
    if (navigator.share) {
      await navigator.share({ title: '買い物リスト', text });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  // フォールバック：クリップボードにコピー
  try {
    await navigator.clipboard.writeText(text);
    showToast('リストをコピーしました');
  } catch (e) {
    // 最終手段：別ウィンドウ表示
    showToast('共有に対応していません');
    console.log(text);
  }
}

// ===================================================================
// 献立テンプレート / 週コピー
// ===================================================================
function bindTemplateHandlers() {
  document.getElementById('templateBtn').addEventListener('click', openTemplateModal);
  document.getElementById('saveTemplateBtn').addEventListener('click', saveCurrentWeekAsTemplate);
  document.getElementById('copyLastWeekBtn').addEventListener('click', copyLastWeek);
}

function openTemplateModal() {
  document.getElementById('templateNameInput').value = '';
  renderTemplateList();
  showModal('templateModal');
}

function currentWeekHasSlots() {
  const week = state.weekPlan[currentWeekKey()] || {};
  return DAY_ORDER.some(d => Array.isArray(week[d]) && week[d].length > 0);
}

function buildSlotsFromRecipeIds(recipeIds) {
  return recipeIds
    .filter(rid => state.recipes.some(r => r.id === rid))
    .map(rid => ({
      slotId: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      recipeId: rid, checked: [], completed: false, completedAt: null
    }));
}

function saveCurrentWeekAsTemplate() {
  const name = document.getElementById('templateNameInput').value.trim();
  if (!name) { showToast('テンプレート名を入力してください'); return; }
  if (!currentWeekHasSlots()) { showToast('今週に献立がありません'); return; }
  const week = state.weekPlan[currentWeekKey()] || {};
  const plan = {};
  DAY_ORDER.forEach(d => {
    if (Array.isArray(week[d]) && week[d].length) {
      plan[d] = week[d].map(s => s.recipeId);
    }
  });
  state.templates.unshift({
    id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, createdAt: new Date().toISOString(), plan
  });
  Storage.save(STORAGE_KEYS.templates, state.templates);
  document.getElementById('templateNameInput').value = '';
  renderTemplateList();
  showToast('テンプレートを保存しました');
}

function renderTemplateList() {
  const list = document.getElementById('templateList');
  list.innerHTML = '';
  if (state.templates.length === 0) {
    list.innerHTML = '<div class="shopping-empty">保存済みテンプレートはありません</div>';
    return;
  }
  state.templates.forEach(t => {
    const count = Object.values(t.plan || {}).reduce((s, arr) => s + arr.length, 0);
    const item = document.createElement('div');
    item.className = 'template-item';
    item.innerHTML = `
      <div class="template-info">
        <div class="template-name">${escapeHtml(t.name)}</div>
        <div class="template-meta">${count}品 ・ ${Object.keys(t.plan || {}).length}日分</div>
      </div>
      <button class="template-apply-btn" type="button">今週に適用</button>
      <button class="template-del-btn" type="button">削除</button>
    `;
    item.querySelector('.template-apply-btn').addEventListener('click', () => applyTemplate(t.id));
    item.querySelector('.template-del-btn').addEventListener('click', () => deleteTemplate(t.id));
    list.appendChild(item);
  });
}

function applyTemplate(id) {
  const t = state.templates.find(x => x.id === id);
  if (!t) return;
  if (currentWeekHasSlots()) {
    if (!confirm('今週の献立を、このテンプレートで上書きします。よろしいですか？')) return;
  }
  const wk = currentWeekKey();
  state.weekPlan[wk] = {};
  Object.entries(t.plan || {}).forEach(([dayKey, recipeIds]) => {
    const slots = buildSlotsFromRecipeIds(recipeIds);
    if (slots.length) state.weekPlan[wk][dayKey] = slots;
  });
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
  hideModal('templateModal');
  renderWeek();
  showToast('テンプレートを適用しました');
}

function deleteTemplate(id) {
  const t = state.templates.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`テンプレート「${t.name}」を削除しますか？`)) return;
  state.templates = state.templates.filter(x => x.id !== id);
  Storage.save(STORAGE_KEYS.templates, state.templates);
  renderTemplateList();
  showToast('削除しました');
}

function copyLastWeek() {
  const prevKey = getWeekKey(addDays(state.currentWeekStart, -7));
  const prevWeek = state.weekPlan[prevKey];
  const hasPrev = prevWeek && DAY_ORDER.some(d => Array.isArray(prevWeek[d]) && prevWeek[d].length > 0);
  if (!hasPrev) { showToast('先週の献立がありません'); return; }
  if (currentWeekHasSlots()) {
    if (!confirm('今週の献立を、先週の内容で上書きします。よろしいですか？')) return;
  }
  const wk = currentWeekKey();
  state.weekPlan[wk] = {};
  DAY_ORDER.forEach(d => {
    if (Array.isArray(prevWeek[d]) && prevWeek[d].length) {
      state.weekPlan[wk][d] = buildSlotsFromRecipeIds(prevWeek[d].map(s => s.recipeId));
    }
  });
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
  renderWeek();
  showToast('先週の献立をコピーしました');
}

// ===================================================================
// 買い物・食費 記録
// ===================================================================
function firstOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function addMonths(date, n) { return new Date(date.getFullYear(), date.getMonth() + n, 1); }
function formatYen(n) { return '¥' + (Number(n) || 0).toLocaleString('ja-JP'); }
function formatMd(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function bindRecordsHandlers() {
  document.getElementById('addPurchaseBtn').addEventListener('click', () => openPurchaseModal(null));
  document.getElementById('prevMonth').addEventListener('click', () => {
    state.recordsMonth = addMonths(state.recordsMonth, -1);
    renderRecords();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    state.recordsMonth = addMonths(state.recordsMonth, 1);
    renderRecords();
  });
  document.getElementById('addItemRowBtn').addEventListener('click', () => {
    state.editingPurchaseItems.push({ name: '', qty: '', price: '' });
    renderPurchaseItems();
  });
  document.getElementById('parseReceiptBtn').addEventListener('click', parseReceiptText);
  document.getElementById('savePurchaseBtn').addEventListener('click', savePurchase);
  document.getElementById('deletePurchaseBtn').addEventListener('click', deletePurchase);
  document.getElementById('receiptPhotoBtn').addEventListener('click', () => openPhotoSourceModal({ type: 'receipt' }));
}

function renderRecords() {
  const m = state.recordsMonth || (state.recordsMonth = firstOfMonth(new Date()));
  document.getElementById('monthLabel').textContent = `${m.getFullYear()}年${m.getMonth() + 1}月`;

  const inMonth = state.purchases.filter(p => {
    const d = new Date(p.date);
    return !isNaN(d.getTime()) && d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth();
  });
  const total = inMonth.reduce((s, p) => s + (p.total || 0), 0);
  document.getElementById('monthTotal').textContent = formatYen(total);

  const byStore = {};
  inMonth.forEach(p => {
    const k = (p.store && p.store.trim()) || '(店名なし)';
    byStore[k] = (byStore[k] || 0) + (p.total || 0);
  });
  document.getElementById('monthStoreSummary').innerHTML =
    Object.entries(byStore).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([s, v]) => `<div class="store-summary-row"><span>${escapeHtml(s)}</span><span>${formatYen(v)}</span></div>`).join('');

  const list = document.getElementById('purchaseList');
  list.innerHTML = '';
  if (inMonth.length === 0) {
    list.innerHTML = '<div class="history-empty">この月の記録はありません</div>';
    return;
  }
  inMonth.sort((a, b) => (a.date < b.date ? 1 : -1));
  inMonth.forEach(p => {
    const card = document.createElement('div');
    card.className = 'purchase-card';
    card.innerHTML = `
      <div class="purchase-thumb-slot"></div>
      <div class="purchase-info">
        <div class="purchase-store">${escapeHtml((p.store && p.store.trim()) || '(店名なし)')}</div>
        <div class="purchase-sub">${formatMd(p.date)} ・ ${(p.items || []).length}品</div>
      </div>
      <div class="purchase-amount">${formatYen(p.total || 0)}</div>
    `;
    card.addEventListener('click', () => openPurchaseModal(p.id));
    renderPurchaseThumb(card.querySelector('.purchase-thumb-slot'), p);
    list.appendChild(card);
  });
}

async function renderPurchaseThumb(slotEl, purchase) {
  if (purchase.photoId) {
    try {
      const blob = await PhotoDB.get(purchase.photoId);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.className = 'purchase-thumb';
        img.src = url;
        img.addEventListener('load', () => setTimeout(() => URL.revokeObjectURL(url), 60000));
        slotEl.appendChild(img);
        return;
      }
    } catch (e) {}
  }
  const ph = document.createElement('div');
  ph.className = 'purchase-thumb-placeholder';
  ph.textContent = '🧾';
  slotEl.appendChild(ph);
}

function openPurchaseModal(id) {
  state.editingPurchaseId = id;
  const deleteBtn = document.getElementById('deletePurchaseBtn');
  document.getElementById('receiptPasteArea').value = '';

  if (id) {
    const p = state.purchases.find(x => x.id === id);
    if (!p) return;
    document.getElementById('purchaseModalTitle').textContent = '買い物の記録';
    document.getElementById('purchaseDate').value = p.date || formatDate(new Date());
    document.getElementById('purchaseStore').value = p.store || '';
    document.getElementById('purchaseNote').value = p.note || '';
    state.editingPurchaseItems = (p.items || []).map(it => ({ name: it.name || '', qty: it.qty || '', price: it.price || '' }));
    state.editingReceiptPhotoId = p.photoId || null;
    state.editingPurchaseOrigPhotoId = p.photoId || null;
    deleteBtn.classList.remove('hidden');
  } else {
    document.getElementById('purchaseModalTitle').textContent = '買い物の記録（新規）';
    document.getElementById('purchaseDate').value = formatDate(new Date());
    document.getElementById('purchaseStore').value = '';
    document.getElementById('purchaseNote').value = '';
    state.editingPurchaseItems = [{ name: '', qty: '', price: '' }];
    state.editingReceiptPhotoId = null;
    state.editingPurchaseOrigPhotoId = null;
    deleteBtn.classList.add('hidden');
  }
  renderPurchaseItems();
  updatePurchaseTotal();
  renderReceiptPreview();
  showModal('purchaseModal');
}

function renderPurchaseItems() {
  const container = document.getElementById('purchaseItems');
  container.innerHTML = '';
  state.editingPurchaseItems.forEach((it, idx) => {
    const row = document.createElement('div');
    row.className = 'purchase-item-row';
    row.innerHTML = `
      <input class="form-input pi-name" placeholder="品名" value="${escapeHtml(it.name)}">
      <input class="form-input pi-qty" placeholder="個" value="${escapeHtml(it.qty)}">
      <input class="form-input pi-price" type="number" inputmode="numeric" placeholder="円" value="${it.price !== '' ? escapeHtml(String(it.price)) : ''}">
      <button class="pi-remove" type="button">✕</button>
    `;
    row.querySelector('.pi-name').addEventListener('input', (e) => { state.editingPurchaseItems[idx].name = e.target.value; });
    row.querySelector('.pi-qty').addEventListener('input', (e) => { state.editingPurchaseItems[idx].qty = e.target.value; });
    row.querySelector('.pi-price').addEventListener('input', (e) => {
      state.editingPurchaseItems[idx].price = e.target.value;
      updatePurchaseTotal();
    });
    row.querySelector('.pi-remove').addEventListener('click', () => {
      state.editingPurchaseItems.splice(idx, 1);
      renderPurchaseItems();
      updatePurchaseTotal();
    });
    container.appendChild(row);
  });
}

function updatePurchaseTotal() {
  const total = state.editingPurchaseItems.reduce((s, it) => s + (parseInt(it.price, 10) || 0), 0);
  document.getElementById('purchaseTotalDisplay').textContent = formatYen(total);
}

// レシートのライブテキスト（貼り付け）を簡易解析
function parseReceiptText() {
  const text = document.getElementById('receiptPasteArea').value;
  if (!text.trim()) { showToast('レシートの文字を貼り付けてください'); return; }
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const skip = ['合計', '小計', '計', 'お預', '預り', 'お釣', '釣', 'つり', '現金', 'クレジット', 'カード',
    'ポイント', '税', '対象', '点数', 'レシート', '領収', 'TEL', '電話', '様', '支払', 'バランス', '残高', '値引', '割引', 'おつり'];
  const items = [];
  let detectedStore = '';
  let detectedDate = '';

  lines.forEach((line, i) => {
    const dm = line.match(/(20\d{2})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/);
    if (dm) {
      // 日付行は明細として扱わない
      if (!detectedDate) detectedDate = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
      return;
    }
    if (i < 3 && !detectedStore && !/\d{3,}/.test(line) && line.length >= 2 && line.length <= 25) {
      detectedStore = line;
    }
    if (skip.some(k => line.includes(k))) return;
    // 時刻のみの行（12:34 など）も除外
    if (/^\d{1,2}:\d{2}/.test(line)) return;
    const pm = line.match(/[¥\\￥]?\s*([0-9][0-9,]{0,6})\s*円?\s*[*※]?$/);
    if (pm) {
      const price = parseInt(pm[1].replace(/,/g, ''), 10);
      let name = line.slice(0, pm.index).replace(/[¥\\￥*※・\s]+$/, '').trim();
      let qty = '';
      const qm = name.match(/[x×]\s*(\d+)\s*$/);
      if (qm) { qty = qm[1]; name = name.slice(0, qm.index).trim(); }
      if (name && price > 0 && price < 100000) {
        items.push({ name, qty, price });
      }
    }
  });

  const storeEl = document.getElementById('purchaseStore');
  if (detectedStore && !storeEl.value) storeEl.value = detectedStore;
  if (detectedDate) document.getElementById('purchaseDate').value = detectedDate;

  if (items.length === 0) {
    showToast('明細を抽出できませんでした。手動で入力してください');
    return;
  }
  // 既存の空行を除去してから追加
  state.editingPurchaseItems = state.editingPurchaseItems.filter(it => it.name || it.price);
  state.editingPurchaseItems.push(...items);
  renderPurchaseItems();
  updatePurchaseTotal();
  showToast(`${items.length}件の明細を抽出しました（内容をご確認ください）`);
}

async function renderReceiptPreview() {
  const el = document.getElementById('receiptPhotoPreview');
  el.innerHTML = '';
  el.onclick = () => openPhotoSourceModal({ type: 'receipt' });
  if (state.editingReceiptPhotoId) {
    try {
      const blob = await PhotoDB.get(state.editingReceiptPhotoId);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.src = url;
        img.addEventListener('load', () => setTimeout(() => URL.revokeObjectURL(url), 60000));
        el.appendChild(img);
        el.onclick = () => openReceiptView(state.editingReceiptPhotoId);
        return;
      }
    } catch (e) {}
  }
  el.textContent = '🧾';
}

async function openReceiptView(photoId) {
  if (!photoId) return;
  try {
    const blob = await PhotoDB.get(photoId);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    document.getElementById('receiptViewImg').src = url;
    showModal('receiptViewModal');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {}
}

async function savePurchase() {
  const date = document.getElementById('purchaseDate').value || formatDate(new Date());
  const store = document.getElementById('purchaseStore').value.trim();
  const note = document.getElementById('purchaseNote').value.trim();
  const items = state.editingPurchaseItems
    .map(it => ({ name: (it.name || '').trim(), qty: (it.qty || '').trim(), price: parseInt(it.price, 10) || 0 }))
    .filter(it => it.name || it.price);
  const total = items.reduce((s, it) => s + (it.price || 0), 0);

  if (!store && items.length === 0 && !state.editingReceiptPhotoId) {
    showToast('店名・明細・レシート写真のいずれかを入力してください');
    return;
  }

  const photoId = state.editingReceiptPhotoId || null;

  if (state.editingPurchaseId) {
    const p = state.purchases.find(x => x.id === state.editingPurchaseId);
    if (p) {
      p.date = date; p.store = store; p.items = items; p.total = total; p.note = note; p.photoId = photoId;
    }
  } else {
    state.purchases.unshift({
      id: 'pur' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date, store, items, total, note, photoId
    });
  }

  // 差し替えで不要になった元写真を削除
  if (state.editingPurchaseOrigPhotoId && state.editingPurchaseOrigPhotoId !== photoId) {
    await PhotoDB.delete(state.editingPurchaseOrigPhotoId).catch(() => {});
  }

  Storage.save(STORAGE_KEYS.purchases, state.purchases);
  // 記録した月へ移動して表示
  const d = new Date(date);
  if (!isNaN(d.getTime())) state.recordsMonth = firstOfMonth(d);
  state.editingReceiptPhotoId = null;
  state.editingPurchaseOrigPhotoId = null;
  hideModal('purchaseModal');
  renderRecords();
  showToast('記録を保存しました');
}

async function deletePurchase() {
  if (!state.editingPurchaseId) return;
  const p = state.purchases.find(x => x.id === state.editingPurchaseId);
  if (!p) return;
  if (!confirm('この買い物記録を削除しますか？' + (p.photoId ? '\n（レシート写真も削除されます）' : ''))) return;
  if (p.photoId) await PhotoDB.delete(p.photoId).catch(() => {});
  state.purchases = state.purchases.filter(x => x.id !== state.editingPurchaseId);
  Storage.save(STORAGE_KEYS.purchases, state.purchases);
  state.editingPurchaseId = null;
  state.editingReceiptPhotoId = null;
  hideModal('purchaseModal');
  renderRecords();
  showToast('削除しました');
}

// ===================================================================
// 分析タブ（SVG自作グラフ・外部ライブラリ不使用）
// ===================================================================
const CATEGORY_COLORS = {
  '和食': '#4a7c59',
  '洋食': '#e09b3d',
  '中華': '#cf5c4e',
  'エスニック': '#9273b8',
  'その他': '#8a9aa6'
};

function bindStatsHandlers() {
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.statsPeriod = btn.dataset.period;
      renderCategoryDonut();
    });
  });
}

function renderStats() {
  renderStatsCards();
  renderWeeklyChart();
  renderCategoryDonut();
  renderMoneyChart();
  renderRankings();
}

// 今週の予定・完了・完了率カード
function renderStatsCards() {
  const wk = getWeekKey(getMondayOf(new Date()));
  const week = state.weekPlan[wk] || {};
  let planned = 0, done = 0;
  DAY_ORDER.forEach(d => {
    const slots = Array.isArray(week[d]) ? week[d] : [];
    planned += slots.length;
    done += slots.filter(s => s.completed).length;
  });
  const rate = planned === 0 ? 0 : Math.round(done / planned * 100);
  document.getElementById('statsWeekCards').innerHTML = `
    <div class="stat-card"><div class="stat-value">${planned}</div><div class="stat-label">今週の予定</div></div>
    <div class="stat-card"><div class="stat-value">${done}</div><div class="stat-label">完了</div></div>
    <div class="stat-card"><div class="stat-value">${rate}%</div><div class="stat-label">完了率</div></div>
  `;
}

// 汎用SVG棒グラフ
function svgBarChart(data, opts = {}) {
  const W = 340, H = 175, padL = 8, padB = 24, padT = 20;
  const innerW = W - padL * 2, innerH = H - padB - padT;
  const maxV = Math.max(1, ...data.map(d => d.value));
  const n = data.length, slot = innerW / n, bw = Math.min(slot * 0.62, 42);
  const fmt = opts.fmt || (v => String(v));
  let parts = `<line class="cb-axis" x1="${padL}" y1="${padT + innerH}" x2="${W - padL}" y2="${padT + innerH}"/>`;
  data.forEach((d, i) => {
    const h = Math.round(innerH * (d.value / maxV));
    const x = padL + slot * i + (slot - bw) / 2;
    const y = padT + innerH - h;
    parts += `<rect class="cb-bar${d.hl ? ' hl' : ''}" x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${Math.max(h, d.value > 0 ? 2 : 0)}" rx="4"></rect>`;
    if (d.value > 0) {
      parts += `<text class="cb-value" x="${(x + bw / 2).toFixed(1)}" y="${y - 5}" text-anchor="middle">${escapeHtml(fmt(d.value))}</text>`;
    }
    parts += `<text class="cb-label" x="${(x + bw / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${escapeHtml(d.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">${parts}</svg>`;
}

// 週別調理回数（直近8週）
function renderWeeklyChart() {
  const thisMonday = getMondayOf(new Date());
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const mon = addDays(thisMonday, -7 * i);
    weeks.push({ key: formatDate(mon), label: formatJapaneseDate(mon), value: 0, hl: i === 0 });
  }
  state.history.forEach(h => {
    if (!h.completedAt) return;
    const d = new Date(h.completedAt);
    if (isNaN(d.getTime())) return;
    const key = formatDate(getMondayOf(d));
    const w = weeks.find(x => x.key === key);
    if (w) w.value++;
  });
  const total = weeks.reduce((s, w) => s + w.value, 0);
  document.getElementById('chartWeekly').innerHTML = total === 0
    ? '<div class="rank-empty">まだ調理履歴がありません。料理を完了すると集計されます。</div>'
    : svgBarChart(weeks, { fmt: v => `${v}` });
}

// カテゴリ構成ドーナツ
function renderCategoryDonut() {
  const container = document.getElementById('chartCategory');
  const now = Date.now();
  const periodMs = state.statsPeriod === '30' ? 30 * 86400000 : Infinity;
  const counts = {};
  let total = 0;
  state.history.forEach(h => {
    if (!h.completedAt) return;
    const age = now - new Date(h.completedAt).getTime();
    if (isNaN(age) || age > periodMs) return;
    const cat = h.category || 'その他';
    counts[cat] = (counts[cat] || 0) + 1;
    total++;
  });
  if (total === 0) {
    container.innerHTML = '<div class="rank-empty">この期間の調理履歴がありません</div>';
    return;
  }
  const items = Object.entries(counts)
    .map(([cat, value]) => ({ cat, value, color: CATEGORY_COLORS[cat] || CATEGORY_COLORS['その他'] }))
    .sort((a, b) => b.value - a.value);

  // ドーナツSVG生成
  const cx = 80, cy = 80, r = 58, sw = 26;
  let a0 = -Math.PI / 2, paths = '';
  items.forEach(it => {
    const frac = it.value / total;
    if (frac >= 0.999) {
      paths += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${sw}"/>`;
    } else {
      const a1 = a0 + frac * Math.PI * 2;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      paths += `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" fill="none" stroke="${it.color}" stroke-width="${sw}"/>`;
      a0 = a1;
    }
  });
  const legend = items.map(it =>
    `<div class="legend-row">
      <div class="legend-dot" style="background:${it.color}"></div>
      <div class="legend-name">${escapeHtml(it.cat)}</div>
      <div class="legend-count">${it.value}品（${Math.round(it.value / total * 100)}%）</div>
    </div>`).join('');
  container.innerHTML = `
    <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg" role="img">
      ${paths}
      <text class="donut-center" x="${cx}" y="${cy + 4}" text-anchor="middle">${total}</text>
      <text class="donut-center-sub" x="${cx}" y="${cy + 22}" text-anchor="middle">品</text>
    </svg>
    <div class="donut-legend">${legend}</div>
  `;
}

// 月別食費（直近6ヶ月）
function renderMoneyChart() {
  const months = [];
  const base = firstOfMonth(new Date());
  for (let i = 5; i >= 0; i--) {
    const m = addMonths(base, -i);
    months.push({ y: m.getFullYear(), m: m.getMonth(), label: `${m.getMonth() + 1}月`, value: 0, hl: i === 0 });
  }
  state.purchases.forEach(p => {
    const d = new Date(p.date);
    if (isNaN(d.getTime())) return;
    const mm = months.find(x => x.y === d.getFullYear() && x.m === d.getMonth());
    if (mm) mm.value += (p.total || 0);
  });
  const total = months.reduce((s, m) => s + m.value, 0);
  document.getElementById('chartMoney').innerHTML = total === 0
    ? '<div class="rank-empty">食費の記録がありません。「記録」タブで買い物を記録すると集計されます。</div>'
    : svgBarChart(months, { fmt: formatYenShort });
}

function formatYenShort(v) {
  if (v >= 10000) return `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}万`;
  return `¥${v.toLocaleString('ja-JP')}`;
}

// ランキング3種
function renderRankings() {
  // よく作る料理TOP5（履歴の回数）
  const countByName = {};
  state.history.forEach(h => {
    if (!h.recipeName) return;
    countByName[h.recipeName] = (countByName[h.recipeName] || 0) + 1;
  });
  const often = Object.entries(countByName).sort((a, b) => b[1] - a[1]).slice(0, 5);
  renderRankList('rankOften',
    often.map(([name, n]) => ({ name, meta: `×${n}回` })),
    'まだ調理履歴がありません');

  // 高評価TOP5
  const rated = state.recipes
    .filter(r => (r.rating || 0) > 0)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name, 'ja'))
    .slice(0, 5);
  renderRankList('rankRated',
    rated.map(r => ({ name: r.name, meta: '★'.repeat(r.rating) })),
    'まだ評価した料理がありません（調理画面の★で評価できます）');

  // ご無沙汰料理（調理経験ありで前回が古い順）
  const lastMap = buildLastCookedMap();
  const stale = state.recipes
    .filter(r => lastMap[r.id])
    .sort((a, b) => (lastMap[a.id] < lastMap[b.id] ? -1 : 1))
    .slice(0, 5);
  renderRankList('rankStale',
    stale.map(r => {
      const days = Math.floor((Date.now() - new Date(lastMap[r.id]).getTime()) / 86400000);
      return { name: r.name, meta: `${days}日前` };
    }),
    'まだ調理履歴がありません');
}

function renderRankList(elementId, rows, emptyMsg) {
  const el = document.getElementById(elementId);
  if (rows.length === 0) {
    el.innerHTML = `<div class="rank-empty">${escapeHtml(emptyMsg)}</div>`;
    return;
  }
  el.innerHTML = rows.map((r, i) => `
    <div class="rank-row">
      <div class="rank-num">${i + 1}</div>
      <div class="rank-name">${escapeHtml(r.name)}</div>
      <div class="rank-meta">${escapeHtml(r.meta)}</div>
    </div>`).join('');
}

// ===================================================================
// 「また作る」曜日ピッカー
// ===================================================================
function openDayPicker(recipeId, recipeName) {
  const recipe = state.recipes.find(r => r.id === recipeId);
  if (!recipe) {
    showToast('このレシピは削除されているため追加できません');
    return;
  }
  state.dayPickerRecipeId = recipeId;
  document.getElementById('dayPickerTitle').textContent = `「${recipeName}」をいつ作る？`;
  const thisMon = getMondayOf(new Date());
  buildDayPickerRow(document.getElementById('dayPickerThisWeek'), thisMon, true);
  buildDayPickerRow(document.getElementById('dayPickerNextWeek'), addDays(thisMon, 7), false);
  showModal('dayPickerModal');
}

function buildDayPickerRow(container, monday, disablePast) {
  container.innerHTML = '';
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  DAY_ORDER.forEach((dayKey, i) => {
    const date = addDays(monday, i);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-pick-btn';
    btn.innerHTML = `<span>${DAY_ORDER_JP[i]}</span><span class="dp-date">${date.getDate()}</span>`;
    if (disablePast && date < todayStart) btn.disabled = true;
    btn.addEventListener('click', () => {
      const wk = getWeekKey(monday);
      if (!state.weekPlan[wk]) state.weekPlan[wk] = {};
      if (!Array.isArray(state.weekPlan[wk][dayKey])) state.weekPlan[wk][dayKey] = [];
      state.weekPlan[wk][dayKey].push({
        slotId: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        recipeId: state.dayPickerRecipeId,
        checked: [], completed: false, completedAt: null
      });
      Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
      hideModal('dayPickerModal');
      state.currentWeekStart = new Date(monday);
      switchTab('week');
      showToast('献立に追加しました');
    });
    container.appendChild(btn);
  });
}

// ===================================================================
// 栄養バランス・賞味期限を考慮した自動献立提案
// ===================================================================

// たんぱく源のキーワード（判定は fish→meat→soy→egg の順で最初に一致したもの）
const PROTEIN_KW = {
  fish: ['鮭', 'さば', 'ぶり', 'あじ', 'いわし', 'さんま', 'たら', 'ほっけ', 'かれい', 'まぐろ', 'サーモン', 'かつお', 'えび', 'いか', 'たこ', 'あさり', 'しじみ', '牡蠣', 'かき', 'ほたて', '貝', 'かに', 'ツナ', 'うなぎ', '魚', '刺身', 'しらす', 'いくら', 'たらこ', '明太'],
  meat: ['鶏', '豚', '牛', 'ひき肉', '挽き肉', 'ミンチ', '合いびき', 'ベーコン', 'ハム', 'ウインナー', 'ソーセージ', 'チャーシュー', 'ささみ', '手羽', 'もも肉', 'ロース', 'バラ肉', '肩ロース', 'レバー', '肉'],
  soy: ['豆腐', '厚揚げ', '油揚げ', '納豆', '大豆', 'がんも', '高野豆腐', 'おから'],
  egg: ['卵', 'たまご', 'うずら']
};
const PROTEIN_LABEL = { fish: '🐟 魚', meat: '🥩 肉', soy: '🫛 大豆', egg: '🥚 卵', veg: '🥬 野菜中心' };

// 主食（一品完結）判定キーワード
const CARB_KW = ['ご飯', '米', 'うどん', 'そば', 'そうめん', 'パスタ', 'スパゲッティ', 'スパゲ', '中華麺', '中華蒸し麺', '焼きそば', 'ラーメン', '担々麺', '食パン', 'バゲット', 'トルティーヤ', 'ピザ生地', 'マカロニ', 'フォー', 'センレック', '春雨'];

// 揚げ物・こってり判定
function isFriedRecipe(recipe) {
  const nm = recipe.name || '';
  if (/揚げ|唐揚|竜田|天ぷら|フライ|カツ|コロッケ|かき揚|フリット|素揚/.test(nm)) return true;
  return recipe.ingredients.some(ing => getIngredientName(ing).includes('揚げ油'));
}

// 乾物・だし・缶詰・冷凍など（生の主材料ではない＝日持ちする・主たんぱく源ではない）
const PANTRY_MARK = /節|だし|出汁|ぶし|乾|干し|缶|冷凍|ふりかけ/;
// 乳製品（「牛乳」が「牛」肉と誤判定されるのを防ぐ・主たんぱく源からも除外）
const DAIRY_RE = /牛乳|生クリーム|ヨーグルト|チーズ|バター|練乳|牛脂/;

// レシピの栄養プロフィールを推定
function recipeNutritionInfo(recipe) {
  const names = recipe.ingredients.map(getIngredientName);
  // たんぱく源判定では、かつお節・だし等の薬味/乾物・乳製品は主材料から除外
  const proteinNames = names.filter(n => !PANTRY_MARK.test(n) && !DAIRY_RE.test(n));
  let protein = 'veg';
  for (const type of ['fish', 'meat', 'soy', 'egg']) {
    if (proteinNames.some(n => PROTEIN_KW[type].some(k => n.includes(k)))) { protein = type; break; }
  }
  const vegSet = new Set();
  names.forEach(n => { if (categorizeIngredient(n) === '野菜・きのこ') vegSet.add(n); });
  const oneDish = names.some(n => CARB_KW.some(k => n.includes(k)));
  return { protein, vegScore: vegSet.size, fried: isFriedRecipe(recipe), oneDish };
}

// ---- 賞味期限（土曜まとめ買い基準・一般的な日持ち日数） ----
const SHELF_TIERS = [
  { days: 2, kw: ['ひき肉', '挽き肉', 'ミンチ', '合いびき', '刺身', '鮭', 'さば', 'ぶり', 'あじ', 'いわし', 'さんま', 'まぐろ', 'サーモン', 'かつお', 'たら', 'えび', 'いか', 'たこ', 'あさり', 'しじみ', '牡蠣', 'かき', 'ほたて', '貝', 'かに', '魚', 'しらす', 'もやし', 'にら', 'ほうれん草', '小松菜', '春菊', '豆苗', '貝割れ', 'パクチー', 'ひき'] },
  { days: 3, kw: ['鶏', '豚', '牛', 'ささみ', '手羽', 'もも肉', 'ロース', 'バラ肉', '肩ロース', 'レバー', '豆腐', '厚揚げ', '油揚げ', 'しめじ', 'えのき', '椎茸', 'しいたけ', 'まいたけ', 'エリンギ', 'きのこ', 'ブロッコリー', 'アスパラ', 'トマト', 'きゅうり', '牛乳', '生クリーム', 'レタス', '水菜', 'チンゲン菜', 'オクラ'] },
  { days: 5, kw: ['ピーマン', 'パプリカ', 'なす', 'ズッキーニ', 'ねぎ', '長ねぎ', '小ねぎ', 'セロリ', 'いんげん', 'ハム', 'ベーコン', 'ウインナー', 'ソーセージ', 'こんにゃく', 'しらたき', '枝豆', 'みょうが', '大葉'] },
  { days: 9, kw: ['玉ねぎ', '人参', 'にんじん', 'じゃがいも', '大根', 'ごぼう', 'れんこん', 'かぼちゃ', 'さつまいも', '里芋', 'キャベツ', '白菜', '卵', 'たまご', 'うずら', 'りんご', 'ちくわ', 'かまぼこ', 'はんぺん', 'チーズ', 'たけのこ'] }
];
const SHELF_DEFAULT = 999; // 調味料・乾物・缶詰・冷凍・主食など日持ちするもの

function ingredientShelfDays(name) {
  const n = name || '';
  // 乾物・缶詰・冷凍・かつお節などは日持ちする（生鮮キーワードより優先）
  if (PANTRY_MARK.test(n)) return SHELF_DEFAULT;
  for (const tier of SHELF_TIERS) {
    if (tier.kw.some(k => n.includes(k))) return tier.days;
  }
  return SHELF_DEFAULT;
}

// 料理の「使うべき早さ」＝含まれる材料の最短日持ち
function dishUrgency(recipe) {
  let min = SHELF_DEFAULT, ingName = '';
  recipe.ingredients.forEach(ing => {
    const nm = getIngredientName(ing);
    const d = ingredientShelfDays(nm);
    if (d < min) { min = d; ingName = nm; }
  });
  return { days: min, ingName };
}

// ---- 賞味期限の「日付」計算（土曜まとめ買い基準） ----
// 週キー "W-YYYY-MM-DD" → その週の月曜Date
function mondayFromWeekKey(wk) {
  const p = String(wk).replace('W-', '').split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
// その週の買い出し日（前週土曜＝月曜の2日前）
function weekPurchaseSaturday(monday) { return addDays(monday, -2); }
// M/D(曜) 表記
function formatMdDow(date) {
  const dow = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  return `${date.getMonth() + 1}/${date.getDate()}(${dow})`;
}
// 料理の使用期限日（購入日 + 最短日持ち）。日持ち品のみの料理はnull
function dishDeadlineDate(recipe, purchaseDate) {
  const u = dishUrgency(recipe);
  if (u.days >= SHELF_DEFAULT) return null;
  return addDays(purchaseDate, u.days);
}
// 使用期限の緊急度クラス（表示色用）
function shelfClassOf(days) {
  if (days <= 2) return 'urgent';
  if (days <= 4) return 'soon';
  if (days >= SHELF_DEFAULT) return 'keep';
  return 'ok';
}

// ---- 季節・温度感の判定 ----
const NABE_RE = /鍋|おでん|すき焼き|しゃぶ|水炊き|寄せ|チゲ|湯豆腐|石狩/;   // 熱々の鍋物（夏は避ける）
const HOT_RE = /シチュー|グラタン|ドリア|ポトフ|煮込み|あんかけ/;           // 温かい煮込み系
const COOL_RE = /冷奴|冷や奴|そうめん|冷やし|冷し|冷製|ガスパチョ|カプレーゼ|酢の物|冷しゃぶ|ざる/;
function warmthOf(recipe) {
  const nm = recipe.name || '';
  if (NABE_RE.test(nm)) return 'nabe';
  if (HOT_RE.test(nm)) return 'hot';
  if (COOL_RE.test(nm)) return 'cool';
  return 'any';
}
const SEASON_LABEL = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
function currentSeason() {
  const m = new Date().getMonth() + 1;
  if (m >= 6 && m <= 8) return 'summer';
  if (m === 12 || m <= 2) return 'winter';
  if (m >= 3 && m <= 5) return 'spring';
  return 'autumn';
}
function resolveSeason() {
  const s = state.suggestSeason || 'auto';
  return s === 'auto' ? currentSeason() : s;
}
// 夏は鍋物を除外（ハード除外）
function seasonAllows(recipe, season) {
  if (season === 'summer' && warmthOf(recipe) === 'nabe') return false;
  return true;
}
// 季節スコア（提案時の加点/減点）
function seasonScore(recipe, season) {
  const w = warmthOf(recipe);
  if (season === 'summer') { if (w === 'hot') return -6; if (w === 'cool') return 2; }
  else if (season === 'winter') { if (w === 'cool') return -3; if (w === 'hot' || w === 'nabe') return 2; }
  return 0;
}

// ---- 主菜 / 副菜 / 汁物 の判定 ----
const SUB_NAME_RE = /サラダ|和え|おひたし|お浸し|ナムル|マリネ|ピクルス|漬|冷奴|冷や奴|酢の物|白和え|きんぴら|煮浸し|浅漬|ぬた|おかか|カプレーゼ/;
const SOUP_NAME_RE = /味噌汁|みそ汁|スープ|汁|チャウダー|ポタージュ|ミネストローネ|チゲ|吸い物/;
const ROLE_LABEL = { main: '主菜', sub: '副菜', soup: '汁物' };
// 料理名・材料からの自動判定
function autoDishRole(recipe) {
  const nm = recipe.name || '';
  if (warmthOf(recipe) === 'nabe') return 'main';   // 鍋物・すき焼き等は主役
  if (SOUP_NAME_RE.test(nm)) return 'soup';          // 味噌汁・豚汁・スープは「汁物」
  if (SUB_NAME_RE.test(nm)) return 'sub';
  const info = recipeNutritionInfo(recipe);
  if (info.oneDish) return 'main';                 // 丼・カレー・麺などは単品で主役
  if (info.protein === 'meat' || info.protein === 'fish') return 'main';
  return 'sub';                                    // 卵・大豆・野菜中心で主食でないものは副菜扱い
}
// 'main' | 'sub' | 'soup'。recipe.role が手動設定されていればそれを優先
function dishRole(recipe) {
  if (recipe && (recipe.role === 'main' || recipe.role === 'sub' || recipe.role === 'soup')) return recipe.role;
  return autoDishRole(recipe);
}

// ---- 料理の「和・洋・中・エスニック」スタイル判定 ----
// カテゴリ「その他」は和洋がごちゃ混ぜなので、料理名からもスタイルを推定する
const STYLE_BY_CAT = { '和食': 'washoku', '洋食': 'yoshoku', '中華': 'chuka', 'エスニック': 'ethnic' };
const STYLE_KW = {
  chuka: /麻婆|回鍋|青椒|餃子|焼売|春雨|バンバンジー|エビチリ|八宝菜|中華|担々|チャーハン|酢豚|油淋|春巻|エビマヨ|蟹玉|中華丼/,
  ethnic: /ガパオ|フォー|タコス|パッタイ|トムヤム|ナシゴレン|バインミー|タンドリー|パエリア|グリーンカレー|ビビンバ|チャプチェ|プルコギ|キムチ|チゲ|ナムル|インドカレー/,
  washoku: /焼きそば|お好み焼|たこ焼|おにぎり|味噌汁|みそ汁|豚汁|冷奴|ひじき|きんぴら|納豆|漬|おでん|うどん|そば|丼|茶碗蒸し|肉じゃが|生姜焼|照り焼|筑前煮|すき焼|親子|和風|天ぷら|天丼|唐揚|焼き鳥|さば|ぶり|鮭|手巻き|かつお|ちらし/,
  yoshoku: /グラタン|シチュー|チャウダー|コーンスープ|ミネストローネ|ポタージュ|カプレーゼ|コブ|シーザー|サンド|トースト|パンケーキ|オムレツ|オムライス|アヒージョ|ラタトゥイユ|ジャーマン|パスタ|スパゲ|ピザ|リゾット|ナポリタン|カルボ|ステーキ|ハンバーグ|ポトフ|ロールキャベツ|ムニエル|ソテー|フライ|ドリア|クロック/
};
function cuisineStyle(recipe) {
  const cat = recipe.category;
  if (STYLE_BY_CAT[cat]) return STYLE_BY_CAT[cat];   // 明示カテゴリを優先
  const nm = recipe.name || '';
  if (STYLE_KW.chuka.test(nm)) return 'chuka';
  if (STYLE_KW.ethnic.test(nm)) return 'ethnic';
  if (STYLE_KW.washoku.test(nm)) return 'washoku';
  if (STYLE_KW.yoshoku.test(nm)) return 'yoshoku';
  return 'neutral';                                  // ポテサラ・卵料理など、どの系統にも合う
}

// ---- 主菜と副菜/汁物の「相性」（和・洋・中の系統で判定） ----
function pairCompat(mainRecipe, sideRecipe) {
  const ms = cuisineStyle(mainRecipe);
  const ss = cuisineStyle(sideRecipe);
  if (ss === ms) return 3;                                        // 同系統がベスト（和×和・洋×洋）
  if (dishRole(sideRecipe) === 'soup' && ss === 'washoku') return 1; // 味噌汁・豚汁は万能
  if (ss === 'neutral' || ms === 'neutral') return 1;             // ポテサラ等はどれにも合う
  return -3;                                                     // 和×洋（焼きそば×チャウダー等）は不自然
}

function bindSuggestHandlers() {
  document.getElementById('suggestBtn').addEventListener('click', openSuggestModal);
  document.getElementById('reorderWeekBtn').addEventListener('click', reorderCurrentWeekByShelfLife);
  document.getElementById('generateSuggestBtn').addEventListener('click', () => runSuggest());
  document.getElementById('regenSuggestBtn').addEventListener('click', () => runSuggest());
  document.getElementById('applySuggestThisBtn').addEventListener('click', () => applySuggestToWeek(state.currentWeekStart));
  document.getElementById('applySuggestNextBtn').addEventListener('click', () => applySuggestToWeek(addDays(state.currentWeekStart, 7)));
  document.querySelectorAll('.sdays-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sdays-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.suggestDays = parseInt(btn.dataset.days, 10);
    });
  });
  document.querySelectorAll('.season-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.suggestSeason = btn.dataset.season;
    });
  });
  document.getElementById('optWithSub').addEventListener('change', (e) => { state.suggestWithSub = e.target.checked; });
  document.getElementById('optWithSoup').addEventListener('change', (e) => { state.suggestWithSoup = e.target.checked; });
  // 1日だけ提案（レシピ選択モーダル内のボタン）
  document.getElementById('suggestDayBtn').addEventListener('click', () => {
    const t = state.selectModalTargetDay;
    if (t) suggestForDay(t.weekKey, t.dayKey);
  });
}

function openSuggestModal() {
  state.suggestDays = state.suggestDays || 5;
  state._suggestPlan = null;
  document.getElementById('suggestResult').innerHTML = '';
  document.getElementById('suggestActions').classList.add('hidden');
  // トグルの表示を状態に同期
  document.querySelectorAll('.sdays-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.days, 10) === state.suggestDays));
  document.querySelectorAll('.season-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.season === (state.suggestSeason || 'auto')));
  document.getElementById('optWithSub').checked = state.suggestWithSub !== false;
  document.getElementById('optWithSoup').checked = !!state.suggestWithSoup;
  document.getElementById('applyThisLabel').textContent = formatJapaneseDate(state.currentWeekStart) + '〜';
  document.getElementById('applyNextLabel').textContent = formatJapaneseDate(addDays(state.currentWeekStart, 7)) + '〜';
  showModal('suggestModal');
}

// バランス重視でメイン料理をnDays品選ぶ（貪欲＋ランダム性＋季節）
function generateMains(nDays, season) {
  const pool = state.recipes.filter(r => r.ingredients && r.ingredients.length >= 2 && !r.excludeFromSuggest && dishRole(r) === 'main' && seasonAllows(r, season));
  if (pool.length === 0) return [];
  const chosen = [];
  const usedIds = new Set();
  const protein = { fish: 0, meat: 0, soy: 0, egg: 0, veg: 0 };
  const catCount = {};
  let fried = 0, oneDishCount = 0;
  const lastCooked = buildLastCookedMap();

  for (let step = 0; step < nDays; step++) {
    let best = null, bestScore = -Infinity;
    for (const r of pool) {
      if (usedIds.has(r.id)) continue;
      const info = recipeNutritionInfo(r);
      let s = 0;
      s -= protein[info.protein] * 3.0;
      s -= (catCount[r.category] || 0) * 2.0;
      if (info.fried) s -= fried * 3 + 1.0;
      s += Math.min(info.vegScore, 4) * 0.6;
      if (info.oneDish) s -= oneDishCount * 1.5;
      s += (r.rating || 0) * 0.25;
      s += seasonScore(r, season);
      const last = lastCooked[r.id];
      if (!last) s += 0.5;
      else s += Math.min(Math.floor((Date.now() - new Date(last).getTime()) / 86400000), 60) / 60 * 0.8;
      s += Math.random() * 2.2;
      if (s > bestScore) { bestScore = s; best = r; }
    }
    if (!best) break;
    usedIds.add(best.id);
    const info = recipeNutritionInfo(best);
    protein[info.protein]++;
    catCount[best.category] = (catCount[best.category] || 0) + 1;
    if (info.fried) fried++;
    if (info.oneDish) oneDishCount++;
    chosen.push(best);
  }
  return chosen;
}

// 各メインに合う副菜/汁物を1品ずつ（相性＝日本の家庭料理の組み合わせを重視）
function pickSideForEach(mains, role, season) {
  const pool = state.recipes.filter(r => r.ingredients && r.ingredients.length >= 1 && !r.excludeFromSuggest && dishRole(r) === role && seasonAllows(r, season));
  if (pool.length === 0) return mains.map(() => null);
  const used = new Set();
  return mains.map(main => {
    let candidates = pool.filter(s => !used.has(s.id));
    if (candidates.length === 0) { used.clear(); candidates = pool.slice(); }
    let best = null, bestScore = -Infinity;
    for (const s of candidates) {
      const info = recipeNutritionInfo(s);
      let sc = pairCompat(main, s) * 3.0             // 相性を最重視（和食主菜には和食系の副菜、など）
             + info.vegScore * 0.8
             + (s.rating || 0) * 0.2
             + seasonScore(s, season)
             + Math.random() * 1.5;
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    // 相性が悪い（和×洋など）ものしか残っていない場合は、無理に付けずに省略する
    if (!best || pairCompat(main, best) < 0) return null;
    used.add(best.id);
    return best;
  });
}

// 1日の使用期限＝メイン・副菜・汁物の材料で最短の日持ち
function dayUrgencyDays(day) {
  let min = SHELF_DEFAULT;
  [day.main, day.sub, day.soup].forEach(r => { if (r) min = Math.min(min, dishUrgency(r).days); });
  return min;
}

function runSuggest() {
  const nDays = state.suggestDays || 5;
  const season = resolveSeason();
  const mains = generateMains(nDays, season);
  if (mains.length === 0) {
    showToast('提案できるメイン料理が不足しています');
    return;
  }
  const subs = state.suggestWithSub ? pickSideForEach(mains, 'sub', season) : mains.map(() => null);
  const soups = state.suggestWithSoup ? pickSideForEach(mains, 'soup', season) : mains.map(() => null);
  let days = mains.map((m, i) => ({ main: m, sub: subs[i], soup: soups[i] }));
  // 使用期限の近い日を前半（月曜側）へ
  days.sort((a, b) => dayUrgencyDays(a) - dayUrgencyDays(b));
  state._suggestPlan = days;
  renderSuggestResult(days, season);
  document.getElementById('suggestActions').classList.remove('hidden');
}

function renderSuggestResult(days, season) {
  const dayJp = ['月', '火', '水', '木', '金', '土', '日'];
  const sum = { fish: 0, meat: 0, soy: 0, egg: 0, veg: 0 };
  const cat = {};
  let fried = 0, vegRichDays = 0;
  days.forEach(d => {
    const mi = recipeNutritionInfo(d.main);
    sum[mi.protein]++;
    cat[d.main.category] = (cat[d.main.category] || 0) + 1;
    if (mi.fried) fried++;
    const dayVeg = mi.vegScore
      + (d.sub ? recipeNutritionInfo(d.sub).vegScore : 0)
      + (d.soup ? recipeNutritionInfo(d.soup).vegScore : 0);
    if (dayVeg >= 3) vegRichDays++;
  });
  const proteinChips = ['meat', 'fish', 'soy', 'egg', 'veg']
    .filter(k => sum[k] > 0)
    .map(k => `<span class="nutri-chip">${PROTEIN_LABEL[k]}×${sum[k]}</span>`).join('');
  const catChips = Object.entries(cat).map(([c, n]) => `<span class="nutri-chip">${escapeHtml(c)}×${n}</span>`).join('');

  const notes = [];
  const proteinKinds = ['meat', 'fish', 'soy', 'egg'].filter(k => sum[k] > 0).length;
  notes.push(proteinKinds >= 3
    ? '✅ メインのたんぱく源がバランス良く分散しています'
    : '⚠️ たんぱく源がやや偏り気味です（別の案も試せます）');
  notes.push(vegRichDays >= Math.ceil(days.length / 2)
    ? '✅ 野菜がしっかり摂れる日が多めです'
    : '⚠️ 野菜が少なめの日があります');
  notes.push(fried <= 1 ? '✅ 揚げ物・こってりは控えめです' : `⚠️ 揚げ物・こってりが${fried}回あります`);

  const seasonNote = season === 'summer' ? '🌞 夏：鍋物・熱々の煮込みは避けています'
    : season === 'winter' ? '⛄ 冬：温かい料理を優先しています'
    : season === 'spring' ? '🌸 春の献立' : '🍁 秋の献立';

  let html = `
    <div class="nutri-summary">
      <div class="nutri-title">栄養バランス（大人向けの目安）／${seasonNote}</div>
      <div class="nutri-row">${proteinChips}</div>
      <div class="nutri-row">${catChips}</div>
      ${notes.map(n => `<div class="nutri-note ${n.startsWith('⚠️') ? 'warn' : ''}">${n}</div>`).join('')}
    </div>
  `;

  days.forEach((d, i) => {
    const mi = recipeNutritionInfo(d.main);
    const urgDays = dayUrgencyDays(d);
    let limitName = '';
    [d.main, d.sub, d.soup].forEach(r => { if (r) { const u = dishUrgency(r); if (u.days === urgDays) limitName = u.ingName; } });
    let shelfClass = shelfClassOf(urgDays), shelfText;
    if (urgDays <= 2) shelfText = `最優先（${limitName}·約${urgDays}日）`;
    else if (urgDays <= 4) shelfText = `前半で（約${urgDays}日）`;
    else if (urgDays >= SHELF_DEFAULT) shelfText = '日持ちOK';
    else shelfText = `約${urgDays}日`;

    let sidesHtml = '';
    if (d.sub) sidesHtml += `<div class="sd-sub">＋副菜：${escapeHtml(d.sub.name)}</div>`;
    if (d.soup) sidesHtml += `<div class="sd-sub">＋汁物：${escapeHtml(d.soup.name)}</div>`;
    if (!d.sub && !d.soup) sidesHtml = `<div class="sd-sub sd-nosub">主菜のみ</div>`;
    html += `
      <div class="suggest-day">
        <div class="sd-day">${dayJp[i]}</div>
        <div class="sd-main">
          <div class="sd-name">🍽 ${escapeHtml(d.main.name)} <span class="sd-role">主菜</span></div>
          ${sidesHtml}
          <div class="sd-tags"><span>${PROTEIN_LABEL[mi.protein]}</span><span>${escapeHtml(d.main.category)}</span></div>
        </div>
        <div class="sd-shelf ${shelfClass}">🧊 ${escapeHtml(shelfText)}</div>
      </div>`;
  });
  document.getElementById('suggestResult').innerHTML = html;
}

function applySuggestToWeek(monday) {
  if (!state._suggestPlan || state._suggestPlan.length === 0) { showToast('先に提案を作成してください'); return; }
  const wk = getWeekKey(monday);
  const existing = state.weekPlan[wk] || {};
  const has = DAY_ORDER.some(d => Array.isArray(existing[d]) && existing[d].length);
  const label = `${formatJapaneseDate(monday)}（月）〜`;
  if (has && !confirm(`${label} の献立を、提案内容で上書きします。よろしいですか？`)) return;

  state.weekPlan[wk] = {};
  state._suggestPlan.forEach((d, i) => {
    const dayKey = DAY_ORDER[i];
    if (!dayKey) return;
    const slots = [];
    const mkSlot = (rid) => ({
      slotId: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i + slots.length,
      recipeId: rid, checked: [], completed: false, completedAt: null
    });
    if (d.main) slots.push(mkSlot(d.main.id));
    if (d.sub) slots.push(mkSlot(d.sub.id));
    if (d.soup) slots.push(mkSlot(d.soup.id));
    if (slots.length) state.weekPlan[wk][dayKey] = slots;
  });
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
  hideModal('suggestModal');
  state.currentWeekStart = new Date(monday);
  switchTab('week');
  showToast('献立を反映しました');
}

// 特定の1日だけ提案（その週の他の曜日との栄養バランスを考慮）
function suggestForDay(weekKey, dayKey) {
  const season = resolveSeason();
  const week = state.weekPlan[weekKey] || {};
  // 他の曜日で使用中のメインの傾向を集計
  const protein = { fish: 0, meat: 0, soy: 0, egg: 0, veg: 0 };
  const catCount = {};
  let fried = 0;
  const usedRecipeIds = new Set();
  DAY_ORDER.forEach(d => {
    if (d === dayKey) return;
    (Array.isArray(week[d]) ? week[d] : []).forEach(s => {
      const r = state.recipes.find(x => x.id === s.recipeId);
      if (!r) return;
      usedRecipeIds.add(r.id);
      if (dishRole(r) === 'main') {
        const info = recipeNutritionInfo(r);
        protein[info.protein]++;
        catCount[r.category] = (catCount[r.category] || 0) + 1;
        if (info.fried) fried++;
      }
    });
  });
  const lastCooked = buildLastCookedMap();
  const pool = state.recipes.filter(r => r.ingredients && r.ingredients.length >= 2 &&
    !r.excludeFromSuggest && dishRole(r) === 'main' && seasonAllows(r, season) && !usedRecipeIds.has(r.id));
  if (pool.length === 0) { showToast('提案できる料理がありません'); return; }

  let best = null, bestScore = -Infinity;
  for (const r of pool) {
    const info = recipeNutritionInfo(r);
    let s = 0;
    s -= protein[info.protein] * 3.0;
    s -= (catCount[r.category] || 0) * 2.0;
    if (info.fried) s -= fried * 3 + 1.0;
    s += Math.min(info.vegScore, 4) * 0.6;
    s += (r.rating || 0) * 0.25;
    s += seasonScore(r, season);
    const last = lastCooked[r.id];
    if (!last) s += 0.5;
    else s += Math.min(Math.floor((Date.now() - new Date(last).getTime()) / 86400000), 60) / 60 * 0.8;
    s += Math.random() * 2.2;
    if (s > bestScore) { bestScore = s; best = r; }
  }
  if (!best) { showToast('提案できる料理がありません'); return; }

  const day = { main: best, sub: null, soup: null };
  if (state.suggestWithSub) day.sub = pickSideForEach([best], 'sub', season)[0];
  if (state.suggestWithSoup) day.soup = pickSideForEach([best], 'soup', season)[0];

  const slots = [];
  const mkSlot = (rid) => ({ slotId: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + slots.length, recipeId: rid, checked: [], completed: false, completedAt: null });
  [day.main, day.sub, day.soup].forEach(r => { if (r) slots.push(mkSlot(r.id)); });
  if (!state.weekPlan[weekKey]) state.weekPlan[weekKey] = {};
  state.weekPlan[weekKey][dayKey] = slots;
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
  hideModal('selectRecipeModal');
  renderWeek();
  const names = slots.map(s => (state.recipes.find(r => r.id === s.recipeId) || {}).name).filter(Boolean).join('＋');
  showToast(`この日の提案：${names}`);
}

// 1日ぶん（メイン＋副菜など）の最短日持ち
function groupUrgencyDays(slots) {
  let min = SHELF_DEFAULT;
  slots.forEach(s => {
    const r = state.recipes.find(x => x.id === s.recipeId);
    if (r) min = Math.min(min, dishUrgency(r).days);
  });
  return min;
}

// 表示中の週を、使用期限の近い日から順に並べ替え（1日のメイン＋副菜はまとめて移動）
function reorderCurrentWeekByShelfLife() {
  const wk = currentWeekKey();
  const week = state.weekPlan[wk] || {};
  const occupied = DAY_ORDER.filter(d => Array.isArray(week[d]) && week[d].length > 0);
  if (occupied.length <= 1) { showToast('並べ替える料理がありません'); return; }

  const anyCompleted = occupied.some(d => week[d].some(s => s.completed));
  if (anyCompleted && !confirm('並べ替えると、完了済みの状態はリセットされます。続けますか？')) return;

  const groups = occupied.map(d => ({ slots: week[d], urg: groupUrgencyDays(week[d]) }));
  groups.sort((a, b) => a.urg - b.urg);

  const newWeek = {};
  // 元々使われていない日はそのまま保持
  Object.keys(week).forEach(d => { if (!occupied.includes(d)) newWeek[d] = week[d]; });
  occupied.forEach((dayKey, i) => {
    newWeek[dayKey] = groups[i].slots.map(s => ({
      slotId: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 5),
      recipeId: s.recipeId, checked: [], completed: false, completedAt: null
    }));
  });
  state.weekPlan[wk] = newWeek;
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
  renderWeek();
  showToast('🧊 使用期限の近い順に並べ替えました');
}

// ===================================================================
// 孤立写真のクリーンアップ（参照されていない写真を削除）
// ===================================================================
async function cleanupOrphanPhotos() {
  try {
    const keys = await PhotoDB.getAllKeys();
    const referenced = new Set();
    state.history.forEach(h => { if (h.photoId) referenced.add(h.photoId); });
    state.purchases.forEach(p => { if (p.photoId) referenced.add(p.photoId); });
    for (const k of keys) {
      if (!referenced.has(k)) await PhotoDB.delete(k).catch(() => {});
    }
  } catch (e) { console.warn('orphan cleanup failed', e); }
}

// ===================================================================
// 起動
// ===================================================================
document.addEventListener('DOMContentLoaded', init);
