// ===================================================================
// 週レシピ管理アプリ - メインロジック
// データはすべて localStorage に保存
// ===================================================================

const STORAGE_KEYS = {
  recipes: 'wr_recipes_v1',
  weekPlan: 'wr_weekplan_v1',
  history: 'wr_history_v1',
  sampleDataVersion: 'wr_sample_data_version',
  schemaVersion: 'wr_schema_version'
};

const SCHEMA_VERSION = 2; // 1: 1日1レシピ, 2: 1日複数レシピ
const IDB_NAME = 'WeekRecipePhotoDB';
const IDB_VERSION = 2;
const IDB_STORE = 'photos';
const IDB_BACKUP_STORE = 'backup';
const EXPORT_FORMAT_VERSION = 1;

// 写真圧縮設定
const PHOTO_MAX_DIM = 1024;     // 長辺の最大px
const PHOTO_QUALITY = 0.7;       // JPEG品質

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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
  photoDB: null
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
    showImportPreview(payload, file.size);
  } catch (err) {
    hideUploadingOverlay();
    console.error(err);
    showToast('読み込み失敗: ' + (err.message || ''));
  }
}

function showImportPreview(payload, fileSize) {
  const content = document.getElementById('importPreviewContent');
  const photoCount = payload.photos ? Object.keys(payload.photos).length : 0;
  const planCount = countPlanSlots(payload.weekPlan);
  const exportedAt = payload.exportedAt ? new Date(payload.exportedAt) : null;
  const exportedAtStr = exportedAt ? `${exportedAt.getFullYear()}/${exportedAt.getMonth() + 1}/${exportedAt.getDate()} ${String(exportedAt.getHours()).padStart(2, '0')}:${String(exportedAt.getMinutes()).padStart(2, '0')}` : '不明';

  content.innerHTML = `
    <div class="preview-row title"><span>取り込み元データ</span><span>${exportedAtStr}</span></div>
    <div class="preview-row"><span>レシピ</span><span>${payload.recipes.length}件</span></div>
    <div class="preview-row"><span>献立予定</span><span>${planCount}件</span></div>
    <div class="preview-row"><span>完了履歴</span><span>${payload.history.length}件</span></div>
    <div class="preview-row"><span>写真</span><span>${photoCount}枚</span></div>
    <div class="preview-row"><span>ファイルサイズ</span><span>${formatBytes(fileSize)}</span></div>
    <div class="preview-row title" style="margin-top:10px;"><span>現在のデータ（上書きされます）</span><span></span></div>
    <div class="preview-row"><span>レシピ</span><span>${state.recipes.length}件</span></div>
    <div class="preview-row"><span>完了履歴</span><span>${state.history.length}件</span></div>
  `;
  showModal('importPreviewModal');
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

    // 4. localStorageに書き戻し
    state.recipes = pendingImportPayload.recipes;
    state.weekPlan = pendingImportPayload.weekPlan;
    state.history = pendingImportPayload.history;
    Storage.save(STORAGE_KEYS.recipes, state.recipes);
    Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
    Storage.save(STORAGE_KEYS.history, state.history);
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
    Storage.save(STORAGE_KEYS.recipes, state.recipes);
    Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
    Storage.save(STORAGE_KEYS.history, state.history);
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

  renderAll();
  registerServiceWorker();
  PhotoDB.open().catch(err => console.warn('IndexedDB open failed:', err));

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
function searchIngredient(ing, query) {
  return getIngredientName(ing).toLowerCase().includes(query) ||
         getIngredientAmount(ing).toLowerCase().includes(query);
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
}

// ===================================================================
// 週カレンダー描画
// ===================================================================
function renderWeek() {
  const monday = state.currentWeekStart;
  const sunday = addDays(monday, 6);
  document.getElementById('weekLabel').textContent =
    `${formatJapaneseDate(monday)}（月）〜 ${formatJapaneseDate(sunday)}（日）`;

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
      slots.forEach(slot => {
        const recipe = state.recipes.find(r => r.id === slot.recipeId);
        const recipeName = recipe ? recipe.name : '（削除されたレシピ）';
        const metaText = slot.completed ? '✓ 完了' : '未調理';
        const slotEl = document.createElement('div');
        slotEl.className = 'recipe-slot' + (slot.completed ? ' completed' : '');
        slotEl.innerHTML = `
          <div class="recipe-slot-name">${escapeHtml(recipeName)}</div>
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
  document.getElementById('selectSearch').value = '';
  renderSelectRecipeList('');
  showModal('selectRecipeModal');
}

function renderSelectRecipeList(query) {
  const list = document.getElementById('selectRecipeList');
  list.innerHTML = '';
  const q = (query || '').toLowerCase().trim();
  const filtered = state.recipes
    .filter(r => !q || r.name.toLowerCase().includes(q) || r.ingredients.some(i => searchIngredient(i, q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  if (filtered.length === 0) {
    list.innerHTML = '<div class="history-empty">該当するレシピがありません</div>';
    return;
  }

  filtered.forEach(r => {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    card.innerHTML = `
      <div class="recipe-card-name">
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

  // 材料リスト（チェックなし、表示専用）
  recipe.ingredients.forEach(ing => {
    const ingName = getIngredientName(ing);
    const amount = getIngredientAmount(ing);
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="ing-bullet"></div>
      <div class="ing-name">${escapeHtml(ingName)}</div>
      ${amount ? `<div class="ing-amount">${escapeHtml(amount)}</div>` : ''}
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
  document.getElementById('addRecipeBtn').addEventListener('click', () => openEditRecipeModal(null));
  document.getElementById('saveRecipeBtn').addEventListener('click', saveRecipeFromForm);
  document.getElementById('deleteRecipeBtn').addEventListener('click', deleteCurrentRecipe);

  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentCategoryFilter = btn.dataset.cat;
      renderRecipeList();
    });
  });
}

function renderRecipeList() {
  const list = document.getElementById('recipeList');
  list.innerHTML = '';
  const query = document.getElementById('recipeSearch').value.toLowerCase().trim();
  const cat = state.currentCategoryFilter;

  const filtered = state.recipes
    .filter(r => cat === 'all' || r.category === cat)
    .filter(r => !query || r.name.toLowerCase().includes(query) || r.ingredients.some(i => searchIngredient(i, query)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  if (filtered.length === 0) {
    list.innerHTML = '<div class="history-empty">該当するレシピがありません</div>';
    return;
  }

  filtered.forEach(r => {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    card.innerHTML = `
      <div class="recipe-card-name">${escapeHtml(r.name)}</div>
      <div class="recipe-card-meta">
        <span class="recipe-card-cat">${escapeHtml(r.category)}</span>
        材料 ${r.ingredients.length}個
      </div>
    `;
    card.addEventListener('click', () => openEditRecipeModal(r.id));
    list.appendChild(card);
  });
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
    // 「材料名,分量」形式で1行ずつ
    const lines = r.ingredients.map(ing => {
      const name = getIngredientName(ing);
      const amount = getIngredientAmount(ing);
      return amount ? `${name}, ${amount}` : name;
    });
    document.getElementById('editIngredients').value = lines.join('\n');
    deleteBtn.classList.remove('hidden');
  } else {
    document.getElementById('editModalTitle').textContent = '新規レシピ';
    document.getElementById('editName').value = '';
    document.getElementById('editCategory').value = '和食';
    document.getElementById('editServings').value = 2;
    document.getElementById('editIngredients').value = '';
    deleteBtn.classList.add('hidden');
  }
  showModal('editRecipeModal');
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

  if (state.currentEditingRecipeId) {
    const r = state.recipes.find(x => x.id === state.currentEditingRecipeId);
    if (r) {
      r.name = name;
      r.category = category;
      r.servings = servings;
      r.ingredients = ingredients;
    }
  } else {
    state.recipes.push({
      id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, category, servings, ingredients
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
      <button class="history-delete-btn" aria-label="この履歴を削除">✕</button>
    `;
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

function openPhotoSourceModal(historyIdx) {
  state.currentPhotoHistoryIdx = historyIdx;
  showModal('photoSourceModal');
}

async function handlePhotoSelected(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  // input をリセット（同じファイルを再選択できるよう）
  input.value = '';
  if (!file) return;
  if (state.currentPhotoHistoryIdx == null) return;

  // 「ファイル選択」モーダルを閉じてアップロード表示
  hideModal('photoSourceModal');
  showUploadingOverlay();

  try {
    if (!file.type.startsWith('image/')) {
      throw new Error('画像ファイルを選択してください');
    }
    const compressedBlob = await compressImage(file);
    const history = state.history[state.currentPhotoHistoryIdx];
    if (!history) throw new Error('履歴が見つかりません');

    // 既存写真があれば削除
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
// 起動
// ===================================================================
document.addEventListener('DOMContentLoaded', init);
