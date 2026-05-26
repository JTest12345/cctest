// ===================================================================
// 週レシピ管理アプリ - メインロジック
// データはすべて localStorage に保存
// ===================================================================

const STORAGE_KEYS = {
  recipes: 'wr_recipes_v1',
  weekPlan: 'wr_weekplan_v1',
  history: 'wr_history_v1'
};

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
  weekPlan: {},          // { "2026-W21": { mon: {recipeId, checked:[], completed:false, completedAt:null}, ... } }
  history: [],           // [{ recipeId, recipeName, date, completedAt }]
  currentWeekStart: null, // Date (月曜日)
  currentTab: 'week',
  currentCategoryFilter: 'all',
  currentEditingRecipeId: null,
  currentCookingDay: null, // 'mon'..'sun'
  currentCookingWeekKey: null,
  selectModalTargetDay: null
};

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

  renderAll();
  registerServiceWorker();
}

function loadAllData() {
  // 初回起動時はサンプルレシピを投入
  const savedRecipes = Storage.load(STORAGE_KEYS.recipes, null);
  if (savedRecipes === null) {
    state.recipes = [...(window.SAMPLE_RECIPES || [])];
    Storage.save(STORAGE_KEYS.recipes, state.recipes);
  } else {
    state.recipes = savedRecipes;
  }
  state.weekPlan = Storage.load(STORAGE_KEYS.weekPlan, {});
  state.history = Storage.load(STORAGE_KEYS.history, []);
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

  // 月〜日の順で表示
  const dayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  dayOrder.forEach((dayKey, idx) => {
    const date = addDays(monday, idx);
    const dayJp = ['月', '火', '水', '木', '金', '土', '日'][idx];
    const dayEntry = planForWeek[dayKey];
    const card = document.createElement('div');
    card.className = 'day-card';
    if (dayKey === 'sat') card.classList.add('saturday');
    if (dayKey === 'sun') card.classList.add('sunday');
    if (isSameDate(date, today)) card.classList.add('today');
    if (dayEntry && dayEntry.completed) card.classList.add('completed');

    let centerHtml = '';
    let actionHtml = '';

    if (dayEntry) {
      const recipe = state.recipes.find(r => r.id === dayEntry.recipeId);
      const recipeName = recipe ? recipe.name : '（削除されたレシピ）';
      const checkedCount = (dayEntry.checked || []).length;
      const total = recipe ? recipe.ingredients.length : 0;
      const metaText = dayEntry.completed
        ? `✓ 完了`
        : (total > 0 ? `材料 ${checkedCount}/${total}` : '');
      centerHtml = `
        <div class="day-recipe-name">${escapeHtml(recipeName)}</div>
        <div class="day-recipe-meta">${escapeHtml(metaText)}</div>
      `;
      actionHtml = dayEntry.completed
        ? `<div class="day-action completed-tag">確認</div>`
        : `<div class="day-action">調理開始</div>`;
    } else {
      centerHtml = `<div class="day-recipe empty">タップして料理を設定</div>`;
      actionHtml = `<div class="day-action">＋ 選ぶ</div>`;
    }

    card.innerHTML = `
      <div class="day-label">
        <span class="day-name">${dayJp}</span>
        <span class="day-date">${date.getDate()}</span>
      </div>
      <div class="day-recipe">${centerHtml}</div>
      ${actionHtml}
    `;

    card.addEventListener('click', () => {
      if (dayEntry) {
        openCookModal(weekKey, dayKey);
      } else {
        openSelectRecipeModal(weekKey, dayKey);
      }
    });

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
    .filter(r => !q || r.name.toLowerCase().includes(q) || r.ingredients.some(i => i.toLowerCase().includes(q)))
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
  state.weekPlan[target.weekKey][target.dayKey] = {
    recipeId,
    checked: [],
    completed: false,
    completedAt: null
  };
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
  hideModal('selectRecipeModal');
  renderWeek();
  showToast('献立に追加しました');
}

// ===================================================================
// 調理モーダル（材料チェック）
// ===================================================================
function bindCookModal() {
  document.getElementById('completeCookBtn').addEventListener('click', completeCooking);
  document.getElementById('removeFromWeekBtn').addEventListener('click', removeFromWeek);
}

function openCookModal(weekKey, dayKey) {
  state.currentCookingWeekKey = weekKey;
  state.currentCookingDay = dayKey;
  const entry = state.weekPlan[weekKey][dayKey];
  const recipe = state.recipes.find(r => r.id === entry.recipeId);

  if (!recipe) {
    showToast('レシピが見つかりません');
    return;
  }

  document.getElementById('cookRecipeName').textContent = recipe.name;
  renderCookIngredients(recipe, entry);
  showModal('cookModal');
}

function renderCookIngredients(recipe, entry) {
  const ul = document.getElementById('cookIngredients');
  ul.innerHTML = '';
  recipe.ingredients.forEach(ing => {
    const checked = (entry.checked || []).includes(ing);
    const li = document.createElement('li');
    if (checked) li.classList.add('checked');
    li.innerHTML = `
      <div class="ing-checkbox"></div>
      <div class="ing-name">${escapeHtml(ing)}</div>
    `;
    li.addEventListener('click', () => toggleIngredient(ing));
    ul.appendChild(li);
  });
  updateCookProgress(recipe, entry);
}

function toggleIngredient(ing) {
  const entry = state.weekPlan[state.currentCookingWeekKey][state.currentCookingDay];
  if (entry.completed) {
    showToast('完了済みです');
    return;
  }
  if (!entry.checked) entry.checked = [];
  const idx = entry.checked.indexOf(ing);
  if (idx >= 0) entry.checked.splice(idx, 1);
  else entry.checked.push(ing);
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);
  const recipe = state.recipes.find(r => r.id === entry.recipeId);
  renderCookIngredients(recipe, entry);
}

function updateCookProgress(recipe, entry) {
  const total = recipe.ingredients.length;
  const checked = (entry.checked || []).length;
  const pct = total === 0 ? 0 : Math.round((checked / total) * 100);
  document.getElementById('cookProgress').style.width = `${pct}%`;
  document.getElementById('cookProgressText').textContent =
    entry.completed ? `✓ 完了済み（${formatCompletedAt(entry.completedAt)}）` : `${checked} / ${total} 個使用`;

  const btn = document.getElementById('completeCookBtn');
  btn.disabled = entry.completed || checked < total;
  btn.textContent = entry.completed
    ? '完了済み'
    : (checked < total ? `すべて使用 → 完了（あと${total - checked}個）` : 'すべて使用 → 完了');
}

function formatCompletedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function completeCooking() {
  const entry = state.weekPlan[state.currentCookingWeekKey][state.currentCookingDay];
  const recipe = state.recipes.find(r => r.id === entry.recipeId);
  if (!recipe) return;
  if ((entry.checked || []).length < recipe.ingredients.length) return;

  entry.completed = true;
  entry.completedAt = new Date().toISOString();
  Storage.save(STORAGE_KEYS.weekPlan, state.weekPlan);

  // 履歴に追加
  state.history.unshift({
    recipeId: recipe.id,
    recipeName: recipe.name,
    category: recipe.category,
    completedAt: entry.completedAt
  });
  // 履歴は最新500件まで保持
  if (state.history.length > 500) state.history.length = 500;
  Storage.save(STORAGE_KEYS.history, state.history);

  hideModal('cookModal');
  renderWeek();
  showToast(`🎉 ${recipe.name}を完了しました`);
}

function removeFromWeek() {
  if (!confirm('この曜日の献立を削除しますか？\n（履歴は残ります）')) return;
  delete state.weekPlan[state.currentCookingWeekKey][state.currentCookingDay];
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
    .filter(r => !query || r.name.toLowerCase().includes(query) || r.ingredients.some(i => i.toLowerCase().includes(query)))
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
    document.getElementById('editIngredients').value = r.ingredients.join('\n');
    deleteBtn.classList.remove('hidden');
  } else {
    document.getElementById('editModalTitle').textContent = '新規レシピ';
    document.getElementById('editName').value = '';
    document.getElementById('editCategory').value = '和食';
    document.getElementById('editIngredients').value = '';
    deleteBtn.classList.add('hidden');
  }
  showModal('editRecipeModal');
}

