// --- Configuration ---
const INACTIVITY_TIMEOUT_SECONDS = 30;
const ADMIN_TRIGGER_HOLD_SECONDS = 10;
const ADMIN_UNLOCK_TIMEOUT_SECONDS = 30;
const MAIN_PAGE_ID = 'main';
// URL of your Flask server (use ngrok URL during development)
const SERVER_URL = 'http://10.0.0.82:5010'; // Replace with your ngrok https URL, Corrected Port
const API_ENDPOINT_TILES = `${SERVER_URL}/api/tiles`;
const ASSET_BASE_URL = `${SERVER_URL}/assets`; // Base URL for images/audio
const PLACEHOLDER_IMAGE_PATH = 'images/placeholder.webp'; // Local fallback placeholder
const PLACEHOLDER_AUDIO_PATH = 'audio/placeholder.ogg';   // Local fallback placeholder
const LOCAL_STORAGE_KEY = 'ameliaVoicePageLayouts';

// --- Data Stores ---
// Master list of tile definitions fetched from server
let masterTileList = {}; // Store as object {tileId: tileData}
// Page layouts (structure: { pageId: { name: "Page Name", tileIds: [id1, id2, null, id4, ...], bgColor: "#hex" } })
let pageLayouts = {};

// Define the color palette
const PALETTE = [
    '#f8f8f8', '#fff0f0', '#f0fff0', '#f0f8ff', '#faf0e6',
    '#fffacd', '#e6e6fa', '#ffe4e1', '#d8bfd8', '#b0e0e6'
];
const DEFAULT_BG_COLOR = PALETTE[0]; // Default to the first color

// --- State Variables ---
let currentPageId = MAIN_PAGE_ID;
let inactivityTimer = null;
let adminTriggerTimeout = null;
let adminUnlockSequence = [];
let adminUnlockAttempt = [];
let adminUnlockTimeout = null;
let isAdminUnlockActive = false;
let isDataLoading = true; // Flag to indicate initial data load

// --- DOM Elements ---
const pageContainer = document.getElementById('page-container');
const audioPlayer = document.getElementById('audio-player');
const adminPanel = document.getElementById('admin-panel');
const closeAdminButton = document.getElementById('close-admin');
const adminTrigger = document.getElementById('admin-trigger');
const cornerButtons = {
    tl: document.getElementById('corner-btn-tl'),
    tr: document.getElementById('corner-btn-tr'),
    bl: document.getElementById('corner-btn-bl'),
    br: document.getElementById('corner-btn-br'),
};
// Admin Panel UI elements (to be added/referenced later)
const adminPageSelector = document.getElementById('admin-page-select');
const adminTileContainer = document.getElementById('admin-tile-list');
const adminAvailableTilesContainer = document.getElementById('admin-available-tiles');
const adminSaveButton = document.getElementById('admin-save-layout');
const adminPageLayoutGrid = document.getElementById('admin-page-layout-grid');
const adminAvailableTilesList = document.getElementById('admin-available-tiles-list');
const adminSaveLayoutButton = document.getElementById('admin-save-layout');
const adminCreatePageButton = document.getElementById('admin-create-page');
const adminDeletePageButton = document.getElementById('admin-delete-page');
const adminColorSwatchesContainer = document.getElementById('admin-color-swatches'); // Add this ID to index.html

// --- Begin Prompt Elements ---
const beginPrompt = document.getElementById('begin-prompt');
const beginButton = document.getElementById('begin-button');

// --- Drag and Drop State ---
let draggedTileId = null; // Keep for potential future use? Maybe remove later if fully committed to tap.
let draggedElement = null; // Keep for potential future use? Maybe remove later if fully committed to tap.
let selectedAdminTileId = null; // For tap interaction

// --- Functions ---

/**
 * Handles clicking on an available tile in the admin panel.
 * Selects the tile visually and stores its ID.
 * @param {Event} event The click event.
 */
function handleSelectAvailableTile(event) {
    const clickedTileElement = event.currentTarget; // Get the tile div that was clicked
    const tileId = clickedTileElement.dataset.tileId;

    // Deselect if clicking the same tile again
    if (selectedAdminTileId === tileId) {
        selectedAdminTileId = null;
        clickedTileElement.classList.remove('selected');
        console.log("Deselected available tile:", tileId);
    } else {
        // Deselect any previously selected tile
        const previouslySelected = document.querySelector('.admin-available-tile.selected');
        if (previouslySelected) {
            previouslySelected.classList.remove('selected');
        }

        // Select the new tile
        selectedAdminTileId = tileId;
        clickedTileElement.classList.add('selected');
        console.log("Selected available tile:", selectedAdminTileId);
    }
}

