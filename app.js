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
const IDB_VERSION = 1;
const IDB_STORE = 'photos';

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
  }
};

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
        const total = recipe ? recipe.ingredients.length : 0;
        const checkedCount = (slot.checked || []).length;
        const metaText = slot.completed
          ? '✓ 完了'
          : (total > 0 ? `材料 ${checkedCount}/${total}` : '');
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

function renderCookIngredients(recipe, entry) {
  const ul = document.getElementById('cookIngredients');
  ul.innerHTML = '';
  // 表示にはサービング情報も
  const servingsLabel = recipe.servings ? `（${recipe.servings}人前）` : '';
  document.getElementById('cookRecipeName').textContent = recipe.name + servingsLabel;

  recipe.ingredients.forEach(ing => {
    const ingKey = getIngredientName(ing);
    const checked = (entry.checked || []).includes(ingKey);
    const amount = getIngredientAmount(ing);
    const li = document.createElement('li');
    if (checked) li.classList.add('checked');
    li.innerHTML = `
      <div class="ing-checkbox"></div>
      <div class="ing-name">${escapeHtml(ingKey)}</div>
      ${amount ? `<div class="ing-amount">${escapeHtml(amount)}</div>` : ''}
    `;
    li.addEventListener('click', () => toggleIngredient(ingKey));
    ul.appendChild(li);
  });
  updateCookProgress(recipe, entry);
}

function toggleIngredient(ingKey) {
  const slot = getCurrentSlot();
  if (!slot) return;
  if (slot.completed) {
    showToast('完了済みです');
    return;
  }
  if (!slot.checked) slot.checked = [];
  const idx = slot.checked.indexOf(ingKey);
  if (idx >= 0) slot.checked.splice(idx, 1);
  else slot.checked.push(ingKey);
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
  const recipe = state.recipes.find(r => r.id === slot.recipeId);
  renderCookIngredients(recipe, slot);
}

function updateCookProgress(recipe, slot) {
  const total = recipe.ingredients.length;
  const checked = (slot.checked || []).length;
  const pct = total === 0 ? 0 : Math.round((checked / total) * 100);
  document.getElementById('cookProgress').style.width = `${pct}%`;
  document.getElementById('cookProgressText').textContent =
    slot.completed ? `✓ 完了済み（${formatCompletedAt(slot.completedAt)}）` : `${checked} / ${total} 個使用`;

  const btn = document.getElementById('completeCookBtn');
  btn.disabled = slot.completed || checked < total;
  btn.textContent = slot.completed
    ? '完了済み'
    : (checked < total ? `すべて使用 → 完了（あと${total - checked}個）` : 'すべて使用 → 完了');
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
  if ((slot.checked || []).length < recipe.ingredients.length) return;

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

function showUploadingOverlay() {
  if (document.getElementById('uploadingOverlay')) return;
  const el = document.createElement('div');
  el.id = 'uploadingOverlay';
  el.className = 'uploading-overlay';
  el.innerHTML = `<div class="uploading-spinner"><div class="spinner-dot"></div><div>写真を保存中...</div></div>`;
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