function saveRecipeFromForm() {
  const name = document.getElementById('editName').value.trim();
  const category = document.getElementById('editCategory').value;
  const ingredientsRaw = document.getElementById('editIngredients').value;
  const ingredients = ingredientsRaw.split('\n').map(s => s.trim()).filter(s => s.length > 0);

  if (!name) { showToast('料理名を入力してください'); return; }
  if (ingredients.length === 0) { showToast('材料を1つ以上入力してください'); return; }

  if (state.currentEditingRecipeId) {
    const r = state.recipes.find(x => x.id === state.currentEditingRecipeId);
    if (r) {
      r.name = name;
      r.category = category;
      r.ingredients = ingredients;
    }
  } else {
    state.recipes.push({
      id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, category, ingredients
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
// 履歴描画
// ===================================================================
function renderHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '';
  if (state.history.length === 0) {
    list.innerHTML = '<div class="history-empty">まだ完了した料理はありません</div>';
    return;
  }
  state.history.forEach(h => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div>
        <div class="history-name">${escapeHtml(h.recipeName)}</div>
        <div class="history-date"><span class="recipe-card-cat">${escapeHtml(h.category || '')}</span></div>
      </div>
      <div class="history-date">${formatCompletedAt(h.completedAt)}</div>
    `;
    list.appendChild(item);
  });
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
