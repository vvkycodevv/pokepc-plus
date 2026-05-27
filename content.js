(function() {
  let currentMatches = [];
  let currentIndex = 0;
  let debounceTimer = null;
  let scrollScanAbort = null;
  let elementIndex = new Map();
  let doneSet = new Set();
  let processedIds = new Set();
  let isProcessing = false;
  let tooltipEl = null;
  let nameMap = null;

  function loadProgression() {
    return new Promise(resolve => {
      chrome.storage.local.get('pokepcProgress', (data) => {
        resolve(new Set(data.pokepcProgress || []));
      });
    });
  }

  function saveProgression() {
    chrome.storage.local.set({ pokepcProgress: [...doneSet] });
  }

  function extractPokemonId(src) {
    const match = src.match(/\/(\d{4}(?:-[a-z0-9-]+)?)\.webp/);
    return match ? match[1] : null;
  }

  function buildNameMap() {
    if (nameMap) return;
    nameMap = new Map();
    for (const p of POKEMON_DATA) {
      nameMap.set(p.id, p.name);
    }
  }

  function formatName(name) {
    return name.replace(/(^|[\s-])[a-z]/g, m => m.toUpperCase()).replace(/-/g, ' ');
  }

  function createTooltip() {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'pokepc-tooltip';
    document.body.appendChild(tooltipEl);
  }

  function showTooltip(li, e) {
    const id = li.dataset.pokepcId;
    if (!id || !nameMap) return;

    const name = nameMap.get(id);
    if (!name) return;

    const dexNum = id.match(/^(\d+)/)?.[1];
    const dexDisplay = dexNum ? `#${parseInt(dexNum)}` : '';

    tooltipEl.innerHTML = `${formatName(name)}<span class="tooltip-dex">${dexDisplay}</span>`;
    tooltipEl.classList.add('visible');
    positionTooltip(li);
  }

  function positionTooltip(li) {
    const rect = li.getBoundingClientRect();
    const tipRect = tooltipEl.getBoundingClientRect();

    let x = rect.left + (rect.width / 2) - (tipRect.width / 2);
    let y = rect.top - tipRect.height - 6;

    if (y < 4) y = rect.bottom + 6;
    if (x < 4) x = 4;
    if (x + tipRect.width > window.innerWidth - 4) {
      x = window.innerWidth - tipRect.width - 4;
    }

    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.remove('visible');
  }

  function suppressNativeTooltip(li) {
    const img = li.querySelector('img');
    if (img && img.hasAttribute('title')) {
      img.removeAttribute('title');
    }
    if (li.hasAttribute('title')) {
      li.removeAttribute('title');
    }
  }

  function buildElementIndex() {
    const imgs = document.querySelectorAll('img[src*="/images/pokemon/"]');
    for (const img of imgs) {
      const id = extractPokemonId(img.src);
      if (id) {
        if (!elementIndex.has(id)) elementIndex.set(id, []);
        const li = img.closest('li') || img;
        if (!elementIndex.get(id).some(e => e.li === li)) {
          elementIndex.get(id).push({ li, img });
        }
      }
    }
  }

  function processTickMarks() {
    const imgs = document.querySelectorAll('img[src*="/images/pokemon/"]');
    for (const img of imgs) {
      const li = img.closest('li');
      if (!li || li.dataset.pokepcId) continue;

      const id = extractPokemonId(img.src);
      if (!id) continue;
      li.dataset.pokepcId = id;
      li.classList.add('pokepc-has-tick');

      const tick = document.createElement('div');
      tick.className = 'pokepc-tick';
      if (doneSet.has(id)) {
        tick.classList.add('done');
        li.classList.add('pokepc-done');
      }
      li.appendChild(tick);
      processedIds.add(id);

      suppressNativeTooltip(li);

      li.addEventListener('mouseenter', (e) => showTooltip(li, e));
      li.addEventListener('mouseleave', hideTooltip);
      li.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleDone(li, id, tick);
      });
    }
    updateProgressCounter();
  }

  function toggleDone(li, id, tick, skipSave) {
    const catching = !doneSet.has(id);
    if (catching) {
      doneSet.add(id);
      tick.classList.add('done');
      li.classList.add('pokepc-done');
    } else {
      doneSet.delete(id);
      tick.classList.remove('done');
      li.classList.remove('pokepc-done');
    }

    li.classList.remove('pokepc-anim-catch', 'pokepc-anim-uncatch');
    void li.offsetWidth;
    li.classList.add(catching ? 'pokepc-anim-catch' : 'pokepc-anim-uncatch');

    if (!skipSave) {
      saveProgression();
      updateProgressCounter();
      updateAllBoxTicks();
    }
  }

  function updateProgressCounter() {
    const counter = document.getElementById('pokepc-progress-text');
    const fill = document.getElementById('pokepc-progress-fill');
    if (!counter) return;

    const caught = doneSet.size;
    const total = processedIds.size || POKEMON_DATA.length;
    const pct = total > 0 ? (caught / total * 100).toFixed(1) : 0;

    counter.textContent = `${caught} / ${total} caught (${pct}%)`;
    fill.style.width = `${pct}%`;
  }

  function observeNewElements() {
    const observer = new MutationObserver((mutations) => {
      if (isProcessing) return;

      let hasNew = false;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.id === 'pokepc-search-container') continue;
          if (node.classList && node.classList.contains('pokepc-tick')) continue;
          if (node.tagName === 'IMG' || node.querySelector?.('img')) {
            hasNew = true;
            break;
          }
        }
        if (hasNew) break;
      }
      if (hasNew) {
        isProcessing = true;
        buildElementIndex();
        processTickMarks();
        setupBoxHeadings();
        ensureSearchUI();
        isProcessing = false;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function ensureSearchUI() {
    if (!document.getElementById('pokepc-search-container')) {
      createSearchUI();
      updateProgressCounter();
    }
  }

  function setupBoxHeadings() {
    const headings = document.querySelectorAll('h2');
    for (const h2 of headings) {
      if (h2.dataset.pokepcBox) continue;
      const ol = h2.nextElementSibling;
      if (!ol || ol.tagName !== 'OL') continue;

      h2.dataset.pokepcBox = 'true';
      h2.classList.add('pokepc-box-heading');

      const boxTick = document.createElement('span');
      boxTick.className = 'pokepc-box-tick';
      h2.appendChild(boxTick);

      updateBoxTick(ol, boxTick);

      h2.addEventListener('click', () => {
        toggleBox(ol, boxTick);
      });
    }
  }

  function getBoxItems(ol) {
    return Array.from(ol.querySelectorAll('li[data-pokepc-id]'));
  }

  function toggleBox(ol, boxTick) {
    const items = getBoxItems(ol);
    if (items.length === 0) return;

    const allDone = items.every(li => doneSet.has(li.dataset.pokepcId));
    const catching = !allDone;

    ol.classList.remove('pokepc-box-anim');
    void ol.offsetWidth;

    items.forEach((li, i) => {
      const id = li.dataset.pokepcId;
      const tick = li.querySelector('.pokepc-tick');
      if (!tick) return;

      const isCurrentlyDone = doneSet.has(id);
      if (catching && !isCurrentlyDone) {
        toggleDone(li, id, tick, true);
        li.style.animationDelay = `${i * 15}ms`;
      } else if (!catching && isCurrentlyDone) {
        toggleDone(li, id, tick, true);
        li.style.animationDelay = `${i * 15}ms`;
      }
    });

    ol.classList.add('pokepc-box-anim');
    saveProgression();
    updateProgressCounter();
    updateBoxTick(ol, boxTick);
  }

  function updateBoxTick(ol, boxTick) {
    const items = getBoxItems(ol);
    if (items.length === 0) return;
    const allDone = items.every(li => doneSet.has(li.dataset.pokepcId));
    boxTick.classList.toggle('all-done', allDone);
  }

  function updateAllBoxTicks() {
    document.querySelectorAll('h2.pokepc-box-heading').forEach(h2 => {
      const ol = h2.nextElementSibling;
      const boxTick = h2.querySelector('.pokepc-box-tick');
      if (ol && boxTick) updateBoxTick(ol, boxTick);
    });
  }

  async function init() {
    doneSet = await loadProgression();
    buildNameMap();
    createTooltip();
    buildElementIndex();
    createSearchUI();
    isProcessing = true;
    processTickMarks();
    setupBoxHeadings();
    isProcessing = false;
    observeNewElements();
  }

  function createSearchUI() {
    const container = document.createElement('div');
    container.id = 'pokepc-search-container';
    container.innerHTML = `
      <input type="text" id="pokepc-search-input" placeholder="Search Pokémon... (Ctrl+F)" autocomplete="off" spellcheck="false">
      <div id="pokepc-search-info">
        <span class="match-text"></span>
        <div class="nav-buttons">
          <button class="nav-btn" id="pokepc-prev-btn">◀ Prev</button>
          <button class="nav-btn" id="pokepc-next-btn">Next ▶</button>
        </div>
      </div>
      <div id="pokepc-progress-bar">
        <div class="progress-row">
          <span id="pokepc-progress-text">0 / 0 caught</span>
          <button id="pokepc-reset-btn">Reset</button>
        </div>
        <div class="progress-track"><div class="progress-fill" id="pokepc-progress-fill"></div></div>
      </div>
    `;
    document.body.appendChild(container);

    const input = document.getElementById('pokepc-search-input');
    const prevBtn = document.getElementById('pokepc-prev-btn');
    const nextBtn = document.getElementById('pokepc-next-btn');

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => performSearch(input.value), 80);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) navigatePrev();
        else navigateNext();
      }
      if (e.key === 'Escape') {
        input.value = '';
        clearSearch();
        input.blur();
      }
    });

    prevBtn.addEventListener('click', navigatePrev);
    nextBtn.addEventListener('click', navigateNext);
    document.getElementById('pokepc-reset-btn').addEventListener('click', showResetConfirm);

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  function showResetConfirm() {
    if (document.getElementById('pokepc-reset-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'pokepc-reset-overlay';
    overlay.innerHTML = `
      <div id="pokepc-reset-dialog">
        <h3>Reset all progress?</h3>
        <p>This will unmark all ${doneSet.size} caught Pokémon. This cannot be undone.</p>
        <div class="dialog-buttons">
          <button class="dialog-btn btn-cancel" id="pokepc-reset-cancel">Cancel</button>
          <button class="dialog-btn btn-confirm" id="pokepc-reset-confirm">Reset All</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    document.getElementById('pokepc-reset-cancel').addEventListener('click', dismissReset);
    document.getElementById('pokepc-reset-confirm').addEventListener('click', executeReset);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismissReset();
    });
  }

  function dismissReset() {
    const overlay = document.getElementById('pokepc-reset-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 200);
  }

  function executeReset() {
    doneSet.clear();
    saveProgression();

    document.querySelectorAll('.pokepc-done').forEach(li => {
      li.classList.remove('pokepc-done');
      const tick = li.querySelector('.pokepc-tick');
      if (tick) tick.classList.remove('done');
    });

    updateProgressCounter();
    updateAllBoxTicks();
    dismissReset();
  }

  function findMatchingPokemon(query) {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return [];

    const words = lowerQuery.split(/[\s-]+/).filter(Boolean);

    if (words.length <= 1) {
      const startsWith = POKEMON_DATA.filter(p => p.name.startsWith(lowerQuery));
      const contains = POKEMON_DATA.filter(p =>
        !p.name.startsWith(lowerQuery) && p.name.includes(lowerQuery)
      );
      return [...startsWith, ...contains];
    }

    const exact = POKEMON_DATA.filter(p =>
      words.every(w => p.name.includes(w))
    );
    return exact;
  }

  function findImgForPokemon(pokemon) {
    const isBase = /^\d{4}$/.test(pokemon.id);
    const selectors = isBase
      ? [
          `img[src*="/${pokemon.id}.webp"]`,
          `img[data-src*="/${pokemon.id}.webp"]`,
        ]
      : [
          `img[src*="/${pokemon.id}.webp"]`,
          `img[src*="/${pokemon.id}-"]`,
          `img[data-src*="/${pokemon.id}.webp"]`,
          `img[data-src*="/${pokemon.id}-"]`,
        ];

    let imgs = document.querySelectorAll(selectors.join(', '));

    if (isBase && imgs.length > 0) {
      imgs = Array.from(imgs).filter(img => {
        const id = extractPokemonId(img.src || img.dataset.src || '');
        return id === pokemon.id;
      });
    } else {
      imgs = Array.from(imgs);
    }

    if (imgs.length > 0) return imgs;

    if (elementIndex.has(pokemon.id)) {
      return elementIndex.get(pokemon.id).map(e => e.img);
    }
    return [];
  }

  function pruneElementIndex() {
    for (const [id, entries] of elementIndex) {
      const live = entries.filter(e => e.img.isConnected);
      if (live.length === 0) {
        elementIndex.delete(id);
      } else if (live.length !== entries.length) {
        elementIndex.set(id, live);
      }
    }
  }

  function findPokemonElements(pokemonList) {
    const results = [];
    const seenElements = new Set();
    for (const pokemon of pokemonList) {
      const imgs = findImgForPokemon(pokemon);
      for (const img of imgs) {
        if (!img.isConnected) continue;
        const el = img.closest('li') || img;
        if (!el.isConnected) continue;
        if (seenElements.has(el)) continue;
        seenElements.add(el);
        results.push({ element: el, img, pokemon });
      }
    }
    return results;
  }

  async function scrollScanForPokemon(pokemonList) {
    if (scrollScanAbort) scrollScanAbort.abort = true;
    const controller = { abort: false };
    scrollScanAbort = controller;

    showInfo(`Scanning for ${pokemonList[0].name}...`, false);

    const scrollStep = window.innerHeight * 0.7;
    const maxScroll = document.documentElement.scrollHeight;
    const startScroll = window.scrollY;

    for (let pos = 0; pos < maxScroll; pos += scrollStep) {
      if (controller.abort) return [];
      window.scrollTo(0, pos);
      await new Promise(r => setTimeout(r, 50));
      isProcessing = true;
      pruneElementIndex();
      buildElementIndex();
      processTickMarks();
      isProcessing = false;
      const results = findPokemonElements(pokemonList);
      if (results.length > 0) {
        scrollScanAbort = null;
        return results;
      }
    }

    window.scrollTo(0, startScroll);
    scrollScanAbort = null;
    return [];
  }

  async function performSearch(query) {
    if (scrollScanAbort) scrollScanAbort.abort = true;
    clearHighlights();

    if (!query || !query.trim()) {
      hideInfo();
      currentMatches = [];
      currentIndex = 0;
      return;
    }

    const pokemonList = findMatchingPokemon(query);
    if (pokemonList.length === 0) {
      showInfo(`No match for "${query}"`, false);
      currentMatches = [];
      currentIndex = 0;
      return;
    }

    pruneElementIndex();
    buildElementIndex();
    let results = findPokemonElements(pokemonList);

    if (results.length === 0) {
      results = await scrollScanForPokemon(pokemonList);
      if (results.length === 0) {
        showInfo(`${pokemonList[0].name} not found on page`, false);
        currentMatches = [];
        currentIndex = 0;
        return;
      }
    }

    currentMatches = results;
    currentIndex = 0;

    currentMatches.forEach((match, i) => {
      if (i === 0) {
        match.element.classList.add('pokepc-highlight');
      } else {
        match.element.classList.add('pokepc-highlight-secondary');
      }
    });

    showInfo(`${currentMatches[0].pokemon.name} (1/${currentMatches.length})`, currentMatches.length > 1);

    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
    flyToElement(currentMatches[0].element);
  }

  function flyToElement(el) {
    const rect = el.getBoundingClientRect();
    const absoluteTop = window.scrollY + rect.top;
    const targetY = absoluteTop - (window.innerHeight / 2) + (rect.height / 2);
    window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
  }

  function scrollToMatch(index) {
    if (!currentMatches[index]) return;
    flyToElement(currentMatches[index].element);
  }

  function navigateNext() {
    if (currentMatches.length <= 1) return;

    currentMatches[currentIndex].element.classList.remove('pokepc-highlight');
    currentMatches[currentIndex].element.classList.add('pokepc-highlight-secondary');

    currentIndex = (currentIndex + 1) % currentMatches.length;

    currentMatches[currentIndex].element.classList.remove('pokepc-highlight-secondary');
    currentMatches[currentIndex].element.classList.add('pokepc-highlight');

    showInfo(`${currentMatches[currentIndex].pokemon.name} (${currentIndex + 1}/${currentMatches.length})`, true);
    scrollToMatch(currentIndex);
  }

  function navigatePrev() {
    if (currentMatches.length <= 1) return;

    currentMatches[currentIndex].element.classList.remove('pokepc-highlight');
    currentMatches[currentIndex].element.classList.add('pokepc-highlight-secondary');

    currentIndex = (currentIndex - 1 + currentMatches.length) % currentMatches.length;

    currentMatches[currentIndex].element.classList.remove('pokepc-highlight-secondary');
    currentMatches[currentIndex].element.classList.add('pokepc-highlight');

    showInfo(`${currentMatches[currentIndex].pokemon.name} (${currentIndex + 1}/${currentMatches.length})`, true);
    scrollToMatch(currentIndex);
  }

  function showInfo(text, showNav) {
    const info = document.getElementById('pokepc-search-info');
    const matchText = info.querySelector('.match-text');
    const navButtons = info.querySelector('.nav-buttons');

    matchText.textContent = text;
    navButtons.style.display = showNav ? 'flex' : 'none';
    info.classList.add('visible');
  }

  function hideInfo() {
    const info = document.getElementById('pokepc-search-info');
    info.classList.remove('visible');
  }

  function clearHighlights() {
    document.querySelectorAll('.pokepc-highlight, .pokepc-highlight-secondary').forEach(el => {
      el.classList.remove('pokepc-highlight', 'pokepc-highlight-secondary');
    });
  }

  function clearSearch() {
    if (scrollScanAbort) scrollScanAbort.abort = true;
    clearHighlights();
    hideInfo();
    currentMatches = [];
    currentIndex = 0;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