/**
 * Handles clicking on an empty slot in the admin page layout grid.
 * If an available tile is selected, places it in the clicked slot.
 * @param {Event} event The click event.
 */
function handlePlaceTileInSlot(event) {
    const clickedSlotElement = event.currentTarget; // Get the slot div that was clicked
    const targetIndex = parseInt(clickedSlotElement.dataset.index);
    const currentPage = adminPageSelector.value;

    if (!selectedAdminTileId) {
        console.log("Slot clicked, but no tile selected.");
        return; // Do nothing if no tile is selected
    }

    if (!pageLayouts[currentPage] || !Array.isArray(pageLayouts[currentPage].tileIds)) {
        console.error(`Error: Layout or tileIds array not found for page ${currentPage}`);
        return;
    }

    // Check if slot is actually empty (it should be, as listener is only added to empty ones)
    if (pageLayouts[currentPage].tileIds[targetIndex] !== null) {
        console.warn(`Attempted to place tile in non-empty slot ${targetIndex}. Ignoring.`);
        return;
    }

    console.log(`Placing tile ${selectedAdminTileId} into page ${currentPage}, slot ${targetIndex}`);

    // Update the layout data
    pageLayouts[currentPage].tileIds[targetIndex] = selectedAdminTileId;

    // Clear selection state
    const selectedElement = document.querySelector('.admin-available-tile.selected');
    if (selectedElement) {
        selectedElement.classList.remove('selected');
    }
    selectedAdminTileId = null;

    // Refresh the admin grid view to show the newly placed tile
    loadAdminViewForPage(currentPage);
}


/**
 * Fetches the master list of tile definitions from the server.
 */
async function fetchMasterTileList() {
    console.log('Fetching master tile list from:', API_ENDPOINT_TILES);
    try {
        const response = await fetch(API_ENDPOINT_TILES);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const tilesArray = await response.json();
        // Convert array to object for easy lookup by id
        masterTileList = tilesArray.reduce((acc, tile) => {
            acc[tile.id] = tile; // Assuming each tile from API has a unique 'id'
            return acc;
        }, {});
        console.log('Master tile list loaded:', masterTileList);
    } catch (error) {
        console.error("Could not fetch master tile list:", error);
        // Handle error appropriately - maybe show a message to the user
        alert("Error loading tile definitions from the server. Please ensure the server is running and accessible.");
        masterTileList = {}; // Reset to empty on error
    }
}

/**
 * Loads page layouts from Local Storage.
 */
function loadPageLayouts() {
    const storedLayouts = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (storedLayouts) {
        try {
            pageLayouts = JSON.parse(storedLayouts);
            console.log('Loaded page layouts from Local Storage:', pageLayouts);
            // Ensure existing pages have a default bg color if missing (migration)
            Object.values(pageLayouts).forEach(page => {
                if (!page.bgColor) {
                    page.bgColor = DEFAULT_BG_COLOR;
                }
            });
        } catch (error) {
            console.error('Error parsing page layouts from Local Storage:', error);
            initializeDefaultLayouts();
        }
    } else {
        initializeDefaultLayouts();
    }
    if (!pageLayouts[MAIN_PAGE_ID]) {
         pageLayouts[MAIN_PAGE_ID] = { name: 'Main Menu', tileIds: new Array(24).fill(null), bgColor: DEFAULT_BG_COLOR };
         console.warn('Main page layout missing, initialized default.');
    }
}

/**
 * Saves the current page layouts to Local Storage.
 */
function savePageLayouts() {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(pageLayouts));
        console.log('Page layouts saved to Local Storage.');
    } catch (error) {
        console.error('Error saving page layouts to Local Storage:', error);
        alert('Error saving changes. Your changes might not persist.');
    }
}

/**
 * Initializes default page layouts if none are found in Local Storage.
 */
function initializeDefaultLayouts() {
    console.log('Initializing default page layouts.');
    pageLayouts = {
        [MAIN_PAGE_ID]: {
            name: 'Main Menu',
            tileIds: new Array(24).fill(null),
            bgColor: DEFAULT_BG_COLOR
        },
         'food': { name: 'Food Menu', tileIds: new Array(24).fill(null), bgColor: DEFAULT_BG_COLOR },
         'drinks': { name: 'Drinks Menu', tileIds: new Array(24).fill(null), bgColor: DEFAULT_BG_COLOR },
    };
    // savePageLayouts(); // Optionally save defaults immediately
}

/**
 * Loads and displays a page based on its ID using data from Local Storage and the master list.
 * @param {string} pageId The ID of the page to load.
 */
function loadPage(pageId) {
    if (isDataLoading) {
        console.log("Data is still loading, delaying page load...");
        // Optionally show a loading indicator
        return;
    }

    const layoutData = pageLayouts[pageId];
    if (!layoutData) {
        console.error(`Page layout with ID '${pageId}' not found.`);
        // Attempt to load main page, if that fails, something is wrong
        if (pageId !== MAIN_PAGE_ID) {
             loadPage(MAIN_PAGE_ID);
        } else {
             alert("Critical error: Main page layout not found!");
             pageContainer.innerHTML = '<p style="color:red; padding: 20px;">Error: Could not load main page layout.</p>';
        }
        return;
    }

    currentPageId = pageId;
    if (isAdminUnlockActive) {
        resetAdminUnlock();
    }
    pageContainer.innerHTML = ''; // Clear previous tiles
    document.title = `Amelia's Voice - ${layoutData.name || pageId}`; // Use layout name or ID

    // Apply background color
    document.body.style.backgroundColor = layoutData.bgColor || DEFAULT_BG_COLOR;

    const tileIds = layoutData.tileIds || []; // Get the array of tile IDs for this page
    const totalSlots = 24;

    for (let i = 0; i < totalSlots; i++) {
        const tileId = tileIds[i]; // Get the tile ID for this slot (can be null)
        const tileElement = document.createElement('div');
        tileElement.classList.add('tile');

        if (tileId && masterTileList[tileId]) {
            const tileData = masterTileList[tileId]; // Get full tile data from master list

            tileElement.dataset.tileId = tileData.id;
            tileElement.dataset.nextPage = tileData.nextPage || '';
            // Construct full asset URLs pointing to the server
            const imageUrl = tileData.image ? `${ASSET_BASE_URL}/images/${tileData.image}` : PLACEHOLDER_IMAGE_PATH;
            const audioUrl = tileData.audio ? `${ASSET_BASE_URL}/audio/${tileData.audio}` : PLACEHOLDER_AUDIO_PATH;
            tileElement.dataset.audioSrc = audioUrl;

            const imgElement = document.createElement('img');
            imgElement.src = imageUrl;
            imgElement.alt = tileData.text || 'Tile';
            imgElement.onerror = () => {
                console.warn(`Image not found: ${imgElement.src}, using local placeholder.`);
                imgElement.src = PLACEHOLDER_IMAGE_PATH;
            };
            tileElement.appendChild(imgElement);

            addTileEventListeners(tileElement);

        } else {
            tileElement.classList.add('empty');
             if(tileId) {
                console.warn(`Tile data for ID '${tileId}' not found in master list.`);
                // Optionally display the missing ID
                // tileElement.textContent = `Missing: ${tileId.substring(0, 6)}...`;
            }
        }
        pageContainer.appendChild(tileElement);
    }

    // --- Add Admin Elements Dynamically ---
    const ensureGlobalAdminElements = () => {
        // Only ensure the trigger exists, corner buttons handled elsewhere
        let trigger = document.getElementById('admin-trigger');
        if (!trigger && pageId === MAIN_PAGE_ID) { // Only create trigger on main page
            trigger = document.createElement('div');
            trigger.id = 'admin-trigger';
            pageContainer.appendChild(trigger);
        }
    };

    ensureGlobalAdminElements(); // Create trigger if needed

    // --- Set Visibility and Attach Listeners for Trigger ---
    const currentTrigger = document.getElementById('admin-trigger');
    if (currentTrigger) {
        if (pageId === MAIN_PAGE_ID && !isAdminUnlockActive) {
            currentTrigger.classList.remove('hidden');
            setupAdminTrigger(currentTrigger); // Attach listener only when visible
        } else {
            currentTrigger.classList.add('hidden');
        }
    }
    // --- Corner buttons are NOT handled here anymore ---

    resetInactivityTimer(pageId !== MAIN_PAGE_ID);
}

/**
 * Adds pointer down and up event listeners to a tile.
 * Handles navigation and audio playback.
 * @param {HTMLElement} tileElement The tile element.
 */
function addTileEventListeners(tileElement) {
    tileElement.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (isAdminUnlockActive) return;

        tileElement.classList.add('pressed');
        const audioSrc = tileElement.dataset.audioSrc;

        if (audioPlayer && audioSrc && audioSrc !== PLACEHOLDER_AUDIO_PATH) {
            // Create a function to handle the play action
            const playAudio = () => {
                // Remove the listener to prevent it firing multiple times
                audioPlayer.removeEventListener('loadeddata', playAudio);
                audioPlayer.play().catch(e => console.error("Audio play failed:", e));
            };

            // Add the event listener
            audioPlayer.addEventListener('loadeddata', playAudio);

            // Set the source and trigger loading
            audioPlayer.src = audioSrc;
            audioPlayer.load(); // Explicitly tell the browser to load

        } else if (audioSrc === PLACEHOLDER_AUDIO_PATH) {
            console.log("Skipping placeholder audio.");
        }
        resetInactivityTimer();
    });

    tileElement.addEventListener('pointerup', (event) => {
        event.preventDefault();
        if (isAdminUnlockActive || !tileElement.classList.contains('pressed')) return;

        tileElement.classList.remove('pressed');
        const nextPage = tileElement.dataset.nextPage;

        // Stop audio playback maybe? If using the event listener approach above,
        // the audio might start playing AFTER pointerup if loading is slow.
        // Consider stopping it here if needed, though it might cut off audio.
        // audioPlayer.pause();
        // audioPlayer.currentTime = 0; // Reset if stopping

        if (nextPage && pageLayouts[nextPage]) { // Check if target page exists in layouts
            loadPage(nextPage);
        } else if (nextPage) {
            console.warn(`Navigation target page '${nextPage}' does not exist in layouts.`);
        } else if (currentPageId !== MAIN_PAGE_ID) {
            loadPage(MAIN_PAGE_ID);
        }
    });

    tileElement.addEventListener('pointerleave', (event) => {
        if (tileElement.classList.contains('pressed')) {
            tileElement.classList.remove('pressed');
            // Maybe stop audio here too if pointer leaves while pressed?
            // audioPlayer.pause();
            // audioPlayer.currentTime = 0;
        }
    });

     tileElement.addEventListener('pointercancel', (event) => {
        if (tileElement.classList.contains('pressed')) {
            tileElement.classList.remove('pressed');
             // Maybe stop audio here too?
            // audioPlayer.pause();
            // audioPlayer.currentTime = 0;
        }
    });
}

/**
 * Resets the inactivity timer.
 * @param {boolean} shouldStart Whether the timer should be started.
 */
function resetInactivityTimer(shouldStart = true) {
    clearTimeout(inactivityTimer);
    // Only start timer if requested, not on main page, and admin unlock is NOT active
    if (shouldStart && currentPageId !== MAIN_PAGE_ID && !isAdminUnlockActive) {
        inactivityTimer = setTimeout(() => {
            console.log('Inactivity timeout reached. Returning to main page.');
            loadPage(MAIN_PAGE_ID);
        }, INACTIVITY_TIMEOUT_SECONDS * 1000);
    }
}

// --- Admin Access Logic ---

function setupAdminTrigger(triggerElement) {
    if (!triggerElement) return;

    triggerElement.addEventListener('pointerdown', (e) => {
        // Only allow trigger on main page and if not already in unlock sequence
        if (currentPageId !== MAIN_PAGE_ID || isAdminUnlockActive) return;
        e.preventDefault();
        // Start the timer to detect hold
        clearTimeout(adminTriggerTimeout);
        adminTriggerTimeout = setTimeout(() => {
            console.log('Admin trigger held.');
            startAdminUnlockSequence();
        }, ADMIN_TRIGGER_HOLD_SECONDS * 1000);
    });

    const clearAdminTrigger = (e) => {
        clearTimeout(adminTriggerTimeout);
    };

    triggerElement.addEventListener('pointerup', clearAdminTrigger);
    triggerElement.addEventListener('pointerleave', clearAdminTrigger);
    triggerElement.addEventListener('pointercancel', clearAdminTrigger);
}

function startAdminUnlockSequence() {
    console.log('Starting admin unlock sequence.');
    isAdminUnlockActive = true;
    clearTimeout(inactivityTimer); // Pause general inactivity timer
    document.body.classList.add('admin-unlock-active');

    // --- Create Corner Buttons Dynamically ---
    Object.keys(cornerButtons).forEach(key => {
        const buttonId = `corner-btn-${key}`;
        let btn = document.getElementById(buttonId); // Check if somehow exists
        if (btn) btn.remove(); // Remove if accidentally left over

        btn = document.createElement('div');
        btn.id = buttonId;
        btn.classList.add('corner-button'); // Add base class, no 'hidden' needed
        pageContainer.appendChild(btn);
        btn.addEventListener('click', handleCornerButtonClick);
        cornerButtons[key] = btn; // Update global reference
    });
    // --- End Create Buttons ---

    // Generate random numbers and assign to buttons
    const numbers = [1, 2, 3, 4];
    shuffleArray(numbers);

    adminUnlockSequence = []; // Store the correct sequence of button IDs
    adminUnlockAttempt = [];  // Reset user attempt

    // Assign numbers and make visible (already visible as created without hidden)
    Object.keys(cornerButtons).forEach((key, index) => {
        const button = cornerButtons[key];
        const num = numbers[index];
        button.textContent = num;
        button.dataset.number = num; // Store number for checking later
        // button.classList.remove('hidden'); // No longer needed
        adminUnlockSequence[num - 1] = key; // Store ID based on corner key (tl, tr, etc.)
    });

    // Adjust sequence storage to use ID directly
    adminUnlockSequence = adminUnlockSequence.map(key => `corner-btn-${key}`);
    console.log('Correct sequence order (button IDs):', adminUnlockSequence);

    // Start timeout for this stage
    clearTimeout(adminUnlockTimeout);
    adminUnlockTimeout = setTimeout(() => {
        console.log('Admin unlock sequence timed out.');
        resetAdminUnlock();
    }, ADMIN_UNLOCK_TIMEOUT_SECONDS * 1000);
}

function handleCornerButtonClick(event) {
    if (!isAdminUnlockActive) return;

    const clickedButtonId = event.target.id;
    const clickedNumber = parseInt(event.target.dataset.number);

    console.log(`Clicked corner button: ${clickedButtonId} (Number: ${clickedNumber})`);

    // Check if this is the correct number in sequence
    const expectedNumber = adminUnlockAttempt.length + 1;

    if (clickedNumber === expectedNumber) {
        adminUnlockAttempt.push(clickedButtonId);
        console.log('Correct step:', adminUnlockAttempt);
        // Check for completion
        if (adminUnlockAttempt.length === 4) {
            console.log('Admin sequence successful!');
            resetAdminUnlock(false); // Reset UI without showing tiles immediately
            openAdminPanel();
        } else {
            // Reset the timeout as user made progress
            clearTimeout(adminUnlockTimeout);
            adminUnlockTimeout = setTimeout(() => {
                console.log('Admin unlock sequence timed out after partial entry.');
                resetAdminUnlock();
            }, ADMIN_UNLOCK_TIMEOUT_SECONDS * 1000);
        }
    } else {
        console.log('Incorrect step. Resetting sequence.');
        // Flash effect? (Optional)
        resetAdminUnlock();
    }
}

function resetAdminUnlock(showTiles = true) {
    console.log('Resetting admin unlock state.');
    clearTimeout(adminUnlockTimeout);
    isAdminUnlockActive = false;
    adminUnlockAttempt = [];
    adminUnlockSequence = [];

    // Remove corner buttons from DOM
    Object.values(cornerButtons).forEach(button => {
        if (button && button.parentNode) {
            button.remove();
        }
    });
    // Clear references (optional but good practice)
    // cornerButtons = { tl: null, tr: null, bl: null, br: null };

    if (showTiles) {
        document.body.classList.remove('admin-unlock-active');
    }
    // Show admin trigger again if on main page
    const currentTrigger = document.getElementById('admin-trigger');
    if (currentTrigger && currentPageId === MAIN_PAGE_ID) {
        currentTrigger.classList.remove('hidden');
         // Re-attach listener? The element should still be there, but maybe safer.
         setupAdminTrigger(currentTrigger);
    }

    resetInactivityTimer(currentPageId !== MAIN_PAGE_ID);
}

// Fisher-Yates shuffle algorithm
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// --- Admin Panel Functions ---

function openAdminPanel() {
    console.log("Opening Admin Panel");
    document.body.classList.remove('admin-unlock-active');
    adminPanel.classList.remove('hidden');
    resetInactivityTimer(false);
    resetAdminUnlock(false);

    // Populate dynamic content
    populateAdminPageSelector();
    const initialPageId = adminPageSelector.value || currentPageId || MAIN_PAGE_ID;
    loadAdminViewForPage(initialPageId);
    loadAvailableTilesForAdmin();
    populateAdminColorSwatches(initialPageId); // Populate swatches for the selected page

    // --- Attach Listeners for Admin Panel Buttons ---
    // Ensures listeners are attached right before panel is used
    console.log('Attaching listeners in openAdminPanel...');

    if (adminSaveLayoutButton) {
        console.log('Attaching Save Layout listener.');
        adminSaveLayoutButton.removeEventListener('click', handleAdminSaveLayout);
        adminSaveLayoutButton.addEventListener('click', handleAdminSaveLayout);
    } else { console.error('Save button not found in openAdminPanel'); }

    if (adminCreatePageButton) {
        console.log('Attaching Create Page listener.');
        adminCreatePageButton.removeEventListener('click', handleCreatePage);
        adminCreatePageButton.addEventListener('click', handleCreatePage);
    } else { console.error('Create Page button not found in openAdminPanel'); }

    if (adminDeletePageButton) {
        console.log('Attaching Delete Page listener.');
        adminDeletePageButton.removeEventListener('click', handleDeletePage);
        adminDeletePageButton.addEventListener('click', handleDeletePage);
    } else { console.error('Delete Page button not found in openAdminPanel'); }

    if (closeAdminButton) { // Also ensure close button listener is attached
         console.log('Attaching Close Admin listener.');
         closeAdminButton.removeEventListener('click', closeAdminPanel);
         closeAdminButton.addEventListener('click', closeAdminPanel);
    } else { console.error('Close Admin button not found in openAdminPanel'); }

    // Note: Page selector listener is attached within populateAdminPageSelector
    // Note: setupAdminControls is now only responsible for the secret trigger setup
}

function closeAdminPanel() {
    adminPanel.classList.add('hidden');
    resetInactivityTimer(currentPageId !== MAIN_PAGE_ID);
    // Reload the current page to ensure user view is correct
    loadPage(currentPageId);
}

// --- Admin Panel Population/Interaction Functions ---

function populateAdminPageSelector() {
    if (!adminPageSelector) return;
    adminPageSelector.innerHTML = ''; // Clear existing options
    const pageIds = Object.keys(pageLayouts).sort(); // Sort alphabetically

    pageIds.forEach(pageId => {
        const option = document.createElement('option');
        option.value = pageId;
        option.textContent = `${pageLayouts[pageId]?.name || pageId} (${pageId})`;
        adminPageSelector.appendChild(option);
    });

    // Select the currently viewed page if possible, otherwise the first page
    adminPageSelector.value = currentPageId in pageLayouts ? currentPageId : pageIds[0] || '';

    // Add event listener to load layout on change
    adminPageSelector.removeEventListener('change', handleAdminPageSelectChange);
    adminPageSelector.addEventListener('change', handleAdminPageSelectChange);
}

function handleAdminPageSelectChange() {
    const selectedPageId = adminPageSelector.value;
    if (selectedPageId) {
        loadAdminViewForPage(selectedPageId);
        populateAdminColorSwatches(selectedPageId); // Update swatches when page changes
    }
}

function loadAdminViewForPage(pageId) {
    if (!adminPageLayoutGrid) return;
    adminPageLayoutGrid.innerHTML = ''; // Clear previous grid

    const layout = pageLayouts[pageId];
    if (!layout) {
        console.error("Layout not found for page:", pageId);
        adminPageLayoutGrid.textContent = 'Error: Layout not found.';
        return;
    }

    const tileIds = layout.tileIds || new Array(24).fill(null);

    for (let i = 0; i < 24; i++) {
        const slot = document.createElement('div');
        slot.classList.add('admin-grid-slot');
        slot.dataset.index = i;

        const tileId = tileIds[i];

        if (tileId && masterTileList[tileId]) {
            const tileData = masterTileList[tileId];
            slot.dataset.tileId = tileId;
            // slot.draggable = true; // REMOVED

            const img = document.createElement('img');
            img.src = tileData.image ? `${ASSET_BASE_URL}/images/${tileData.image}` : PLACEHOLDER_IMAGE_PATH;
            img.alt = tileData.text;
            img.onerror = () => { img.src = PLACEHOLDER_IMAGE_PATH; };
            img.draggable = false; // Prevent image ghost dragging
            slot.appendChild(img);

            const text = document.createElement('span');
            text.textContent = tileData.text.length > 15 ? tileData.text.substring(0, 12) + '...' : tileData.text;
            slot.appendChild(text);

            // Add remove button
            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '&times;'; // Multiplication sign as X
            removeBtn.classList.add('admin-remove-tile-btn');
            removeBtn.title = 'Remove tile from this slot';
            removeBtn.onclick = (e) => {
                e.stopPropagation(); // Prevent potential parent click handlers
                removeTileFromSlot(pageId, i); // We need this function!
            };
            slot.appendChild(removeBtn);

            // REMOVED dragstart listener

        } else {
            slot.classList.add('empty');
            slot.textContent = 'Empty';
            if (tileId) {
                slot.textContent += ` (Missing: ${tileId.substring(0,4)}...)`;
                slot.style.color = 'red';
            }
            // Add click listener to empty slots for placing tiles
            slot.addEventListener('click', handlePlaceTileInSlot);
        }

        // REMOVED drop zone listeners
        // slot.addEventListener('dragover', handleDragOver);
        // slot.addEventListener('dragleave', handleDragLeave);
        // slot.addEventListener('drop', handleDrop);

        adminPageLayoutGrid.appendChild(slot);
    }
}

function loadAvailableTilesForAdmin() {
    if (!adminAvailableTilesList) return;
    adminAvailableTilesList.innerHTML = ''; // Clear previous list

    const tileIds = Object.keys(masterTileList).sort((a,b) => masterTileList[a].text.localeCompare(masterTileList[b].text));

    if (tileIds.length === 0) {
        adminAvailableTilesList.textContent = 'No tiles defined on server yet.';
        return;
    }

    tileIds.forEach(tileId => {
        const tileData = masterTileList[tileId];
        const div = document.createElement('div');
        div.classList.add('admin-available-tile');
        // div.draggable = true; // REMOVED
        div.dataset.tileId = tileId; // Store ID for interaction

        const img = document.createElement('img');
        img.src = tileData.image ? `${ASSET_BASE_URL}/images/${tileData.image}` : PLACEHOLDER_IMAGE_PATH;
        img.alt = tileData.text;
        img.onerror = () => { img.src = PLACEHOLDER_IMAGE_PATH; };
        img.draggable = false;
        div.appendChild(img);

        const text = document.createElement('span');
         text.textContent = tileData.text.length > 15 ? tileData.text.substring(0, 12) + '...' : tileData.text;
        div.appendChild(text);

        // REMOVED dragstart listener
        // Add click listener for selecting available tiles
        div.addEventListener('click', handleSelectAvailableTile);

        adminAvailableTilesList.appendChild(div);
    });
}

// --- Function required by loadAdminViewForPage ---
function removeTileFromSlot(pageId, index) {
     if (!pageLayouts[pageId] || !Array.isArray(pageLayouts[pageId].tileIds) || index >= pageLayouts[pageId].tileIds.length) {
         console.error(`Cannot remove tile from invalid page/index: ${pageId} / ${index}`);
         return;
     }
     console.log(`Removing tile from page ${pageId}, slot ${index}`);
     pageLayouts[pageId].tileIds[index] = null; // Set the ID to null
     console.log(`Layout for ${pageId} after remove:`, [...pageLayouts[pageId].tileIds]); // Log the updated layout array

     // Refresh the admin view to show the empty slot and potentially deselect
     loadAdminViewForPage(pageId);
     // Also clear selection in case the removed tile was the selected one
     selectedAdminTileId = null;
     const previouslySelected = document.querySelector('.admin-available-tile.selected');
     if (previouslySelected) {
         previouslySelected.classList.remove('selected');
     }
}
// --- End Required Function ---


function populateAdminColorSwatches(pageId) {
    if (!adminColorSwatchesContainer) return;
    adminColorSwatchesContainer.innerHTML = ''; // Clear existing swatches

    const currentPageBg = pageLayouts[pageId]?.bgColor || DEFAULT_BG_COLOR;

    PALETTE.forEach(color => {
        const swatch = document.createElement('div');
        swatch.classList.add('admin-color-swatch');
        swatch.style.backgroundColor = color;
        swatch.dataset.color = color;
        if (color === currentPageBg) {
            swatch.classList.add('selected');
        }

        swatch.addEventListener('click', () => {
            handleColorSelection(pageId, color);
        });

        adminColorSwatchesContainer.appendChild(swatch);
    });
}

function handleColorSelection(pageId, selectedColor) {
    if (!pageLayouts[pageId]) return;

    console.log(`Setting background for ${pageId} to ${selectedColor}`);
    pageLayouts[pageId].bgColor = selectedColor;

    // Update swatch selection visuals
    document.querySelectorAll('#admin-color-swatches .admin-color-swatch').forEach(swatch => {
        swatch.classList.toggle('selected', swatch.dataset.color === selectedColor);
    });

    // Optional: Update live preview background (can be jarring, consider carefully)
    // document.body.style.backgroundColor = selectedColor;
}


// --- Page Management Functions ---
function handleCreatePage() {
    const newPageId = prompt("Enter a unique ID for the new page (e.g., 'snacks', 'park_activities'):");
    if (!newPageId || newPageId.trim() === "") return;
    const trimmedId = newPageId.trim();

    if (pageLayouts[trimmedId]) {
        alert(`Error: Page ID '${trimmedId}' already exists.`);
        return;
    }

    const newPageName = prompt("Enter a display name for the new page:", trimmedId);
    if (!newPageName || newPageName.trim() === "") return;

    pageLayouts[trimmedId] = {
        name: newPageName.trim(),
        tileIds: new Array(24).fill(null),
        bgColor: DEFAULT_BG_COLOR // Assign default color to new pages
    };
    console.log("Created new page:", trimmedId);

    savePageLayouts(); // Save immediately
    populateAdminPageSelector(); // Update dropdown
    adminPageSelector.value = trimmedId; // Select the new page
    loadAdminViewForPage(trimmedId); // Load its (empty) view
    populateAdminColorSwatches(trimmedId); // Load swatches for new page
}

function handleDeletePage() {
    const pageIdToDelete = adminPageSelector.value;
    if (!pageIdToDelete) return;

    if (pageIdToDelete === MAIN_PAGE_ID) {
        alert("Error: Cannot delete the main page.");
        return;
    }

    if (confirm(`Are you sure you want to delete the page '${pageLayouts[pageIdToDelete]?.name}' (${pageIdToDelete})? This cannot be undone.`)) {
        delete pageLayouts[pageIdToDelete];
        console.log("Deleted page:", pageIdToDelete);
        savePageLayouts(); // Save immediately
        populateAdminPageSelector(); // Update dropdown
        // Load the main page view after deletion
        const firstPageId = Object.keys(pageLayouts).sort()[0] || MAIN_PAGE_ID;
        adminPageSelector.value = firstPageId;
        loadAdminViewForPage(firstPageId);
    }
}

// --- Save Layout Handler ---
function handleAdminSaveLayout() {
    console.log("Save button clicked."); // Log button click
    // The pageLayouts object should have been updated directly by tap/remove actions
    console.log("Current pageLayouts state BEFORE save:", JSON.parse(JSON.stringify(pageLayouts))); // Log state before save
    savePageLayouts();
    alert(`Layout for page '${adminPageSelector.value}' saved successfully!`);
}

// --- Utility Functions ---

/**
 * Tries to lock screen orientation to landscape and enter fullscreen mode.
 * Needs to be called from a user interaction event (like button click).
 */
async function requestLandscapeFullscreen() {
    try {
        // 1. Request Fullscreen
        if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
            console.log('Entered fullscreen mode.');
        } else if (document.documentElement.webkitRequestFullscreen) { /* Safari */
            await document.documentElement.webkitRequestFullscreen();
            console.log('Entered fullscreen mode (webkit).');
        } else if (document.documentElement.msRequestFullscreen) { /* IE11 */
            await document.documentElement.msRequestFullscreen();
            console.log('Entered fullscreen mode (ms).');
        }

        // 2. Attempt Orientation Lock (after fullscreen request)
        // Note: This is experimental and might not work everywhere.
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape');
            console.log('Screen orientation locked to landscape.');
        } else {
            console.warn('Screen orientation lock API not supported or failed.');
        }
    } catch (error) {
        console.error('Error requesting fullscreen or locking orientation:', error);
        // Don't prevent app start if this fails, just log the error.
    }
}

/**
 * Sets up event listeners after the DOM is fully loaded.
 */
function setupEventListeners() {
    // Reset inactivity timer on user interaction
    document.addEventListener('click', () => resetInactivityTimer());
    document.addEventListener('touchstart', () => resetInactivityTimer());

    // Setup admin panel interactions (listeners for buttons inside admin panel
    // are now mostly handled when the panel is opened in openAdminPanel)
    if (closeAdminButton) {
        closeAdminButton.addEventListener('click', closeAdminPanel); // Keep close button listener here maybe?
    }
    if (adminTrigger) {
        setupAdminTrigger(adminTrigger);
    }
    // Note: Save, Create, Delete, PageSelect listeners are attached in openAdminPanel

    // Setup corner buttons for admin unlock sequence
    Object.values(cornerButtons).forEach(button => {
        if (button) {
            button.addEventListener('click', handleCornerButtonClick);
        }
    });

    // REMOVED Drag and drop listeners for admin panel
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded. Setting up Begin prompt.");
    if (!beginButton) {
        console.error("Begin button not found!");
        // If begin button isn't found, maybe just initialize directly?
        // initializeApp(); // Consider uncommenting if Begin prompt is optional
        return;
    }

    beginButton.addEventListener('click', async () => {
        console.log("Begin button clicked.");

        // Attempt fullscreen and landscape lock
        await requestLandscapeFullscreen();

        // Hide prompt and show main container
        if (beginPrompt) {
            beginPrompt.style.display = 'none';
        }
        if (pageContainer) {
            pageContainer.style.display = 'grid'; // Or your default display
        }

        // Now initialize the rest of the app
        await initializeApp();
    });
});

async function initializeApp() {
    console.log("Initializing App Core Logic..."); // Renamed log
    isAdminUnlockActive = false; // Explicitly set initial state
    isDataLoading = true;
    loadPageLayouts(); // Load layouts from storage first (console log inside)
    await fetchMasterTileList(); // Then load tile definitions from server
    isDataLoading = false;

    if (!pageLayouts[currentPageId]) {
        currentPageId = MAIN_PAGE_ID;
    }
    loadPage(currentPageId); // Load the initial page
    console.log("App Core Logic Initialized.");

    // Setup standard event listeners (inactivity, admin trigger, corner buttons)
    setupEventListeners();

    // Start the inactivity timer only after initialization
    resetInactivityTimer();

    // No initial orientation check needed now
}
